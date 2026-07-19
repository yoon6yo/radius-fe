import { useCallback, useEffect, useRef } from 'react';
import { CHUNK_SIZE } from '@/constants/transfer';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useFileTransfer } from '@/hooks/useFileTransfer';
import { useFileReceiver } from '@/hooks/useFileReceiver';
import { useSenderHash } from '@/hooks/useSenderHash';
import { useReceiverHash } from '@/hooks/useReceiverHash';
import { useBitmapPersistence } from '@/hooks/useBitmapPersistence';
import { useRoomStore } from '@/store/roomStore';
import { useTransferStore } from '@/store/transferStore';
import type { ChannelCloseHandler } from '@/lib/webrtc';
import type { ControlMessage, ReadyMsg, ResumeMsg, VerifyOk, VerifyFail, TransferRequest } from '@/types/transfer';

interface UseRoomTransferOptions {
  onChannelClose?: ChannelCloseHandler;
}

export function useRoomTransfer({ onChannelClose }: UseRoomTransferOptions = {}) {
  const { role, token } = useRoomStore();
  const { queue, isLocked, updateFileStatus, updateProgress, advanceQueue, setPendingRequest, clearPendingRequest, acceptPendingRequest, addReceivedFile } = useTransferStore();

  const sendControlRef = useRef<(msg: ControlMessage) => void>(() => {});
  const getPcRef = useRef<() => import('@/lib/webrtc').PeerConnection | null>(() => null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  // 수신 측 제어 메시지 순차 처리 큐 — FILE_META 셋업 완료 전 HASH_DONE이 READY를 보내는 race 방지
  const controlQueueRef = useRef<Promise<void>>(Promise.resolve());

  // ── IndexedDB 이어받기 영속화 ────────────────────────────────
  const { initTransferRecord, recordChunkReceived, completeTransfer, getReceivedIndices } =
    useBitmapPersistence();

  // ── 수신 측 ─────────────────────────────────────────────────
  const { setChunkHashes, verifyChunkHash, verifyFileHash } = useReceiverHash();

  const onReceiverProgress = useCallback((fileId: string, received: number, total: number) => {
    const now = Date.now();
    const last = receiverProgressLastRef.current;
    clearTimeout(receiverProgressTimerRef.current);
    if (now - last.time >= 250) {
      const elapsed = (now - last.time) / 1000;
      const bytes = received * CHUNK_SIZE;
      const speedBps = last.time > 0 && elapsed > 0 ? (bytes - last.bytes) / elapsed : 0;
      const etaSeconds = speedBps > 0 ? ((total - received) * CHUNK_SIZE) / speedBps : 0;
      receiverProgressLastRef.current = { time: now, bytes };
      updateProgress(fileId, { receivedChunks: received, speedBps, etaSeconds });
    } else {
      receiverProgressTimerRef.current = window.setTimeout(() => {
        updateProgress(fileId, { receivedChunks: received });
      }, 250);
    }
  }, [updateProgress]);

  const onReceiverFileDone = useCallback((fileId: string) => {
    updateFileStatus(fileId, 'done');
    advanceQueue();
  }, [updateFileStatus, advanceQueue]);

  const { handleControl, handleBinaryChunk, getChunkHashes } = useFileReceiver({
    sendControl: (msg) => sendControlRef.current(msg),
    verifyChunkHash,
    verifyFileHash,
    onChunkVerified: recordChunkReceived,
    onTransferComplete: completeTransfer,
    getRestoredIndices: async (fileId) => getReceivedIndices(fileId),
    onProgress: onReceiverProgress,
    onFileDone: onReceiverFileDone,
  });

  // ── 송신 측 ─────────────────────────────────────────────────
  const { startSending, resolveReady, resolveVerify, abortCurrent } = useFileTransfer({
    getPeerConnection: () => getPcRef.current(),
  });

  const startSendingRef = useRef(startSending);
  startSendingRef.current = startSending;

  const chunkHashesByFileId = useRef<Map<string, string[]>>(new Map());
  const fileHashByFileId = useRef<Map<string, string>>(new Map());
  const hashReadyCountRef = useRef(0);
  const expectedHashCountRef = useRef(0);
  const acceptedRef = useRef(false);

  const receiverProgressLastRef = useRef<{ time: number; bytes: number }>({ time: 0, bytes: 0 });
  const receiverProgressTimerRef = useRef(0);

  const { computeHashes } = useSenderHash(
    (fileId, chunkHashes, fileHash) => {
      console.log('[Transfer] hash ready:', fileId, 'chunks:', chunkHashes.length,
        '(', hashReadyCountRef.current + 1, '/', expectedHashCountRef.current, ')');
      chunkHashesByFileId.current.set(fileId, chunkHashes);
      fileHashByFileId.current.set(fileId, fileHash);
      hashReadyCountRef.current++;
      if (hashReadyCountRef.current >= expectedHashCountRef.current) {
        if (acceptedRef.current) {
          console.log('[Transfer] all hashes ready + accepted → startSending');
          void startSendingRef.current(chunkHashesByFileId.current, fileHashByFileId.current);
        } else {
          console.log('[Transfer] all hashes ready, waiting for TRANSFER_ACCEPT');
        }
      }
    },
    (fileId) => {
      console.error('[Transfer] hash worker error for:', fileId);
      updateFileStatus(fileId, 'error');
    },
  );

  // 큐가 잠기면 TRANSFER_REQUEST 전송 + 백그라운드 해싱 시작
  useEffect(() => {
    if (!isLocked || role !== 'offerer') return;
    const currentQueue = queueRef.current;
    if (currentQueue.length === 0) return;

    acceptedRef.current = false;
    chunkHashesByFileId.current.clear();
    fileHashByFileId.current.clear();
    hashReadyCountRef.current = 0;
    expectedHashCountRef.current = currentQueue.length;

    const requestFiles = currentQueue.map((item) => ({
      fileId: item.fileId,
      fileName: item.fileName,
      fileSize: item.fileSize,
    }));
    console.log('[Transfer] sending TRANSFER_REQUEST:', requestFiles.length, 'files');
    sendControlRef.current({ type: 'TRANSFER_REQUEST', files: requestFiles });

    for (const item of currentQueue) {
      updateFileStatus(item.fileId, 'waiting_accept');
      computeHashes(item.fileId, item.file!);
    }
  // isLocked가 true로 바뀌는 시점에만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  // 채널 재연결 시 중단된 전송 자동 재개
  const handleChannelOpen = useCallback(() => {
    if (!isLockedRef.current || role !== 'offerer') return;
    if (!acceptedRef.current) return;
    const hasWaiting = queueRef.current.some((f) => f.status === 'waiting_ready');
    if (hasWaiting && chunkHashesByFileId.current.size > 0) {
      void startSendingRef.current(chunkHashesByFileId.current, fileHashByFileId.current);
    }
  }, [role]);

  // ── 제어 메시지 라우터 ────────────────────────────────────────
  const onControlMessage = useCallback(
    (msg: ControlMessage) => {
      if (role === 'answerer') {
        if (msg.type === 'TRANSFER_REQUEST') {
          console.log('[Transfer:answerer] TRANSFER_REQUEST received:', (msg as TransferRequest).files.length, 'files');
          setPendingRequest((msg as TransferRequest).files);
          return;
        }
        controlQueueRef.current = controlQueueRef.current.then(async () => {
          try {
            if (msg.type === 'FILE_META') {
              console.log('[Transfer:answerer] FILE_META received:', msg.fileId);
              addReceivedFile(msg.fileId, msg.fileName, msg.fileSize, msg.totalChunks);
              await initTransferRecord({
                fileId: msg.fileId,
                token: token ?? '',
                fileName: msg.fileName,
                fileSize: msg.fileSize,
                chunkSize: msg.chunkSize,
                totalChunks: msg.totalChunks,
                fileHash: '',
                chunkHashes: [],
              });
            }
            if (msg.type === 'HASH_DONE') {
              console.log('[Transfer:answerer] HASH_DONE received:', msg.fileId, 'hashes:', getChunkHashes().length);
              setChunkHashes(msg.fileId, getChunkHashes());
            }
            await handleControl(msg);
          } catch (err) {
            console.error('[Transfer:answerer] onControlMessage error for', msg.type, ':', err);
          }
        });
      } else {
        if (msg.type === 'TRANSFER_ACCEPT') {
          console.log('[Transfer:offerer] TRANSFER_ACCEPT received → starting transfer');
          acceptedRef.current = true;
          if (hashReadyCountRef.current >= expectedHashCountRef.current && expectedHashCountRef.current > 0) {
            void startSendingRef.current(chunkHashesByFileId.current, fileHashByFileId.current);
          }
        }
        if (msg.type === 'TRANSFER_REJECT') {
          console.log('[Transfer:offerer] TRANSFER_REJECT received');
          for (const item of queueRef.current) {
            updateFileStatus(item.fileId, 'error');
          }
        }
        if (msg.type === 'READY' || msg.type === 'RESUME') {
          console.log('[Transfer:offerer] received', msg.type, 'for:', (msg as ReadyMsg | ResumeMsg).fileId);
          resolveReady(msg as ReadyMsg | ResumeMsg);
        }
        if (msg.type === 'VERIFY_OK' || msg.type === 'VERIFY_FAIL') {
          resolveVerify(msg as VerifyOk | VerifyFail);
        }
      }
    },
    [role, token, handleControl, setChunkHashes, getChunkHashes, resolveReady, resolveVerify,
     initTransferRecord, updateFileStatus, setPendingRequest, addReceivedFile],
  );

  const onBinaryChunk = useCallback(
    (buffer: ArrayBuffer) => {
      if (role === 'answerer') {
        void handleBinaryChunk(buffer);
      }
    },
    [role, handleBinaryChunk],
  );

  // ── WebRTC ───────────────────────────────────────────────────
  const webRTC = useWebRTC({ onControlMessage, onBinaryChunk, onChannelClose, onChannelOpen: handleChannelOpen });

  sendControlRef.current = webRTC.sendControl;
  getPcRef.current = webRTC.getPeerConnection;

  const acceptTransfer = useCallback(() => {
    console.log('[Transfer:answerer] accepting transfer');
    acceptPendingRequest();
    sendControlRef.current({ type: 'TRANSFER_ACCEPT' });
  }, [acceptPendingRequest]);

  const rejectTransfer = useCallback(() => {
    console.log('[Transfer:answerer] rejecting transfer');
    clearPendingRequest();
    sendControlRef.current({ type: 'TRANSFER_REJECT' });
  }, [clearPendingRequest]);

  return { ...webRTC, abortCurrent, acceptTransfer, rejectTransfer };
}
