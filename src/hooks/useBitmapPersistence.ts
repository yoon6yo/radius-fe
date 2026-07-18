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

const FLUSH_INTERVAL_MS = PROGRESS_UPDATE_MS;

export function useBitmapPersistence() {
  const pendingBitmapRef = useRef<Map<string, number[]>>(new Map());
  const lastFlushTimeRef = useRef<number>(0);
  const flushTimerRef = useRef<number>(0);

  // ── 전송 레코드 초기화 ───────────────────────────────────────
  const initTransferRecord = useCallback(
    async (record: Omit<TransferRecord, 'receivedIndices' | 'status'>): Promise<number[]> => {
      const existing = await getTransfer(record.fileId);
      if (existing && existing.status === 'pending') {
        return existing.receivedIndices;
      }
      await saveTransfer({ ...record, receivedIndices: [], status: 'pending' });
      return [];
    },
    [],
  );

  // ── 청크 수신 기록 — leading-edge throttle ───────────────────
  // debounce만 쓰면 fast LAN에서 청크가 연속으로 오는 동안 flush가 무기한 지연됨.
  // 대신 마지막 flush 이후 FLUSH_INTERVAL_MS가 지나면 즉시 flush하고,
  // trailing-edge 타이머도 남겨서 마지막 청크도 반드시 기록함.
  const recordChunkReceived = useCallback((fileId: string, chunkIndex: number) => {
    const current = pendingBitmapRef.current.get(fileId) ?? [];
    current.push(chunkIndex);
    pendingBitmapRef.current.set(fileId, current);

    const now = Date.now();
    if (now - lastFlushTimeRef.current >= FLUSH_INTERVAL_MS) {
      // 즉시 flush (leading edge)
      clearTimeout(flushTimerRef.current);
      lastFlushTimeRef.current = now;
      for (const [fid, indices] of pendingBitmapRef.current) {
        void updateReceivedIndices(fid, indices);
      }
      pendingBitmapRef.current.clear();
    } else {
      // trailing-edge 타이머 — 마지막 청크 이후 반드시 flush
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = window.setTimeout(() => {
        lastFlushTimeRef.current = Date.now();
        for (const [fid, indices] of pendingBitmapRef.current) {
          void updateReceivedIndices(fid, indices);
        }
        pendingBitmapRef.current.clear();
      }, FLUSH_INTERVAL_MS);
    }
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
