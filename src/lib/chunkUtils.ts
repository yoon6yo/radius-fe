import { CHUNK_SIZE } from '@/constants/transfer';

export function buildChunk(chunkIndex: number, data: ArrayBuffer): ArrayBuffer {
  const buf = new ArrayBuffer(4 + data.byteLength);
  new DataView(buf).setUint32(0, chunkIndex, true);
  new Uint8Array(buf, 4).set(new Uint8Array(data));
  return buf;
}

export function parseChunk(buf: ArrayBuffer): { chunkIndex: number; data: ArrayBuffer } {
  return {
    chunkIndex: new DataView(buf).getUint32(0, true),
    data: buf.slice(4),
  };
}

export function calcTotalChunks(fileSize: number, chunkSize = CHUNK_SIZE): number {
  return Math.ceil(fileSize / chunkSize);
}

export function generateFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
