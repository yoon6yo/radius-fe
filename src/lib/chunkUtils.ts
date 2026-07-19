import { CHUNK_SIZE, MAX_FILE_NAME_LENGTH, MAX_FILE_SIZE } from '@/constants/transfer';
import type { FileMeta } from '@/types/transfer';

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

// RTL override (right-to-left override) control characters embedded in a file name can be
// used to visually disguise a file's real extension (a classic download-spoofing trick).
// We strip C0 control chars, DEL, and Unicode bidi-control characters once at parse time so
// every downstream use (display, OPFS storage, final download name) sees the same clean name.
// Built from numeric code points (rather than typed literal characters) so this source file
// never has to contain an actual invisible/control character.
const DANGEROUS_CODE_POINT_RANGES: Array<[number, number]> = [
  [0x0000, 0x001f], // C0 controls
  [0x007f, 0x007f], // DEL
  [0x200e, 0x200f], // LRM, RLM
  [0x202a, 0x202e], // LRE, RLE, PDF, LRO, RLO
  [0x2066, 0x2069], // LRI, RLI, FSI, PDI
];

function buildDangerousFilenameCharsRegex(): RegExp {
  const body = DANGEROUS_CODE_POINT_RANGES.map(([start, end]) =>
    start === end
      ? String.fromCharCode(start)
      : String.fromCharCode(start) + '-' + String.fromCharCode(end),
  ).join('');
  return new RegExp('[' + body + ']', 'g');
}

const DANGEROUS_FILENAME_CHARS = buildDangerousFilenameCharsRegex();

export function sanitizeFileName(name: string): string {
  return name.replace(DANGEROUS_FILENAME_CHARS, '').trim() || 'file';
}

// FILE_META comes from an untrusted peer, so validate it before use instead of trusting it
// blindly (name length, size/chunk-count consistency, etc. -- reject the transfer on failure).
export function isValidFileMeta(msg: FileMeta): boolean {
  if (typeof msg.fileName !== 'string' || msg.fileName.length === 0 || msg.fileName.length > MAX_FILE_NAME_LENGTH) {
    return false;
  }
  if (!Number.isFinite(msg.fileSize) || msg.fileSize < 0 || msg.fileSize > MAX_FILE_SIZE) {
    return false;
  }
  if (msg.chunkSize !== CHUNK_SIZE) {
    return false;
  }
  if (!Number.isInteger(msg.totalChunks) || msg.totalChunks !== calcTotalChunks(msg.fileSize, msg.chunkSize)) {
    return false;
  }
  return true;
}
