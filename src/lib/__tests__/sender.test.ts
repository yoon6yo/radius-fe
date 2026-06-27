import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileSender } from '@/lib/sender';
import { CHUNK_SIZE } from '@/constants/transfer';
import { parseChunk } from '@/lib/chunkUtils';
import type { FileMeta, HashPart, HashDone, TransferDone } from '@/types/transfer';
import type { PeerConnection } from '@/lib/webrtc';

// PeerConnection의 공개 인터페이스만 구현한 mock
function createMockPc() {
  const sentText: string[] = [];
  const sentBinary: ArrayBuffer[] = [];
  let lowHandler: (() => void) | null = null;

  const pc = {
    sentText,
    sentBinary,
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    sendText: vi.fn((msg: string) => sentText.push(msg)),
    sendBinary: vi.fn((buf: ArrayBuffer) => sentBinary.push(buf)),
    onBufferedAmountLow: vi.fn((h: () => void) => { lowHandler = h; }),
    // 버퍼 소진 시뮬레이션
    drainBuffer() {
      this.bufferedAmount = 0;
      lowHandler?.();
    },
  } as unknown as PeerConnection & { sentText: string[]; sentBinary: ArrayBuffer[]; drainBuffer(): void };

  return pc;
}

function makeFile(size: number, name = 'test.bin'): File {
  return new File([new Uint8Array(size).fill(0xaa)], name);
}

describe('FileSender.sendFile', () => {
  let pc: ReturnType<typeof createMockPc>;
  let sender: FileSender;

  beforeEach(() => {
    pc = createMockPc();
    sender = new FileSender(pc);
  });

  it('FILE_META를 첫 번째로 전송한다', async () => {
    const file = makeFile(100);
    await sender.sendFile(file, 'fid', [], '', new Set(), vi.fn());

    const meta: FileMeta = JSON.parse(pc.sentText[0]) as FileMeta;
    expect(meta.type).toBe('FILE_META');
    expect(meta.fileId).toBe('fid');
    expect(meta.fileName).toBe('test.bin');
    expect(meta.fileSize).toBe(100);
  });

  it('HASH_PART를 해시 수에 맞게 전송한다', async () => {
    const hashes = Array.from({ length: 2500 }, (_, i) => `hash${i}`);
    const file = makeFile(10);
    await sender.sendFile(file, 'fid', hashes, 'fileHash', new Set(), vi.fn());

    const parts = pc.sentText
      .map((t) => JSON.parse(t) as { type: string })
      .filter((m) => m.type === 'HASH_PART') as HashPart[];

    // 2500 hashes / 1000 per part = 3 parts
    expect(parts).toHaveLength(3);
    expect(parts[0].hashes).toHaveLength(1000);
    expect(parts[1].hashes).toHaveLength(1000);
    expect(parts[2].hashes).toHaveLength(500);
  });

  it('HASH_DONE에 fileHash를 포함한다', async () => {
    await sender.sendFile(makeFile(10), 'fid', ['h0'], 'myhash', new Set(), vi.fn());

    const done = pc.sentText
      .map((t) => JSON.parse(t) as { type: string; fileHash?: string })
      .find((m) => m.type === 'HASH_DONE') as HashDone;

    expect(done.fileHash).toBe('myhash');
  });

  it('receivedIndices에 있는 청크는 전송하지 않는다', async () => {
    // 3청크 파일에서 0, 2번 청크는 이미 받음
    const file = makeFile(CHUNK_SIZE * 3);
    const received = new Set([0, 2]);
    const onProgress = vi.fn();

    await sender.sendFile(file, 'fid', [], '', received, onProgress);
    // 마이크로태스크 큐 소진 (void arrayBuffer().then() 처리)
    await new Promise((r) => setTimeout(r, 0));

    const binaryCount = pc.sentBinary.length;
    expect(binaryCount).toBe(1); // 청크 1번만 전송
    const { chunkIndex } = parseChunk(pc.sentBinary[0]);
    expect(chunkIndex).toBe(1);
  });

  it('TRANSFER_DONE을 마지막으로 전송한다', async () => {
    await sender.sendFile(makeFile(10), 'fid', [], '', new Set(), vi.fn());

    const last = pc.sentText[pc.sentText.length - 1];
    const msg: TransferDone = JSON.parse(last) as TransferDone;
    expect(msg.type).toBe('TRANSFER_DONE');
  });

  it('abort() 호출 시 청크 전송을 중단한다', async () => {
    const file = makeFile(CHUNK_SIZE * 10);
    const sendPromise = sender.sendFile(file, 'fid', [], '', new Set(), vi.fn());
    sender.abort();
    await sendPromise;
    await new Promise((r) => setTimeout(r, 0));

    // abort 후엔 TRANSFER_DONE도 전송하지 않음
    const textMsgs = pc.sentText.map((t) => JSON.parse(t) as { type: string });
    expect(textMsgs.find((m) => m.type === 'TRANSFER_DONE')).toBeUndefined();
  });

  it('onProgress 콜백이 전송된 청크 수를 전달한다', async () => {
    const file = makeFile(CHUNK_SIZE * 2);
    const onProgress = vi.fn();
    await sender.sendFile(file, 'fid', [], '', new Set(), onProgress);
    await new Promise((r) => setTimeout(r, 0));

    expect(onProgress).toHaveBeenCalled();
  });

  it('텍스트 메시지 순서: FILE_META → HASH_PART... → HASH_DONE → TRANSFER_DONE', async () => {
    await sender.sendFile(makeFile(10), 'fid', ['h0'], 'fh', new Set(), vi.fn());

    const types = pc.sentText.map((t) => (JSON.parse(t) as { type: string }).type);
    expect(types[0]).toBe('FILE_META');
    expect(types[types.length - 1]).toBe('TRANSFER_DONE');
    const hashDoneIdx = types.indexOf('HASH_DONE');
    const lastHashPartIdx = types.lastIndexOf('HASH_PART');
    expect(hashDoneIdx).toBeGreaterThan(lastHashPartIdx);
  });
});
