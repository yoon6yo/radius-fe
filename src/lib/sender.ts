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

  get isAborted(): boolean {
    return this.aborted;
  }

  abort() {
    this.aborted = true;
  }

  async sendFile(
    file: File,
    fileId: string,
    chunkHashes: string[],
    fileHash: string,
    readySignal: Promise<Set<number>>,
    onProgress: (sent: number) => void,
    onSendingStart?: () => void,
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

    // 4. READY / RESUME 대기 — abort 시에도 탈출
    // setInterval id를 외부에서 캡처해야 readySignal이 먼저 resolve될 때도 정리 가능
    let abortPollId: ReturnType<typeof setInterval> | undefined;
    const abortRace = new Promise<null>((resolve) => {
      abortPollId = setInterval(() => {
        if (this.aborted) {
          clearInterval(abortPollId);
          resolve(null);
        }
      }, 50);
    });

    const receivedIndices = await Promise.race([readySignal, abortRace]);
    clearInterval(abortPollId);

    if (!receivedIndices || this.aborted) return;

    // READY/RESUME 수신 직후 → UI 상태 'transferring'으로 전환
    onSendingStart?.();

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

  // bufferedAmount는 send() 호출 "이후"에만 갱신되므로, 다음 청크를 읽기 전이 아니라
  // 방금 보낸 청크의 send() 직후에 체크해야 실제 백프레셔로 작동한다.
  // (읽기+전송을 순차 처리해 send()를 실제로 호출한 뒤 버퍼를 확인하도록 함)
  private async sendChunks(
    file: File,
    _fileId: string,
    indices: number[],
    onProgress: (sent: number) => void,
  ): Promise<void> {
    this.pc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

    for (let cursor = 0; cursor < indices.length; cursor++) {
      if (this.aborted) return;

      // 채널이 닫혔으면 즉시 abort (silent no-op 방지)
      if (!this.pc.isChannelOpen) {
        this.aborted = true;
        return;
      }

      const chunkIndex = indices[cursor];
      const start = chunkIndex * CHUNK_SIZE;
      const slice = file.slice(start, start + CHUNK_SIZE);
      const data = await slice.arrayBuffer();

      const packet = buildChunk(chunkIndex, data);
      this.pc.sendBinary(packet);
      onProgress(cursor + 1);

      if (this.pc.bufferedAmount > BUFFER_HIGH_THRESHOLD) {
        await this.waitForBufferDrain();
      }
    }
  }

  // bufferedamountlow 이벤트 또는 abort/채널 종료 중 먼저 오는 쪽에서 resolve.
  // 이벤트가 오지 않는 상황(채널 종료 등)에서도 영구 대기하지 않도록 폴링으로 탈출구를 둔다.
  private waitForBufferDrain(): Promise<void> {
    return new Promise((resolve) => {
      let pollId: ReturnType<typeof setInterval> | undefined;
      const finish = () => {
        clearInterval(pollId);
        this.pc.onBufferedAmountLow(() => {});
        resolve();
      };

      this.pc.onBufferedAmountLow(finish);
      pollId = setInterval(() => {
        if (this.aborted || !this.pc.isChannelOpen) finish();
      }, 50);
    });
  }
}
