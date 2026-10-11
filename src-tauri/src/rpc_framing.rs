//! OMP RPC v1/v2 stdout frame decoder.
//! No fallback to lossy/truncated output: malformed chunks terminate the stream.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::Value;

pub const MAX_PHYSICAL: usize = 1_048_576;
pub const MAX_REASSEMBLED: usize = 67_108_864;
const MAX_CHUNKS: usize = 8192;

struct Pending {
    id: String,
    count: usize,
    len: usize,
    next: usize,
    data: Vec<u8>,
}

#[derive(Default)]
pub struct Decoder { pending: Option<Pending> }

impl Decoder {
    /// `physical` is the frame's UTF-8 bytes without the newline terminator.
    /// Ok(None) means an incomplete v2 chunk sequence, NOT an empty event.
    pub fn push(&mut self, physical: &[u8]) -> Result<Option<Value>, String> {
        if physical.len() + 1 > MAX_PHYSICAL { return Err("RPC physical frame exceeded 1 MiB".into()); }
        let v: Value = serde_json::from_slice(physical).map_err(|_| "Malformed RPC JSON frame".to_string())?;
        if !v.is_object() { return Err("RPC object frame required".into()); }
        if v.get("type").and_then(Value::as_str) != Some("rpc_chunk") {
            if self.pending.is_some() { return Err("RPC chunk sequence interrupted".into()); }
            return Ok(Some(v));
        }
        let id = v.get("chunkId").and_then(Value::as_str).ok_or("RPC chunkId missing")?;
        let index = v.get("index").and_then(Value::as_u64).ok_or("RPC index invalid")? as usize;
        let count = v.get("count").and_then(Value::as_u64).ok_or("RPC count invalid")? as usize;
        let length = v.get("byteLength").and_then(Value::as_u64).ok_or("RPC byteLength invalid")? as usize;
        let data = v.get("data").and_then(Value::as_str).ok_or("RPC base64 data missing")?;
        if id.is_empty() || id.len() > 128 || count == 0 || count > MAX_CHUNKS || index >= count || length == 0 || length > MAX_REASSEMBLED {
            return Err("RPC invalid chunk envelope".into());
        }
        let decoded = STANDARD.decode(data).map_err(|_| "RPC invalid chunk base64".to_string())?;
        if decoded.is_empty() || STANDARD.encode(&decoded) != data { return Err("RPC noncanonical or empty base64".into()); }
        if self.pending.is_none() {
            if index != 0 { return Err("RPC expected chunk zero".into()); }
            self.pending = Some(Pending { id: id.to_owned(), count, len: length, next: 0, data: Vec::with_capacity(length.min(1_048_576)) });
        }
        let p = self.pending.as_mut().ok_or("RPC pending state missing")?;
        if p.id != id || p.count != count || p.len != length || p.next != index {
            self.pending = None;
            return Err("RPC chunk order or identity mismatch".into());
        }
        if decoded.len() > p.len.saturating_sub(p.data.len()) { self.pending = None; return Err("RPC chunk byte overflow".into()); }
        p.data.extend_from_slice(&decoded);
        p.next += 1;
        if p.next != p.count { return Ok(None); }
        let p = self.pending.take().ok_or("RPC pending completion missing")?;
        if p.data.len() != p.len { return Err("RPC reassembled byte length mismatch".into()); }
        let full: Value = serde_json::from_slice(&p.data).map_err(|_| "RPC reassembled JSON invalid".to_string())?;
        if !full.is_object() || full.get("type").and_then(Value::as_str) == Some("rpc_chunk") { return Err("RPC reassembled object invalid".into()); }
        Ok(Some(full))
    }
    pub fn finish(&self) -> Result<(), String> {
        if self.pending.is_some() { Err("RPC EOF during chunk sequence".into()) } else { Ok(()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn simple_ready() { let mut d = Decoder::default(); assert_eq!(d.push(br#"{"type":"ready","protocolVersion":1}"#).unwrap().unwrap()["type"], "ready"); }
    #[test]
    fn chunked_multibyte() {
        let v = json!({"type":"response","data":{"text":"\u{1f44b}\u{1f44b}"}});
        let bytes = v.to_string().into_bytes();
        let split = bytes.len() / 2;
        let mut d = Decoder::default();
        for (i, piece) in [bytes[..split].to_vec(), bytes[split..].to_vec()].iter().enumerate() {
            let chunk = json!({"type":"rpc_chunk","chunkId":"test","index":i,"count":2,"byteLength":bytes.len(),"data":STANDARD.encode(piece)});
            let result = d.push(chunk.to_string().as_bytes()).unwrap();
            if i == 0 { assert!(result.is_none()); } else { assert_eq!(result.unwrap(),v); }
        }
    }
    #[test]
    fn interleaving_rejected() {
        let mut d=Decoder::default();
        let a=json!({"type":"rpc_chunk","chunkId":"x","index":0,"count":2,"byteLength":5,"data":STANDARD.encode(b"ab")});
        d.push(a.to_string().as_bytes()).unwrap();
        assert!(d.push(br#"{"type":"response"}"#).is_err());
        assert!(d.finish().is_err());
    }
}
