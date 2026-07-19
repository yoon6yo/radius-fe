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

  // 디스크 읽기를 이 개수만큼 미리 앞서 진행해 send()/backpressure 대기와 겹친다.
  // 읽기는 네트워크와 무관한 로컬 I/O라 미리 해도 안전하고, 완전 직렬(읽기→전송을
  // 한 번에 하나씩만)로 처리하면 청크당 읽기 지연이 그대로 전송 속도를 깎아먹는다.
  private static readonly READ_PIPELINE_DEPTH = 8;

  // bufferedAmount는 send() 호출 "이후"에만 갱신되므로, 백프레셔 체크는 반드시
  // 실제 sendBinary() 직후에 해야 한다 — 이 부분은 읽기를 미리 하더라도 그대로 유지.
  private async sendChunks(
    file: File,
    _fileId: string,
    indices: number[],
    onProgress: (sent: number) => void,
  ): Promise<void> {
    this.pc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

    const readAt = (cursor: number): Promise<ArrayBuffer> => {
      const chunkIndex = indices[cursor];
      const start = chunkIndex * CHUNK_SIZE;
      return file.slice(start, start + CHUNK_SIZE).arrayBuffer();
    };

    const pipeline: Promise<ArrayBuffer>[] = [];
    let readCursor = 0;
    const fillPipeline = () => {
      while (readCursor < indices.length && pipeline.length < FileSender.READ_PIPELINE_DEPTH) {
        pipeline.push(readAt(readCursor));
        readCursor++;
      }
    };
    fillPipeline();

    for (let cursor = 0; cursor < indices.length; cursor++) {
      if (this.aborted) return;

      // 채널이 닫혔으면 즉시 abort (silent no-op 방지)
      if (!this.pc.isChannelOpen) {
        this.aborted = true;
        return;
      }

      const chunkIndex = indices[cursor];
      const data = await pipeline.shift()!;
      fillPipeline();

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
