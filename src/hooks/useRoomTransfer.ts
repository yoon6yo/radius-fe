import { useCallback, useEffect, useRef } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useFileTransfer } from '@/hooks/useFileTransfer';
import { useFileReceiver } from '@/hooks/useFileReceiver';
import { useSenderHash } from '@/hooks/useSenderHash';
import { useReceiverHash } from '@/hooks/useReceiverHash';
import { useRoomStore } from '@/store/roomStore';
import { useTransferStore } from '@/store/transferStore';
import type { ChannelCloseHandler } from '@/lib/webrtc';
import type { ControlMessage, ReadyMsg, ResumeMsg } from '@/types/transfer';

interface UseRoomTransferOptions {
  onChannelClose?: ChannelCloseHandler;
}

export function useRoomTransfer({ onChannelClose }: UseRoomTransferOptions = {}) {
  const { role } = useRoomStore();
  const { queue, isLocked } = useTransferStore();

  // refs로 순환 의존성 끊기
  const sendControlRef = useRef<(msg: ControlMessage) => void>(() => {});
  const getPcRef = useRef<() => import('@/lib/webrtc').PeerConnection | null>(() => null);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // ── 수신 측 ─────────────────────────────────────────────────
  const { setChunkHashes, verifyChunkHash, verifyFileHash } = useReceiverHash();

  const { handleControl, handleBinaryChunk, getChunkHashes } = useFileReceiver({
    sendControl: (msg) => sendControlRef.current(msg),
    verifyChunkHash,
    verifyFileHash,
  });

  // ── 송신 측 ─────────────────────────────────────────────────
  const { startSending, resolveReady } = useFileTransfer({
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

  // 큐가 잠기면(전송 시작) 모든 파일 해시 계산 시작
  useEffect(() => {
    if (!isLocked || role !== 'offerer') return;
    const currentQueue = queueRef.current;
    if (currentQueue.length === 0) return;

    chunkHashesByFileId.current.clear();
    fileHashByFileId.current.clear();
    hashReadyCountRef.current = 0;
    expectedHashCountRef.current = currentQueue.length;

    for (const item of currentQueue) {
      computeHashes(item.fileId, item.file);
    }
  // isLocked가 true로 바뀌는 시점에만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  // ── 제어 메시지 라우터 ────────────────────────────────────────
  const onControlMessage = useCallback(
    (msg: ControlMessage) => {
      if (role === 'answerer') {
        void (async () => {
          await handleControl(msg);
          // HASH_DONE 처리 후 → 해시 매니페스트를 검증기에 등록
          // (이 시점 이후에 바이너리 청크가 도착하므로 타이밍 안전)
          if (msg.type === 'HASH_DONE') {
            setChunkHashes(msg.fileId, getChunkHashes());
          }
        })();
      } else {
        // 수신측이 보낸 READY/RESUME → 송신 대기 해제
        if (msg.type === 'READY' || msg.type === 'RESUME') {
          resolveReady(msg as ReadyMsg | ResumeMsg);
        }
      }
    },
    [role, handleControl, setChunkHashes, getChunkHashes, resolveReady],
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
  const webRTC = useWebRTC({ onControlMessage, onBinaryChunk, onChannelClose });

  // ref 업데이트 (렌더마다)
  sendControlRef.current = webRTC.sendControl;
  getPcRef.current = webRTC.getPeerConnection;

  return webRTC;
}
