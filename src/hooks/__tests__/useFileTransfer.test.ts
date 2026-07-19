import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileTransfer } from '@/hooks/useFileTransfer';
import { useTransferStore } from '@/store/transferStore';
import { useRoomStore } from '@/store/roomStore';
import type { PeerConnection } from '@/lib/webrtc';

// ── 수집 변수: 각 테스트에서 readySignal을 꺼내기 위한 슬롯 ──────
let capturedReadySignal: Promise<Set<number>> | null = null;

vi.mock('@/lib/sender', () => {
  class FileSender {
    get isAborted() { return false; }
    async sendFile(
      _file: File,
      _id: string,
      _hashes: string[],
      _fileHash: string,
      readySignal: Promise<Set<number>>,
    ): Promise<void> {
      capturedReadySignal = readySignal;
      await readySignal;
    }
    abort() {}
  }
  return { FileSender };
});

function createMockPc() {
  return {
    sendText: vi.fn(),
    sendBinary: vi.fn(),
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    onBufferedAmountLow: vi.fn(),
  } as unknown as PeerConnection;
}

beforeEach(() => {
  capturedReadySignal = null;
  useTransferStore.getState().reset();
  useRoomStore.getState().reset();
});

describe('resolveReady', () => {
  it('READY 메시지가 오면 startSending이 완료된다', async () => {
    useRoomStore.getState().setRoom('T', 'offerer', Date.now() + 9999);
    const { result } = renderHook(() =>
      useFileTransfer({ getPeerConnection: () => createMockPc() }),
    );

    const file = new File([new Uint8Array(64)], 'a.bin');
    await act(async () => {
      useTransferStore.getState().addFiles([file]);
    });
    const { fileId } = useTransferStore.getState().queue[0];

    const sendingPromise = result.current.startSending(
      new Map([[fileId, []]]),
      new Map([[fileId, '']]),
      () => Promise.resolve(), // 이 테스트에선 해시가 이미 map에 있어 호출되지 않음
    );

    // readySignal 등록 후 READY 해소 → 이후 verifySignal도 해소해야 startSending 완료
    await vi.waitFor(() => expect(capturedReadySignal).not.toBeNull());
    await act(async () => {
      result.current.resolveReady({ type: 'READY', fileId });
    });
    await act(async () => {
      result.current.resolveVerify({ type: 'VERIFY_OK', fileId });
    });

    await sendingPromise;
    expect(useTransferStore.getState().queue[0].status).toBe('done');
  });

  it('RESUME 메시지가 오면 receivedIndices(Set)으로 resolve된다', async () => {
    useRoomStore.getState().setRoom('T', 'offerer', Date.now() + 9999);
    const { result } = renderHook(() =>
      useFileTransfer({ getPeerConnection: () => createMockPc() }),
    );

    const file = new File([new Uint8Array(64)], 'b.bin');
    await act(async () => {
      useTransferStore.getState().addFiles([file]);
    });
    const { fileId } = useTransferStore.getState().queue[0];

    const sendingPromise = result.current.startSending(
      new Map([[fileId, []]]),
      new Map([[fileId, '']]),
      () => Promise.resolve(), // 이 테스트에선 해시가 이미 map에 있어 호출되지 않음
    );

    await vi.waitFor(() => expect(capturedReadySignal).not.toBeNull());

    await act(async () => {
      result.current.resolveReady({ type: 'RESUME', fileId, receivedIndices: [0, 1] });
    });

    // capturedReadySignal이 [0,1] Set으로 resolve됐는지 검증
    const indices = await capturedReadySignal!;
    expect([...indices].sort((a, b) => a - b)).toEqual([0, 1]);

    await act(async () => {
      result.current.resolveVerify({ type: 'VERIFY_OK', fileId });
    });

    await sendingPromise;
  });

  it('알 수 없는 fileId의 READY는 무시된다', async () => {
    const { result } = renderHook(() =>
      useFileTransfer({ getPeerConnection: () => createMockPc() }),
    );
    expect(() => {
      result.current.resolveReady({ type: 'READY', fileId: 'unknown' });
    }).not.toThrow();
  });
});

describe('startSending: 파일별 해시 대기', () => {
  it('해당 파일의 해시가 아직 map에 없으면 waitForHashReady를 기다린 뒤에야 전송을 시작한다', async () => {
    // 여러 파일을 큐에 넣어도 "전부 해싱 끝날 때까지" 기다리지 않고, 그 파일 차례가
    // 왔을 때 그 파일 하나만 기다려야 한다 — 이 대기 메커니즘 자체를 검증.
    useRoomStore.getState().setRoom('T', 'offerer', Date.now() + 9999);
    const { result } = renderHook(() =>
      useFileTransfer({ getPeerConnection: () => createMockPc() }),
    );

    const file = new File([new Uint8Array(64)], 'c.bin');
    await act(async () => {
      useTransferStore.getState().addFiles([file]);
    });
    const { fileId } = useTransferStore.getState().queue[0];

    let resolveHash: () => void = () => {};
    const waitForHashReady = vi.fn(
      () => new Promise<void>((resolve) => { resolveHash = resolve; }),
    );

    const sendingPromise = result.current.startSending(
      new Map(), // 이 fileId의 해시가 아직 없음
      new Map(),
      waitForHashReady,
    );

    await vi.waitFor(() => expect(waitForHashReady).toHaveBeenCalledWith(fileId));
    // 해시가 준비되기 전에는 아직 sendFile이 호출되지 않아야 함
    expect(capturedReadySignal).toBeNull();
    expect(useTransferStore.getState().queue[0].status).toBe('hashing');

    resolveHash();
    await vi.waitFor(() => expect(capturedReadySignal).not.toBeNull());

    await act(async () => {
      result.current.resolveReady({ type: 'READY', fileId });
    });
    await act(async () => {
      result.current.resolveVerify({ type: 'VERIFY_OK', fileId });
    });

    await sendingPromise;
    expect(useTransferStore.getState().queue[0].status).toBe('done');
  });

  it('해당 파일의 해시가 이미 map에 있으면 waitForHashReady를 호출하지 않는다', async () => {
    useRoomStore.getState().setRoom('T', 'offerer', Date.now() + 9999);
    const { result } = renderHook(() =>
      useFileTransfer({ getPeerConnection: () => createMockPc() }),
    );

    const file = new File([new Uint8Array(64)], 'd.bin');
    await act(async () => {
      useTransferStore.getState().addFiles([file]);
    });
    const { fileId } = useTransferStore.getState().queue[0];

    const waitForHashReady = vi.fn(() => Promise.resolve());

    const sendingPromise = result.current.startSending(
      new Map([[fileId, []]]),
      new Map([[fileId, '']]),
      waitForHashReady,
    );

    await vi.waitFor(() => expect(capturedReadySignal).not.toBeNull());
    expect(waitForHashReady).not.toHaveBeenCalled();

    await act(async () => {
      result.current.resolveReady({ type: 'READY', fileId });
    });
    await act(async () => {
      result.current.resolveVerify({ type: 'VERIFY_OK', fileId });
    });

    await sendingPromise;
  });
});
