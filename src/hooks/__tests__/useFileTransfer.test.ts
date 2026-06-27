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
    );

    // readySignal이 등록된 후 READY로 해소
    await vi.waitFor(() => expect(capturedReadySignal).not.toBeNull());
    await act(async () => {
      result.current.resolveReady({ type: 'READY', fileId });
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
    );

    await vi.waitFor(() => expect(capturedReadySignal).not.toBeNull());

    await act(async () => {
      result.current.resolveReady({ type: 'RESUME', fileId, receivedIndices: [0, 1] });
    });

    // capturedReadySignal이 [0,1] Set으로 resolve됐는지 검증
    const indices = await capturedReadySignal!;
    expect([...indices].sort((a, b) => a - b)).toEqual([0, 1]);

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
