/**
 * Reference decoder and fixture harness for OMP RPC transport v1/v2.
 * Production owns the framed pipe in Rust. This JS decoder is used in tests
 * to lock the wire contract and deliberately reject lossy/interleaved frames.
 * The initial ready/negotiation response are physical v1 frames.
 */
export const MAX_PHYSICAL_BYTES = 1_048_576;
export const MAX_REASSEMBLED_BYTES = 67_108_864;
const MAX_CHUNKS = 8192;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export class RpcFrameDecoder {
  constructor({ maxFrameBytes = MAX_PHYSICAL_BYTES, maxReassembledFrameBytes = MAX_REASSEMBLED_BYTES } = {}) {
    this.maxFrameBytes = maxFrameBytes;
    this.maxReassembledFrameBytes = maxReassembledFrameBytes;
    this.pending = null;
  }
  push(line) {
    const bytes = typeof line === 'string' ? Buffer.from(line, 'utf8') : Buffer.from(line);
    if (bytes.length > this.maxFrameBytes) throw new Error('rpc: physical frame too large');
    const frame = JSON.parse(utf8.decode(bytes).trim());
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('rpc: object frame required');
    if (frame.type !== 'rpc_chunk') {
      if (this.pending) throw new Error('rpc: chunk stream interrupted');
      return frame;
    }
    const { chunkId, index, count, byteLength, data } = frame;
    if (typeof chunkId !== 'string' || !chunkId || chunkId.length > 128 ||
        !Number.isSafeInteger(index) || !Number.isSafeInteger(count) ||
        !Number.isSafeInteger(byteLength) || count <= 0 || count > MAX_CHUNKS ||
        index < 0 || index >= count || byteLength < 1 ||
        byteLength > this.maxReassembledFrameBytes ||
        typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      throw new Error('rpc: invalid chunk envelope');
    }
    const b = Buffer.from(data, 'base64');
    if (!b.length || b.toString('base64') !== data) throw new Error('rpc: invalid base64 chunk');
    if (!this.pending) {
      if (index !== 0) throw new Error('rpc: first chunk must have index 0');
      this.pending = { chunkId, count, byteLength, nextIndex: 0, parts: [], size: 0 };
    }
    const p = this.pending;
    if (chunkId !== p.chunkId || count !== p.count || byteLength !== p.byteLength || index !== p.nextIndex) {
      this.pending = null; throw new Error('rpc: chunk sequence mismatch');
    }
    p.size += b.length;
    if (p.size > p.byteLength || p.size > this.maxReassembledFrameBytes) {
      this.pending = null; throw new Error('rpc: reassembly overflow');
    }
    p.parts.push(b); p.nextIndex++;
    if (p.nextIndex !== p.count) return null;
    this.pending = null;
    if (p.size !== p.byteLength) throw new Error('rpc: reassembled length mismatch');
    const output = JSON.parse(utf8.decode(Buffer.concat(p.parts, p.size)));
    if (!output || typeof output !== 'object' || Array.isArray(output) || output.type === 'rpc_chunk') {
      throw new Error('rpc: invalid reassembled object');
    }
    return output;
  }
  finish() { if (this.pending) throw new Error('rpc: truncated chunk stream'); }
}

export function encodeFixtureChunks(object, splitAt = 32) {
  const bytes = Buffer.from(JSON.stringify(object));
  const slices = [];
  for (let i = 0; i < bytes.length; i += splitAt) slices.push(bytes.subarray(i, i + splitAt));
  return slices.map((b, i) => ({ type:'rpc_chunk', chunkId:'fixture-1', index:i, count:slices.length, byteLength:bytes.length, data:b.toString('base64') }));
}
