import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileReceiver } from '@/hooks/useFileReceiver';
import type { FileMeta, HashPart, HashDone, TransferDone } from '@/types/transfer';

// OPFS 관련 모듈 전체 모킹
vi.mock('@/lib/fileWriter', () => {
  const mockHandle = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    OPFSFileWriter: {
      create: vi.fn().mockResolvedValue(mockHandle),
    },
    exportFromOPFS: vi.fn().mockResolvedValue(undefined),
    deleteFromOPFS: vi.fn().mockResolvedValue(undefined),
  };
});

function makeFileMeta(override: Partial<FileMeta> = {}): FileMeta {
  return {
    type: 'FILE_META',
    fileId: 'f1',
    fileName: 'test.bin',
    fileSize: 65536 * 2,
    chunkSize: 65536,
    totalChunks: 2,
    totalHashParts: 1,
    ...override,
  };
}

function makeChunkBuffer(chunkIndex: number, size = 64): ArrayBuffer {
  const buf = new ArrayBuffer(4 + size);
  new DataView(buf).setUint32(0, chunkIndex, true);
  return buf;
}

describe('useFileReceiver', () => {
  const sendControl = vi.fn();
  const verifyChunkHash = vi.fn().mockResolvedValue(true);
  const verifyFileHash = vi.fn().mockResolvedValue(true);
  const onChunkVerified = vi.fn();
  const onTransferComplete = vi.fn().mockResolvedValue(undefined);
  const getRestoredIndices = vi.fn().mockResolvedValue([]);

  function renderReceiver() {
    return renderHook(() =>
      useFileReceiver({
        sendControl,
        verifyChunkHash,
        verifyFileHash,
        onChunkVerified,
        onTransferComplete,
        getRestoredIndices,
      }),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getRestoredIndices.mockResolvedValue([]);
    verifyChunkHash.mockResolvedValue(true);
    verifyFileHash.mockResolvedValue(true);
  });

  it('FILE_META 수신 시 receiving 상태로 전환한다', async () => {
    const { result } = renderReceiver();
    await act(async () => {
      await result.current.handleControl(makeFileMeta());
    });
    expect(result.current.state.exportPhase).toBe('receiving');
    expect(result.current.state.meta?.fileId).toBe('f1');
  });

  it('HASH_PART를 누적한다', async () => {
    const { result } = renderReceiver();
    await act(async () => {
      await result.current.handleControl(makeFileMeta());
      const part: HashPart = { type: 'HASH_PART', fileId: 'f1', partIndex: 0, hashes: ['h0', 'h1'] };
      await result.current.handleControl(part);
    });
    expect(result.current.getChunkHashes()).toEqual(['h0', 'h1']);
  });

  it('HASH_DONE 수신 시, 이전 청크 없으면 READY 전송', async () => {
    const { result } = renderReceiver();
    await act(async () => {
      await result.current.handleControl(makeFileMeta());
      const done: HashDone = { type: 'HASH_DONE', fileId: 'f1', fileHash: 'fhash' };
      await result.current.handleControl(done);
    });
    expect(sendControl).toHaveBeenCalledWith({ type: 'READY', fileId: 'f1' });
  });

  it('HASH_DONE 수신 시, 이전 청크 있으면 RESUME 전송', async () => {
    getRestoredIndices.mockResolvedValue([0]); // 0번 청크 이미 수신
    const { result } = renderReceiver();
    await act(async () => {
      await result.current.handleControl(makeFileMeta());
      const done: HashDone = { type: 'HASH_DONE', fileId: 'f1', fileHash: 'fhash' };
      await result.current.handleControl(done);
    });
    expect(sendControl).toHaveBeenCalledWith({
      type: 'RESUME',
      fileId: 'f1',
      receivedIndices: [0],
    });
  });

  it('바이너리 청크 수신 시 receivedCount가 증가한다', async () => {
    const { result } = renderReceiver();
    await act(async () => {
      await result.current.handleControl(makeFileMeta());
    });
    await act(async () => {
      await result.current.handleBinaryChunk(makeChunkBuffer(0));
    });
    expect(result.current.state.receivedCount).toBe(1);
    expect(onChunkVerified).toHaveBeenCalledWith('f1', 0);
  });

  it('이미 받은 청크는 건너뛴다', async () => {
    getRestoredIndices.mockResolvedValue([0]);
    const { result } = renderReceiver();
    await act(async () => {
      await result.current.handleControl(makeFileMeta());
    });
    const initialCount = result.current.state.receivedCount;
    await act(async () => {
      await result.current.handleBinaryChunk(makeChunkBuffer(0)); // 이미 받은 청크
    });
    expect(result.current.state.receivedCount).toBe(initialCount); // 증가 없음
    expect(onChunkVerified).not.toHaveBeenCalled();
  });

  it('청크 해시 불일치 시 비트맵에 기록하지 않는다', async () => {
    verifyChunkHash.mockResolvedValue(false);
    const { result } = renderReceiver();
    await act(async () => {
      await result.current.handleControl(makeFileMeta());
      await result.current.handleBinaryChunk(makeChunkBuffer(0));
    });
    expect(result.current.state.receivedCount).toBe(0);
    expect(onChunkVerified).not.toHaveBeenCalled();
  });

  it('TRANSFER_DONE 수신 후 파일 해시 검증이 성공하면 VERIFY_OK 전송', async () => {
    const { result } = renderReceiver();
    await act(async () => {
      await result.current.handleControl(makeFileMeta());
      const done: HashDone = { type: 'HASH_DONE', fileId: 'f1', fileHash: 'fhash' };
      await result.current.handleControl(done);
    });
    await act(async () => {
      const transferDone: TransferDone = { type: 'TRANSFER_DONE', fileId: 'f1' };
      await result.current.handleControl(transferDone);
    });
    expect(sendControl).toHaveBeenCalledWith({ type: 'VERIFY_OK', fileId: 'f1' });
    expect(result.current.state.exportPhase).toBe('done');
  });

  it('파일 해시 불일치 시 VERIFY_FAIL 전송하고 error 상태로 전환', async () => {
    verifyFileHash.mockResolvedValue(false);
    const { result } = renderReceiver();
    await act(async () => {
      await result.current.handleControl(makeFileMeta());
      const done: HashDone = { type: 'HASH_DONE', fileId: 'f1', fileHash: 'wronghash' };
      await result.current.handleControl(done);
    });
    await act(async () => {
      const transferDone: TransferDone = { type: 'TRANSFER_DONE', fileId: 'f1' };
      await result.current.handleControl(transferDone);
    });
    expect(sendControl).toHaveBeenCalledWith({
      type: 'VERIFY_FAIL',
      fileId: 'f1',
      reason: 'file_hash_mismatch',
    });
    expect(result.current.state.exportPhase).toBe('error');
  });
});
