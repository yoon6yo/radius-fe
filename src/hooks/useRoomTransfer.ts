import { useCallback, useEffect, useRef } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useFileTransfer } from '@/hooks/useFileTransfer';
import { useFileReceiver } from '@/hooks/useFileReceiver';
import { useSenderHash } from '@/hooks/useSenderHash';
import { useReceiverHash } from '@/hooks/useReceiverHash';
import { useBitmapPersistence } from '@/hooks/useBitmapPersistence';
import { useRoomStore } from '@/store/roomStore';
import { useTransferStore } from '@/store/transferStore';
import type { ChannelCloseHandler } from '@/lib/webrtc';
import type { ControlMessage, ReadyMsg, ResumeMsg, VerifyOk, VerifyFail } from '@/types/transfer';

interface UseRoomTransferOptions {
  onChannelClose?: ChannelCloseHandler;
}

export function useRoomTransfer({ onChannelClose }: UseRoomTransferOptions = {}) {
  const { role, token } = useRoomStore();
  const { queue, isLocked, updateFileStatus } = useTransferStore();

  const sendControlRef = useRef<(msg: ControlMessage) => void>(() => {});
  const getPcRef = useRef<() => import('@/lib/webrtc').PeerConnection | null>(() => null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;

  // ── IndexedDB 이어받기 영속화 ────────────────────────────────
  const { initTransferRecord, recordChunkReceived, completeTransfer, getReceivedIndices } =
    useBitmapPersistence();

  // ── 수신 측 ─────────────────────────────────────────────────
  const { setChunkHashes, verifyChunkHash, verifyFileHash } = useReceiverHash();

  const { handleControl, handleBinaryChunk, getChunkHashes } = useFileReceiver({
    sendControl: (msg) => sendControlRef.current(msg),
    verifyChunkHash,
    verifyFileHash,
    onChunkVerified: recordChunkReceived,
    onTransferComplete: completeTransfer,
    getRestoredIndices: async (fileId) => getReceivedIndices(fileId),
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

  const { computeHashes } = useSenderHash((fileId, chunkHashes, fileHash) => {
    chunkHashesByFileId.current.set(fileId, chunkHashes);
    fileHashByFileId.current.set(fileId, fileHash);
    hashReadyCountRef.current++;
    if (hashReadyCountRef.current >= expectedHashCountRef.current) {
      void startSendingRef.current(chunkHashesByFileId.current, fileHashByFileId.current);
    }
  });

  // 큐가 잠기면(전송 시작) 해시 계산 시작 + 상태 'hashing'으로 표시
  useEffect(() => {
    if (!isLocked || role !== 'offerer') return;
    const currentQueue = queueRef.current;
    if (currentQueue.length === 0) return;

    chunkHashesByFileId.current.clear();
    fileHashByFileId.current.clear();
    hashReadyCountRef.current = 0;
    expectedHashCountRef.current = currentQueue.length;

    for (const item of currentQueue) {
      updateFileStatus(item.fileId, 'hashing');
      computeHashes(item.fileId, item.file);
    }
  // isLocked가 true로 바뀌는 시점에만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  // 채널 재연결 시 중단된 전송 자동 재개 (채널 드롭으로 isAborted된 파일이 있을 때)
  const handleChannelOpen = useCallback(() => {
    if (!isLockedRef.current || role !== 'offerer') return;
    const hasWaiting = queueRef.current.some((f) => f.status === 'waiting_ready');
    if (hasWaiting && chunkHashesByFileId.current.size > 0) {
      void startSendingRef.current(chunkHashesByFileId.current, fileHashByFileId.current);
    }
  }, [role]);

  // ── 제어 메시지 라우터 ────────────────────────────────────────
  const onControlMessage = useCallback(
    (msg: ControlMessage) => {
      if (role === 'answerer') {
        void (async () => {
          if (msg.type === 'FILE_META') {
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
          // HASH_DONE: 해시 먼저 등록 → READY/RESUME 전송
          // (순서가 반대면 READY 후 도착한 초반 청크가 검증 없이 통과됨)
          if (msg.type === 'HASH_DONE') {
            setChunkHashes(msg.fileId, getChunkHashes());
          }
          await handleControl(msg);
        })();
      } else {
        if (msg.type === 'READY' || msg.type === 'RESUME') {
          resolveReady(msg as ReadyMsg | ResumeMsg);
        }
        if (msg.type === 'VERIFY_OK' || msg.type === 'VERIFY_FAIL') {
          resolveVerify(msg as VerifyOk | VerifyFail);
        }
      }
    },
    [role, token, handleControl, setChunkHashes, getChunkHashes, resolveReady, resolveVerify,
     initTransferRecord, updateFileStatus],
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

  return { ...webRTC, abortCurrent };
}
