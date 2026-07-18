import { useCallback, useRef } from 'react';
import { useTransferStore } from '@/store/transferStore';
import { useRoomStore } from '@/store/roomStore';
import { FileSender } from '@/lib/sender';
import { CHUNK_SIZE, PROGRESS_UPDATE_MS } from '@/constants/transfer';
import { calcTotalChunks } from '@/lib/chunkUtils';
import type { PeerConnection } from '@/lib/webrtc';
import type { ReadyMsg, ResumeMsg, QueuedFile, VerifyOk, VerifyFail } from '@/types/transfer';

interface UseFileTransferOptions {
  getPeerConnection: () => PeerConnection | null;
}

export function useFileTransfer({ getPeerConnection }: UseFileTransferOptions) {
  const { lockQueue, updateFileStatus, updateProgress, advanceQueue } = useTransferStore();
  const { role } = useRoomStore();

  const senderRef = useRef<FileSender | null>(null);
  const progressTimerRef = useRef<number>(0);
  const lastProgressRef = useRef<{ time: number; bytes: number }>({ time: 0, bytes: 0 });

  // fileId → readySignal resolver (HASH_DONE 후 READY/RESUME 대기)
  const readyResolversRef = useRef<Map<string, (indices: Set<number>) => void>>(new Map());
  // fileId → verifySignal resolver (TRANSFER_DONE 후 VERIFY_OK/FAIL 대기)
  const verifyResolversRef = useRef<Map<string, (ok: boolean) => void>>(new Map());

  const resolveReady = useCallback((msg: ReadyMsg | ResumeMsg) => {
    const resolver = readyResolversRef.current.get(msg.fileId);
    if (!resolver) return;
    readyResolversRef.current.delete(msg.fileId);
    const indices =
      msg.type === 'RESUME' ? new Set(msg.receivedIndices) : new Set<number>();
    resolver(indices);
  }, []);

  const resolveVerify = useCallback((msg: VerifyOk | VerifyFail) => {
    const resolver = verifyResolversRef.current.get(msg.fileId);
    if (!resolver) return;
    verifyResolversRef.current.delete(msg.fileId);
    resolver(msg.type === 'VERIFY_OK');
  }, []);

  const startSending = useCallback(
    async (
      chunkHashesByFileId: Map<string, string[]>,
      fileHashByFileId: Map<string, string>,
    ) => {
      if (role !== 'offerer') return;
      lockQueue();

      // 스냅샷 대신 store에서 직접 읽어 클로저 스태일 방지
      const { queue: liveQueue, currentIndex: liveIndex } = useTransferStore.getState();
      for (let i = liveIndex; i < liveQueue.length; i++) {
        const item: QueuedFile = liveQueue[i];
        updateFileStatus(item.fileId, 'waiting_ready');

        // 루프 도중 파일이 제거됐을 가능성 대비 — store에서 다시 확인
        const stillExists = useTransferStore.getState().queue.some((q) => q.fileId === item.fileId);
        if (!stillExists) continue;

        const pc = getPeerConnection();
        if (!pc) break;

        const sender = new FileSender(pc);
        senderRef.current = sender;

        const readySignal = new Promise<Set<number>>((resolve) => {
          readyResolversRef.current.set(item.fileId, resolve);
        });

        const verifySignal = new Promise<boolean>((resolve) => {
          verifyResolversRef.current.set(item.fileId, resolve);
        });

        const chunkHashes = chunkHashesByFileId.get(item.fileId) ?? [];
        const fileHash = fileHashByFileId.get(item.fileId) ?? '';
        const totalChunks = calcTotalChunks(item.file.size);
        updateProgress(item.fileId, { totalChunks });

        await sender.sendFile(
          item.file,
          item.fileId,
          chunkHashes,
          fileHash,
          readySignal,
          (sent) => throttleProgress(item.fileId, sent, totalChunks),
          // READY/RESUME 수신 후 'transferring'으로 전환
          () => updateFileStatus(item.fileId, 'transferring'),
        );

        if (sender.isAborted) {
          // 채널 드롭으로 중단됨 — 대기 중이던 resolver 정리 후 재연결 대기
          readyResolversRef.current.delete(item.fileId);
          verifyResolversRef.current.delete(item.fileId);
          updateFileStatus(item.fileId, 'waiting_ready');
          break;
        }

        // TRANSFER_DONE 전송 후 수신측 검증 결과 대기 (30초 타임아웃)
        updateFileStatus(item.fileId, 'verifying');
        const verified = await Promise.race([
          verifySignal,
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30_000)),
        ]);

        if (verified) {
          updateFileStatus(item.fileId, 'done');
          advanceQueue();
        } else {
          updateFileStatus(item.fileId, 'error');
          break;
        }
      }
    },
    [role, lockQueue, updateFileStatus, updateProgress, advanceQueue, getPeerConnection],
  );

  const abortCurrent = useCallback(() => {
    senderRef.current?.abort();
  }, []);

  const throttleProgress = (fileId: string, sent: number, totalChunks: number) => {
    const now = Date.now();
    const last = lastProgressRef.current;
    if (now - last.time < PROGRESS_UPDATE_MS) return;

    const bytesSent = sent * CHUNK_SIZE;
    const elapsed = (now - last.time) / 1000;
    const speedBps = elapsed > 0 ? (bytesSent - last.bytes) / elapsed : 0;
    const remaining = totalChunks - sent;
    const etaSeconds = speedBps > 0 ? (remaining * CHUNK_SIZE) / speedBps : 0;

    lastProgressRef.current = { time: now, bytes: bytesSent };

    clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => {
      updateProgress(fileId, { sentChunks: sent, speedBps, etaSeconds });
    }, 0);
  };

  return { startSending, resolveReady, resolveVerify, abortCurrent };
}
