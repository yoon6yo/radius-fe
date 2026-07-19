// Web Worker — 메인 스레드 블로킹 없이 SHA-256 해시 계산
import { Sha256Stream } from '@/lib/sha256Stream';

const FILE_READ_CHUNK_SIZE = 65536; // HASH_FILE 스트리밍 시 사용하는 읽기 단위 (전체를 메모리에 올리지 않기 위함)

// 순수 JS 스트리밍 SHA-256은 네이티브 WebCrypto보다 약 5배 느리다(132MB 기준 벤치마크:
// 순수 JS ~820ms vs 네이티브 ~160ms). 파일이 이 크기 이하면 메모리에 전부 올려도 실질적
// 위험이 적으므로 빠른 네이티브 경로를 쓰고, 이 크기를 넘는 파일만 느리지만 메모리 안전한
// 스트리밍 경로를 쓴다 — 대부분의 전송에서 전송 시작/완료 전 해싱 지연을 되돌린다.
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

// 파일을 청크 단위로 순회하며 Sha256Stream에 누적 — 전체를 한 번에 메모리에 올리지 않는다.
async function streamFileHash(file: File): Promise<string> {
  const stream = new Sha256Stream();
  for (let offset = 0; offset < file.size; offset += FILE_READ_CHUNK_SIZE) {
    const slice = file.slice(offset, offset + FILE_READ_CHUNK_SIZE);
    const buf = await slice.arrayBuffer();
    stream.update(new Uint8Array(buf));
  }
  return stream.digestHex();
}

// 파일 크기에 따라 빠른 네이티브 경로 / 느리지만 메모리 안전한 스트리밍 경로를 선택한다.
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
      // 큰 파일만 청크 해시와 같은 read pass 안에서 전체 파일 해시를 스트리밍으로 누적
      // (느리지만 메모리 안전). 그 이하 크기는 순수 JS 누적 비용을 아예 들이지 않고
      // 아래에서 네이티브로 한 번에 계산 — 대부분의 파일에서 이 루프가 더 빠르다.
      const needsStreaming = file.size > LARGE_FILE_STREAM_THRESHOLD;
      const fileHasher = needsStreaming ? new Sha256Stream() : null;

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
