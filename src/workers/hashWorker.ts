// Web Worker — 메인 스레드 블로킹 없이 해시 계산
import { Fnv1aStream } from '@/lib/fnv1a';

// HASH_FILE(수신 측 최종 재검증) 스트리밍 시 사용하는 읽기 단위 — 전송 프로토콜의
// CHUNK_SIZE(64KB)와는 별개. 전송 완료 후 큰 파일(GB급)을 통째로 재검증할 때 64KB씩
// 읽으면 비동기 read 호출이 수만~수십만 번 필요해 그 자체가 눈에 띄는 지연이 된다.
// 여기서는 실시간 진행 표시가 필요 없으므로 훨씬 큰 단위로 읽어 호출 횟수를 줄인다.
const FILE_READ_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

// 청크별 무결성 검증(sha256Hex, native WebCrypto)이 실제 보안 경계를 담당하므로,
// 전체 파일 체크는 OPFS 쓰기 경로 버그 등을 잡아내는 보조 역할이면 충분하다.
// 파일이 이 크기 이하면 메모리에 전부 올려도 실질적 위험이 적으므로 네이티브 SHA-256을
// 그대로 쓰고, 이 크기를 넘는 파일만 훨씬 빠르고 O(1) 메모리인 FNV-1a 스트리밍 체크섬을
// 쓴다 (132MB 기준 벤치마크: 순수 JS SHA-256 스트리밍 823ms → FNV-1a 132ms, 네이티브보다도 빠름).
const LARGE_FILE_STREAM_THRESHOLD = 256 * 1024 * 1024; // 256MB

// HASH_CHUNKS도 청크(64KB) 단위로 파일을 하나씩 개별적으로 읽으면, 대용량 파일에서
// 비동기 read 호출이 수만~수십만 번 필요해 그 자체가 누적 지연이 된다(10GB면 16만 회+).
// 훨씬 큰 블록 단위로 한 번에 읽어 메모리에 올린 뒤, 그 안에서 청크별로 슬라이스해
// 해시만 계산한다 — 프로토콜상의 청크 경계·해시 결과는 그대로고 파일 read 호출
// 횟수만 줄어든다(4MB 블록이면 64분의 1).
const HASH_READ_BLOCK_SIZE = 4 * 1024 * 1024; // 4MB

export type HashWorkerRequest =
  | { type: 'HASH_CHUNKS'; fileId: string; file: File; chunkSize: number }
  | { type: 'HASH_BUFFER'; fileId: string; buffer: ArrayBuffer; chunkIndex: number }
  | { type: 'HASH_FILE'; fileId: string; file: File };

export type HashWorkerResponse =
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

      // 청크별 진행 메시지를 매번 postMessage로 쏘지 않는다 — 아무도 구독하지 않는데
      // 대용량 파일(수십만 청크)에서는 이 IPC 왕복 자체가 해싱 전체 시간에 누적돼
      // 체감될 정도로 느려짐. 최종 결과(CHUNKS_DONE)만 한 번 보낸다.
      //
      // 파일도 청크 하나씩(64KB) 개별 read하지 않고, HASH_READ_BLOCK_SIZE 단위로
      // 크게 읽어서 메모리 안 블록에서 청크별로 슬라이스만 한다 — read 호출 횟수를
      // 크게 줄인다. 청크 해시 결과 자체는 동일(경계·내용 변화 없음).
      const chunksPerBlock = Math.max(1, Math.floor(HASH_READ_BLOCK_SIZE / chunkSize));
      let blockBuf = new ArrayBuffer(0);
      let blockStartChunk = 0;

      for (let i = 0; i < totalChunks; i++) {
        if (i === blockStartChunk) {
          const byteStart = i * chunkSize;
          const byteEnd = Math.min(byteStart + chunksPerBlock * chunkSize, file.size);
          blockBuf = await file.slice(byteStart, byteEnd).arrayBuffer();
        }

        const offsetInBlock = (i - blockStartChunk) * chunkSize;
        const buf = blockBuf.slice(offsetInBlock, offsetInBlock + chunkSize);
        fileHasher?.update(new Uint8Array(buf));
        const hash = await sha256Hex(buf);
        hashes.push(hash);

        if (i - blockStartChunk + 1 >= chunksPerBlock) {
          blockStartChunk = i + 1;
        }
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
