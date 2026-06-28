import { useCallback, useRef } from 'react';
import { useTransferStore } from '@/store/transferStore';
import { useRoomStore } from '@/store/roomStore';
import { FileSender } from '@/lib/sender';
import { CHUNK_SIZE, PROGRESS_UPDATE_MS } from '@/constants/transfer';
import { calcTotalChunks } from '@/lib/chunkUtils';
import type { PeerConnection } from '@/lib/webrtc';
import type { ReadyMsg, ResumeMsg, QueuedFile } from '@/types/transfer';

interface UseFileTransferOptions {
  getPeerConnection: () => PeerConnection | null;
}

export function useFileTransfer({ getPeerConnection }: UseFileTransferOptions) {
  const { queue, currentIndex, lockQueue, updateFileStatus, updateProgress, advanceQueue } =
    useTransferStore();
  const { role } = useRoomStore();

  const senderRef = useRef<FileSender | null>(null);
  const progressTimerRef = useRef<number>(0);
  const lastProgressRef = useRef<{ time: number; bytes: number }>({ time: 0, bytes: 0 });

  // fileId → readySignal resolver (HASH_DONE 후 READY/RESUME 대기)
  const readyResolversRef = useRef<Map<string, (indices: Set<number>) => void>>(new Map());

  // ── 수신측에서 READY/RESUME 메시지가 오면 Promise를 resolve ──────
  const resolveReady = useCallback((msg: ReadyMsg | ResumeMsg) => {
    const resolver = readyResolversRef.current.get(msg.fileId);
    if (!resolver) return;
    readyResolversRef.current.delete(msg.fileId);
    const indices =
      msg.type === 'RESUME' ? new Set(msg.receivedIndices) : new Set<number>();
    resolver(indices);
  }, []);

  // ── 송신 측: 파일 전송 시작 ──────────────────────────────────────
  const startSending = useCallback(
    async (
      chunkHashesByFileId: Map<string, string[]>,
      fileHashByFileId: Map<string, string>,
    ) => {
      if (role !== 'offerer') return;
      lockQueue();

      for (let i = currentIndex; i < queue.length; i++) {
        const item: QueuedFile = queue[i];
        updateFileStatus(item.fileId, 'waiting_ready');

        const pc = getPeerConnection();
        if (!pc) break;

        const sender = new FileSender(pc);
        senderRef.current = sender;

        // readySignal 생성: FILE_META 전송 전에 등록해야 경쟁 조건 없음
        const readySignal = new Promise<Set<number>>((resolve) => {
          readyResolversRef.current.set(item.fileId, resolve);
        });

        const chunkHashes = chunkHashesByFileId.get(item.fileId) ?? [];
        const fileHash = fileHashByFileId.get(item.fileId) ?? '';
        const totalChunks = calcTotalChunks(item.file.size);

        updateFileStatus(item.fileId, 'transferring');
        updateProgress(item.fileId, { totalChunks });  // 진행률 바 활성화 (Bug 5)
        await sender.sendFile(
          item.file,
          item.fileId,
          chunkHashes,
          fileHash,
          readySignal,
          (sent) => throttleProgress(item.fileId, sent, totalChunks),
        );

        updateFileStatus(item.fileId, 'done');
        advanceQueue();
      }
    },
    [role, queue, currentIndex, lockQueue, updateFileStatus, advanceQueue, getPeerConnection],
  );

  // ── 진행률 throttle ──────────────────────────────────────────────
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

  return { startSending, resolveReady };
}
