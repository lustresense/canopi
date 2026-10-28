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

pub struct Decoder {
    pending: Option<Pending>,
    /// Inbound physical-frame cap: ready `maxFrameBytes`, clamped to the hard cap.
    max_physical: usize,
    /// Logical reassembly cap: ready `maxReassembledFrameBytes`, clamped to the hard cap.
    max_reassembled: usize,
}

impl Default for Decoder {
    fn default() -> Self {
        Self { pending: None, max_physical: MAX_PHYSICAL, max_reassembled: MAX_REASSEMBLED }
    }
}

fn advertised_limit(ready: &Value, key: &str) -> Result<Option<usize>, String> {
    match ready.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => {
            let n = v.as_u64().ok_or_else(|| format!("RPC ready {key} must be an integer"))?;
            if n == 0 || n > usize::MAX as u64 { return Err(format!("RPC ready {key} out of range")); }
            Ok(Some(n as usize))
        }
    }
}

impl Decoder {
    /// Applies the transport limits advertised by the `ready` frame. Advertised
    /// values are clamped *down* to the hard caps, so a hostile or buggy engine
    /// can never widen them. Returns the outbound physical-frame limit.
    pub fn set_advertised_limits(&mut self, ready: &Value) -> Result<usize, String> {
        if let Some(physical) = advertised_limit(ready, "maxFrameBytes")? {
            self.max_physical = physical.min(MAX_PHYSICAL);
        }
        if let Some(reassembled) = advertised_limit(ready, "maxReassembledFrameBytes")? {
            // Clamp only to the hard cap: a smaller advertised value is honored as-is.
            self.max_reassembled = reassembled.min(MAX_REASSEMBLED);
        }
        Ok(self.max_physical)
    }
    /// `physical` is the frame's UTF-8 bytes without the newline terminator.
    /// Ok(None) means an incomplete v2 chunk sequence, NOT an empty event.
    pub fn push(&mut self, physical: &[u8]) -> Result<Option<Value>, String> {
        if physical.len() + 1 > self.max_physical {
            return Err(format!("RPC physical frame exceeded {} bytes", self.max_physical));
        }
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
        if id.is_empty() || id.len() > 128 || count == 0 || count > MAX_CHUNKS || index >= count || length == 0 || length > self.max_reassembled {
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
    #[test]
    fn invalid_utf8_rejected() {
        let mut d = Decoder::default();
        assert!(d.push(b"{\"type\":\"\xff\"}").is_err());
    }
    #[test]
    fn advertised_smaller_physical_limit_enforced() {
        let mut d = Decoder::default();
        let limit = d.set_advertised_limits(&json!({"maxFrameBytes":64})).unwrap();
        assert_eq!(limit, 64);
        let oversized = format!("{{\"type\":\"response\",\"pad\":\"{}\"}}", "a".repeat(80));
        assert!(d.push(oversized.as_bytes()).is_err());
        assert!(d.push(br#"{"type":"ready"}"#).is_ok());
    }
    #[test]
    fn advertised_limits_never_widen_hard_caps() {
        let mut d = Decoder::default();
        let limit = d.set_advertised_limits(&json!({"maxFrameBytes": 4_294_967_296u64, "maxReassembledFrameBytes": 4_294_967_296u64})).unwrap();
        assert_eq!(limit, MAX_PHYSICAL);
        let mut huge = Vec::with_capacity(MAX_PHYSICAL);
        huge.extend_from_slice(b"{\"type\":\"response\"");
        huge.resize(MAX_PHYSICAL, b' ');
        assert!(d.push(&huge).is_err());
        // Reassembly cap stays at the hard 64 MiB bound regardless of claims.
        assert!(d.set_advertised_limits(&json!({"maxReassembledFrameBytes": 0u64})).is_err());
    }
    #[test]
    fn advertised_limits_must_be_integers() {
        let mut d = Decoder::default();
        assert!(d.set_advertised_limits(&json!({"maxFrameBytes":"1MiB"})).is_err());
        assert!(d.set_advertised_limits(&json!({"maxReassembledFrameBytes":1.5})).is_err());
        // Absent fields keep the hard caps.
        assert_eq!(d.set_advertised_limits(&json!({})).unwrap(), MAX_PHYSICAL);
    }
    #[test]
    fn advertised_smaller_reassembled_limit_enforced() {
        let mut d = Decoder::default();
        d.set_advertised_limits(&json!({"maxReassembledFrameBytes":16})).unwrap();
        let bytes = json!({"type":"response","data":{"pad":"abcdefghijklmnopqrstuvwxyz"}}).to_string().into_bytes();
        let chunk = json!({"type":"rpc_chunk","chunkId":"t","index":0,"count":1,"byteLength":bytes.len(),"data":STANDARD.encode(&bytes)});
        assert!(d.push(chunk.to_string().as_bytes()).is_err());
    }
}
