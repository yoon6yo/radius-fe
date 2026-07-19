// Web Worker — 메인 스레드 블로킹 없이 SHA-256 해시 계산
import { Sha256Stream } from '@/lib/sha256Stream';

const FILE_READ_CHUNK_SIZE = 65536; // HASH_FILE 스트리밍 시 사용하는 읽기 단위 (전체를 메모리에 올리지 않기 위함)

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

self.onmessage = async (event: MessageEvent<HashWorkerRequest>) => {
  const msg = event.data;

  try {
    if (msg.type === 'HASH_CHUNKS') {
      const { fileId, file, chunkSize } = msg;
      const totalChunks = Math.ceil(file.size / chunkSize);
      const hashes: string[] = [];
      // 청크 해시와 같은 read pass 안에서 전체 파일 해시도 함께 누적 —
      // 별도로 파일을 다시 읽거나 전체를 메모리에 올릴 필요가 없다.
      const fileHasher = new Sha256Stream();

      for (let i = 0; i < totalChunks; i++) {
        const slice = file.slice(i * chunkSize, (i + 1) * chunkSize);
        const buf = await slice.arrayBuffer();
        fileHasher.update(new Uint8Array(buf));
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

      const done: HashWorkerResponse = {
        type: 'CHUNKS_DONE',
        fileId,
        hashes,
        fileHash: fileHasher.digestHex(),
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
      const hash = await streamFileHash(file);
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
