import { useCallback, useRef } from 'react';
import { useTransferStore } from '@/store/transferStore';
import { useRoomStore } from '@/store/roomStore';
import { FileSender } from '@/lib/sender';
import {} from '@/lib/chunkUtils';
import { CHUNK_SIZE, PROGRESS_UPDATE_MS } from '@/constants/transfer';
import type { PeerConnection } from '@/lib/webrtc';
import type {
  ControlMessage,
  ReadyMsg,
  ResumeMsg,
  QueuedFile,
} from '@/types/transfer';

interface UseFileTransferOptions {
  getPeerConnection: () => PeerConnection | null;
  sendControl: (msg: ControlMessage) => void;
}

export function useFileTransfer({ getPeerConnection, sendControl }: UseFileTransferOptions) {
  const { queue, currentIndex, lockQueue, updateFileStatus, updateProgress, advanceQueue } =
    useTransferStore();
  const { role } = useRoomStore();
  const senderRef = useRef<FileSender | null>(null);
  const progressTimerRef = useRef<number>(0);
  const lastProgressRef = useRef<{ time: number; bytes: number }>({ time: 0, bytes: 0 });

  // ── 송신 측: 파일 전송 시작 ──────────────────────────────
  const startSending = useCallback(
    async (chunkHashesByFileId: Map<string, string[]>, fileHashByFileId: Map<string, string>) => {
      if (role !== 'offerer') return;
      lockQueue();

      for (let i = currentIndex; i < queue.length; i++) {
        const item: QueuedFile = queue[i];
        updateFileStatus(item.fileId, 'waiting_ready');

        const pc = getPeerConnection();
        if (!pc) break;

        const sender = new FileSender(pc);
        senderRef.current = sender;

        const chunkHashes = chunkHashesByFileId.get(item.fileId) ?? [];
        const fileHash = fileHashByFileId.get(item.fileId) ?? '';

        await sender.sendFile(
          item.file,
          item.fileId,
          chunkHashes,
          fileHash,
          new Set<number>(),
          (sent) => throttleProgress(item.fileId, sent, item.totalChunks),
        );

        updateFileStatus(item.fileId, 'done');
        advanceQueue();
      }
    },
    [role, queue, currentIndex, lockQueue, updateFileStatus, advanceQueue, getPeerConnection],
  );

  // ── 수신 측: READY/RESUME 처리 ───────────────────────────
  const handleReadyOrResume = useCallback(
    (msg: ReadyMsg | ResumeMsg) => {
      const receivedSet =
        msg.type === 'RESUME' ? new Set(msg.receivedIndices) : new Set<number>();

      const item = queue.find((f) => f.fileId === msg.fileId);
      if (!item) return;

      sendControl({
        type: 'READY',
        fileId: msg.fileId,
      });

      void (async () => {
        const pc = getPeerConnection();
        if (!pc) return;
        const sender = new FileSender(pc);
        senderRef.current = sender;

        const chunkHashes: string[] = [];
        const fileHash = '';

        await sender.sendFile(
          item.file,
          item.fileId,
          chunkHashes,
          fileHash,
          receivedSet,
          (sent) => throttleProgress(item.fileId, sent, item.totalChunks),
        );
      })();
    },
    [queue, sendControl, getPeerConnection],
  );

  // ── 진행률 throttle ──────────────────────────────────────
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

  return { startSending, handleReadyOrResume };
}
