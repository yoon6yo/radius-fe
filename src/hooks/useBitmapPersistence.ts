import { useCallback, useRef } from 'react';
import {
  saveTransfer,
  getTransfer,
  updateReceivedIndices,
  markTransferDone,
  getPendingTransfersByToken,
} from '@/lib/indexeddb';
import { PROGRESS_UPDATE_MS } from '@/constants/transfer';
import type { TransferRecord } from '@/types/transfer';

export function useBitmapPersistence() {
  const flushTimerRef = useRef<number>(0);
  const pendingBitmapRef = useRef<Map<string, number[]>>(new Map());

  // ── 전송 레코드 초기화 ───────────────────────────────────────
  const initTransferRecord = useCallback(
    async (record: Omit<TransferRecord, 'receivedIndices' | 'status'>): Promise<number[]> => {
      const existing = await getTransfer(record.fileId);
      if (existing && existing.status === 'pending') {
        // 이어받기: 기존 비트맵 복원
        return existing.receivedIndices;
      }
      await saveTransfer({ ...record, receivedIndices: [], status: 'pending' });
      return [];
    },
    [],
  );

  // ── 청크 수신 기록 (throttle하여 IndexedDB 쓰기 오버헤드 감소) ─
  const recordChunkReceived = useCallback((fileId: string, chunkIndex: number) => {
    const current = pendingBitmapRef.current.get(fileId) ?? [];
    current.push(chunkIndex);
    pendingBitmapRef.current.set(fileId, current);

    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => {
      for (const [fid, indices] of pendingBitmapRef.current) {
        void updateReceivedIndices(fid, indices);
      }
      pendingBitmapRef.current.clear();
    }, PROGRESS_UPDATE_MS);
  }, []);

  // ── 강제 flush (탭 닫기 전, 파일 완료 시) ────────────────────
  const flushNow = useCallback(async (fileId: string) => {
    clearTimeout(flushTimerRef.current);
    const indices = pendingBitmapRef.current.get(fileId);
    if (indices) {
      await updateReceivedIndices(fileId, indices);
      pendingBitmapRef.current.delete(fileId);
    }
  }, []);

  // ── 전송 완료 처리 ───────────────────────────────────────────
  const completeTransfer = useCallback(async (fileId: string) => {
    await flushNow(fileId);
    await markTransferDone(fileId);
  }, [flushNow]);

  // ── 재진입 시 미완료 전송 목록 조회 ─────────────────────────
  const getPendingTransfers = useCallback(
    (token: string) => getPendingTransfersByToken(token),
    [],
  );

  // ── 특정 파일의 수신 인덱스 조회 ─────────────────────────────
  const getReceivedIndices = useCallback(async (fileId: string): Promise<number[]> => {
    const record = await getTransfer(fileId);
    return record?.receivedIndices ?? [];
  }, []);

  return {
    initTransferRecord,
    recordChunkReceived,
    flushNow,
    completeTransfer,
    getPendingTransfers,
    getReceivedIndices,
  };
}
