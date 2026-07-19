// Web Worker — 메인 스레드 블로킹 없이 해시 계산
import { Fnv1aStream } from '@/lib/fnv1a';

const FILE_READ_CHUNK_SIZE = 65536; // HASH_FILE 스트리밍 시 사용하는 읽기 단위 (전체를 메모리에 올리지 않기 위함)

// 청크별 무결성 검증(sha256Hex, native WebCrypto)이 실제 보안 경계를 담당하므로,
// 전체 파일 체크는 OPFS 쓰기 경로 버그 등을 잡아내는 보조 역할이면 충분하다.
// 파일이 이 크기 이하면 메모리에 전부 올려도 실질적 위험이 적으므로 네이티브 SHA-256을
// 그대로 쓰고, 이 크기를 넘는 파일만 훨씬 빠르고 O(1) 메모리인 FNV-1a 스트리밍 체크섬을
// 쓴다 (132MB 기준 벤치마크: 순수 JS SHA-256 스트리밍 823ms → FNV-1a 132ms, 네이티브보다도 빠름).
const LARGE_FILE_STREAM_THRESHOLD = 256 * 1024 * 1024; // 256MB

export type HashWorkerRequest =
  | { type: 'HASH_CHUNKS'; fileId: string; file: File; chunkSize: number }
  | { type: 'HASH_BUFFER'; fileId: string; buffer: ArrayBuffer; chunkIndex: number }
  | { type: 'HASH_FILE'; fileId: string; file: File };

export type HashWorkerResponse =
  | { type: 'CHUNK_HASH'; fileId: string; chunkIndex: number; hash: string }
  | { type: 'CHUNKS_DONE'; fileId: string; hashes: string[]; fileHash: string }
  | { type: 'FILE_HASH'; fileId: string; hash: string }
  | { type: 'BUFFER_HASH'; fileId: string; chunkIndex: number; hash: string }
  | { type: 'ERROR'; fileId: string; message: string };

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 파일을 청크 단위로 순회하며 Fnv1aStream에 누적 — 전체를 한 번에 메모리에 올리지 않는다.
async function streamFileHash(file: File): Promise<string> {
  const stream = new Fnv1aStream();
  for (let offset = 0; offset < file.size; offset += FILE_READ_CHUNK_SIZE) {
    const slice = file.slice(offset, offset + FILE_READ_CHUNK_SIZE);
    const buf = await slice.arrayBuffer();
    stream.update(new Uint8Array(buf));
  }
  return stream.digestHex();
}

// 파일 크기에 따라 네이티브 SHA-256(작은 파일) / FNV-1a 스트리밍(큰 파일)을 선택한다.
async function computeFileHash(file: File): Promise<string> {
  if (file.size <= LARGE_FILE_STREAM_THRESHOLD) {
    return sha256Hex(await file.arrayBuffer());
  }
  return streamFileHash(file);
}

self.onmessage = async (event: MessageEvent<HashWorkerRequest>) => {
  const msg = event.data;

  try {
    if (msg.type === 'HASH_CHUNKS') {
      const { fileId, file, chunkSize } = msg;
      const totalChunks = Math.ceil(file.size / chunkSize);
      const hashes: string[] = [];
      // 큰 파일만 청크 해시와 같은 read pass 안에서 전체 파일 체크섬을 FNV-1a로 누적
      // (메모리 안전, 빠름). 그 이하 크기는 아래에서 네이티브 SHA-256을 한 번에 계산한다.
      const needsStreaming = file.size > LARGE_FILE_STREAM_THRESHOLD;
      const fileHasher = needsStreaming ? new Fnv1aStream() : null;

      for (let i = 0; i < totalChunks; i++) {
        const slice = file.slice(i * chunkSize, (i + 1) * chunkSize);
        const buf = await slice.arrayBuffer();
        fileHasher?.update(new Uint8Array(buf));
        const hash = await sha256Hex(buf);
        hashes.push(hash);

        const response: HashWorkerResponse = {
          type: 'CHUNK_HASH',
          fileId,
          chunkIndex: i,
          hash,
        };
        self.postMessage(response);
      }

      const fileHash = fileHasher ? fileHasher.digestHex() : await computeFileHash(file);
      const done: HashWorkerResponse = {
        type: 'CHUNKS_DONE',
        fileId,
        hashes,
        fileHash,
      };
      self.postMessage(done);
      return;
    }

    if (msg.type === 'HASH_BUFFER') {
      const { fileId, buffer, chunkIndex } = msg;
      const hash = await sha256Hex(buffer);
      const response: HashWorkerResponse = {
        type: 'BUFFER_HASH',
        fileId,
        chunkIndex,
        hash,
      };
      self.postMessage(response);
      return;
    }

    if (msg.type === 'HASH_FILE') {
      const { fileId, file } = msg;
      const hash = await computeFileHash(file);
      const response: HashWorkerResponse = { type: 'FILE_HASH', fileId, hash };
      self.postMessage(response);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const response: HashWorkerResponse = {
      type: 'ERROR',
      fileId: msg.fileId,
      message: errMsg,
    };
    self.postMessage(response);
  }
};
