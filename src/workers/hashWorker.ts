// Web Worker — 메인 스레드 블로킹 없이 SHA-256 해시 계산

export type HashWorkerRequest =
  | { type: 'HASH_CHUNKS'; fileId: string; file: File; chunkSize: number }
  | { type: 'HASH_BUFFER'; fileId: string; buffer: ArrayBuffer; chunkIndex: number }
  | { type: 'HASH_FILE'; fileId: string; file: File };

export type HashWorkerResponse =
  | { type: 'CHUNK_HASH'; fileId: string; chunkIndex: number; hash: string }
  | { type: 'CHUNKS_DONE'; fileId: string; hashes: string[] }
  | { type: 'FILE_HASH'; fileId: string; hash: string }
  | { type: 'BUFFER_HASH'; fileId: string; chunkIndex: number; hash: string }
  | { type: 'ERROR'; fileId: string; message: string };

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

self.onmessage = async (event: MessageEvent<HashWorkerRequest>) => {
  const msg = event.data;

  try {
    if (msg.type === 'HASH_CHUNKS') {
      const { fileId, file, chunkSize } = msg;
      const totalChunks = Math.ceil(file.size / chunkSize);
      const hashes: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const slice = file.slice(i * chunkSize, (i + 1) * chunkSize);
        const buf = await slice.arrayBuffer();
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

      const done: HashWorkerResponse = { type: 'CHUNKS_DONE', fileId, hashes };
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
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);
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
