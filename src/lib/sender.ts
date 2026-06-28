import {
  CHUNK_SIZE,
  BUFFER_HIGH_THRESHOLD,
  BUFFER_LOW_THRESHOLD,
} from '@/constants/transfer';
import { buildChunk, calcTotalChunks } from '@/lib/chunkUtils';
import type { PeerConnection } from '@/lib/webrtc';
import type { FileMeta, HashPart, HashDone, TransferDone } from '@/types/transfer';

const HASHES_PER_PART = 1000;

export class FileSender {
  private readonly pc: PeerConnection;
  private aborted = false;

  constructor(pc: PeerConnection) {
    this.pc = pc;
  }

  abort() {
    this.aborted = true;
  }

  async sendFile(
    file: File,
    fileId: string,
    chunkHashes: string[],
    fileHash: string,
    readySignal: Promise<Set<number>>, // READY/RESUME 수신 시 resolve
    onProgress: (sent: number) => void,
  ): Promise<void> {
    const totalChunks = calcTotalChunks(file.size);
    const totalHashParts = Math.ceil(chunkHashes.length / HASHES_PER_PART);

    // 1. FILE_META
    const meta: FileMeta = {
      type: 'FILE_META',
      fileId,
      fileName: file.name,
      fileSize: file.size,
      chunkSize: CHUNK_SIZE,
      totalChunks,
      totalHashParts,
    };
    this.pc.sendText(JSON.stringify(meta));

    // 2. HASH_PART 배치 전송
    for (let partIndex = 0; partIndex < totalHashParts; partIndex++) {
      const start = partIndex * HASHES_PER_PART;
      const part: HashPart = {
        type: 'HASH_PART',
        fileId,
        partIndex,
        hashes: chunkHashes.slice(start, start + HASHES_PER_PART),
      };
      this.pc.sendText(JSON.stringify(part));
    }

    // 3. HASH_DONE
    const hashDone: HashDone = { type: 'HASH_DONE', fileId, fileHash };
    this.pc.sendText(JSON.stringify(hashDone));

    // 4. 수신측 READY / RESUME 대기 후 청크 전송
    //    abort 시에도 무한 대기가 되지 않도록 race
    const receivedIndices = await Promise.race([
      readySignal,
      new Promise<null>((resolve) => {
        const poll = setInterval(() => {
          if (this.aborted) {
            clearInterval(poll);
            resolve(null);
          }
        }, 50);
      }),
    ]);

    if (!receivedIndices || this.aborted) return;

    const pendingIndices: number[] = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!receivedIndices.has(i)) pendingIndices.push(i);
    }

    await this.sendChunks(file, fileId, pendingIndices, onProgress);

    // 5. TRANSFER_DONE
    if (!this.aborted) {
      const done: TransferDone = { type: 'TRANSFER_DONE', fileId };
      this.pc.sendText(JSON.stringify(done));
    }
  }

  private async sendChunks(
    file: File,
    _fileId: string,
    indices: number[],
    onProgress: (sent: number) => void,
  ): Promise<void> {
    this.pc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

    // pending을 공유해 sendNext 재호출(백프레셔) 시에도 모든 프로미스를 추적
    const pending: Promise<void>[] = [];

    return new Promise((resolve) => {
      let cursor = 0;

      const sendNext = () => {
        while (cursor < indices.length && !this.aborted) {
          if (this.pc.bufferedAmount > BUFFER_HIGH_THRESHOLD) {
            this.pc.onBufferedAmountLow(sendNext);
            return;
          }

          const chunkIndex = indices[cursor++];
          const start = chunkIndex * CHUNK_SIZE;
          const slice = file.slice(start, start + CHUNK_SIZE);

          const p = slice.arrayBuffer().then((data) => {
            const packet = buildChunk(chunkIndex, data);
            this.pc.sendBinary(packet);
            onProgress(cursor);
          });
          pending.push(p);
        }

        // 모든 arrayBuffer → sendBinary가 끝난 뒤 resolve (Bug 4)
        if (cursor >= indices.length || this.aborted) {
          void Promise.all(pending).then(() => resolve());
        }
      };

      sendNext();
    });
  }
}
