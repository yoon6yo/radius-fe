import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileSender } from '@/lib/sender';
import { CHUNK_SIZE } from '@/constants/transfer';
import { parseChunk } from '@/lib/chunkUtils';
import type { FileMeta, HashPart, HashDone, TransferDone } from '@/types/transfer';
import type { PeerConnection } from '@/lib/webrtc';

function createMockPc() {
  const sentText: string[] = [];
  const sentBinary: ArrayBuffer[] = [];

  const pc = {
    sentText,
    sentBinary,
    isChannelOpen: true,
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    sendText: vi.fn((msg: string) => sentText.push(msg)),
    sendBinary: vi.fn((buf: ArrayBuffer) => sentBinary.push(buf)),
    onBufferedAmountLow: vi.fn(),
  } as unknown as PeerConnection & { sentText: string[]; sentBinary: ArrayBuffer[] };

  return pc;
}

function makeFile(size: number, name = 'test.bin'): File {
  return new File([new Uint8Array(size).fill(0xaa)], name);
}

/** 즉시 resolve되는 readySignal */
function immediateReady(received: number[] = []): Promise<Set<number>> {
  return Promise.resolve(new Set(received));
}

describe('FileSender.sendFile', () => {
  let pc: ReturnType<typeof createMockPc>;
  let sender: FileSender;

  beforeEach(() => {
    pc = createMockPc();
    sender = new FileSender(pc);
  });

  it('FILE_META를 첫 번째로 전송한다', async () => {
    await sender.sendFile(makeFile(100), 'fid', [], '', immediateReady(), vi.fn());

    const meta: FileMeta = JSON.parse(pc.sentText[0]) as FileMeta;
    expect(meta.type).toBe('FILE_META');
    expect(meta.fileId).toBe('fid');
    expect(meta.fileName).toBe('test.bin');
    expect(meta.fileSize).toBe(100);
  });

  it('HASH_PART를 1000개 단위 배치로 전송한다', async () => {
    const hashes = Array.from({ length: 2500 }, (_, i) => `hash${i}`);
    await sender.sendFile(makeFile(10), 'fid', hashes, 'fileHash', immediateReady(), vi.fn());

    const parts = pc.sentText
      .map((t) => JSON.parse(t) as { type: string })
      .filter((m) => m.type === 'HASH_PART') as HashPart[];

    expect(parts).toHaveLength(3);
    expect(parts[0].hashes).toHaveLength(1000);
    expect(parts[2].hashes).toHaveLength(500);
  });

  it('HASH_DONE에 fileHash가 포함된다', async () => {
    await sender.sendFile(makeFile(10), 'fid', ['h0'], 'myhash', immediateReady(), vi.fn());

    const done = pc.sentText
      .map((t) => JSON.parse(t) as { type: string; fileHash?: string })
      .find((m) => m.type === 'HASH_DONE') as HashDone;

    expect(done.fileHash).toBe('myhash');
  });

  it('readySignal이 resolve되기 전에는 청크를 전송하지 않는다', async () => {
    let resolveReady!: (s: Set<number>) => void;
    const readySignal = new Promise<Set<number>>((r) => { resolveReady = r; });

    const sendPromise = sender.sendFile(makeFile(CHUNK_SIZE), 'fid', [], '', readySignal, vi.fn());

    // HASH_DONE까지는 전송됐지만 아직 readySignal 미해소 → 청크 없음
    await Promise.resolve(); // 마이크로태스크 한 턴
    expect(pc.sentBinary).toHaveLength(0);

    resolveReady(new Set());
    await sendPromise;
    await new Promise((r) => setTimeout(r, 0));
    expect(pc.sentBinary).toHaveLength(1);
  });

  it('RESUME receivedIndices에 있는 청크는 전송하지 않는다', async () => {
    const file = makeFile(CHUNK_SIZE * 3);
    // 0, 2번 청크는 이미 수신됨
    await sender.sendFile(file, 'fid', [], '', immediateReady([0, 2]), vi.fn());
    await new Promise((r) => setTimeout(r, 0));

    expect(pc.sentBinary).toHaveLength(1);
    const { chunkIndex } = parseChunk(pc.sentBinary[0]);
    expect(chunkIndex).toBe(1);
  });

  it('READY (빈 Set)이면 모든 청크를 전송한다', async () => {
    const totalChunks = 3;
    await sender.sendFile(makeFile(CHUNK_SIZE * totalChunks), 'fid', [], '', immediateReady([]), vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    expect(pc.sentBinary).toHaveLength(totalChunks);
  });

  it('TRANSFER_DONE을 마지막으로 전송한다', async () => {
    await sender.sendFile(makeFile(10), 'fid', [], '', immediateReady(), vi.fn());

    const last = pc.sentText[pc.sentText.length - 1];
    const msg: TransferDone = JSON.parse(last) as TransferDone;
    expect(msg.type).toBe('TRANSFER_DONE');
  });

  it('abort() 호출 시 readySignal 대기에서 탈출하고 TRANSFER_DONE을 보내지 않는다', async () => {
    // 절대 resolve되지 않는 signal
    const neverReady = new Promise<Set<number>>(() => {});
    const sendPromise = sender.sendFile(makeFile(10), 'fid', [], '', neverReady, vi.fn());

    sender.abort();
    await sendPromise; // abort 감지 후 종료

    const types = pc.sentText.map((t) => (JSON.parse(t) as { type: string }).type);
    expect(types).not.toContain('TRANSFER_DONE');
    expect(pc.sentBinary).toHaveLength(0);
  });

  it('텍스트 메시지 순서: FILE_META → HASH_PART... → HASH_DONE → TRANSFER_DONE', async () => {
    await sender.sendFile(makeFile(10), 'fid', ['h0'], 'fh', immediateReady(), vi.fn());

    const types = pc.sentText.map((t) => (JSON.parse(t) as { type: string }).type);
    expect(types[0]).toBe('FILE_META');
    expect(types[types.length - 1]).toBe('TRANSFER_DONE');
    expect(types.indexOf('HASH_DONE')).toBeGreaterThan(types.lastIndexOf('HASH_PART'));
  });
});
