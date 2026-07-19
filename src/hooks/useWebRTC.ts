import { useLayoutEffect, useRef, useCallback, useState } from 'react';
import { PeerConnection } from '@/lib/webrtc';
import { useRoomStore } from '@/store/roomStore';
import type { ChannelCloseHandler } from '@/lib/webrtc';
import type { ControlMessage } from '@/types/transfer';

interface UseWebRTCOptions {
  onControlMessage?: (msg: ControlMessage) => void;
  onBinaryChunk?: (buffer: ArrayBuffer) => void;
  onChannelClose?: ChannelCloseHandler;
  onChannelOpen?: () => void;
}

const RECONNECT_INTERVAL_MS = 10_000;

export function useWebRTC({
  onControlMessage,
  onBinaryChunk,
  onChannelClose,
  onChannelOpen,
}: UseWebRTCOptions = {}) {
  const { iceServers, role } = useRoomStore();
  const pcRef = useRef<PeerConnection | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const [isRelayed, setIsRelayed] = useState(false);
  const reconnectTimerRef = useRef<number>(0);
  const everConnectedRef = useRef(false);

  // refs로 콜백 최신 버전 유지 — PeerConnection은 생성 시점의 함수 참조를 고정하므로
  // 직접 넘기면 클로저가 굳어버림. ref를 통해 항상 최신 핸들러를 호출함
  const onControlMessageRef = useRef(onControlMessage);
  onControlMessageRef.current = onControlMessage;
  const onBinaryChunkRef = useRef(onBinaryChunk);
  onBinaryChunkRef.current = onBinaryChunk;
  const onChannelCloseRef = useRef(onChannelClose);
  onChannelCloseRef.current = onChannelClose;
  const onChannelOpenRef = useRef(onChannelOpen);
  onChannelOpenRef.current = onChannelOpen;

  // handleMessage는 빈 deps로 고정 → PeerConnection 생성 이후에도 최신 콜백 호출
  const handleMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data) as ControlMessage;
        onControlMessageRef.current?.(msg);
      } catch {
        console.warn('[WebRTC] JSON parse error', event.data);
      }
    } else {
      onBinaryChunkRef.current?.(event.data as ArrayBuffer);
    }
  }, []);

  const handleConnectionState = useCallback(
    (state: RTCPeerConnectionState) => {
      const { setPhase } = useRoomStore.getState();
      if (state === 'connected') {
        setPhase('peer_connected');
        void pcRef.current?.isRelayed().then(setIsRelayed);
      } else if (state === 'disconnected' || state === 'failed') {
        setPhase('peer_disconnected');
        setChannelReady(false);
      }
    },
    [],
  );

  const handleChannelOpen = useCallback(() => {
    everConnectedRef.current = true;
    setChannelReady(true);
    onChannelOpenRef.current?.();
  }, []);

  const handleChannelClose = useCallback((reason: 'closed' | 'error') => {
    setChannelReady(false);
    onChannelCloseRef.current?.(reason);
  }, []);

  useLayoutEffect(() => {
    if (!role || iceServers.length === 0) return;
    if (pcRef.current) return;

    console.log('[WebRTC] creating PeerConnection, role:', role, 'iceServers:', iceServers.length);
    pcRef.current = new PeerConnection({
      iceServers,
      role,
      onMessage: handleMessage,
      onConnectionState: handleConnectionState,
      onChannelOpen: handleChannelOpen,
      onChannelClose: handleChannelClose,
    });

    if (role === 'offerer' && useRoomStore.getState().phase === 'peer_connected') {
      pcRef.current.triggerOffer();
    }

    return () => {
      pcRef.current?.destroy();
      pcRef.current = null;
      setChannelReady(false);
    };
  }, [role, iceServers, handleMessage, handleConnectionState, handleChannelOpen, handleChannelClose]);

  // 한 번 연결된 적 있고 채널이 끊긴 경우에만 10초마다 재연결 시도
  useEffect(() => {
    if (channelReady) {
      clearInterval(reconnectTimerRef.current);
      return;
    }
    if (!pcRef.current || !everConnectedRef.current) return;

    reconnectTimerRef.current = window.setInterval(() => {
      console.log('[WebRTC] 재연결 시도 중...');
      pcRef.current?.reconnect();
    }, RECONNECT_INTERVAL_MS);

    return () => clearInterval(reconnectTimerRef.current);
  }, [channelReady]);

  const sendControl = useCallback((msg: ControlMessage) => {
    pcRef.current?.sendText(JSON.stringify(msg));
  }, []);

  const sendBinary = useCallback((buffer: ArrayBuffer) => {
    pcRef.current?.sendBinary(buffer);
  }, []);

  const getBufferedAmount = useCallback(() => pcRef.current?.bufferedAmount ?? 0, []);

  const setBufferedAmountLowThreshold = useCallback((value: number) => {
    if (pcRef.current) pcRef.current.bufferedAmountLowThreshold = value;
  }, []);

  const onBufferedAmountLow = useCallback((handler: () => void) => {
    pcRef.current?.onBufferedAmountLow(handler);
  }, []);

  const getPeerConnection = useCallback(() => pcRef.current, []);

  return {
    channelReady,
    isRelayed,
    sendControl,
    sendBinary,
    getPeerConnection,
    getBufferedAmount,
    setBufferedAmountLowThreshold,
    onBufferedAmountLow,
  };
}
