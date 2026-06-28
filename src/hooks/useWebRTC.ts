import { useEffect, useRef, useCallback, useState } from 'react';
import { PeerConnection } from '@/lib/webrtc';
import { useRoomStore } from '@/store/roomStore';
import type { ChannelCloseHandler } from '@/lib/webrtc';
import type { ControlMessage } from '@/types/transfer';

interface UseWebRTCOptions {
  onControlMessage?: (msg: ControlMessage) => void;
  onBinaryChunk?: (buffer: ArrayBuffer) => void;
  onChannelClose?: ChannelCloseHandler;
}

const RECONNECT_INTERVAL_MS = 10_000;

export function useWebRTC({ onControlMessage, onBinaryChunk, onChannelClose }: UseWebRTCOptions = {}) {
  const { iceServers, role } = useRoomStore();
  const pcRef = useRef<PeerConnection | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const [isRelayed, setIsRelayed] = useState(false);
  const reconnectTimerRef = useRef<number>(0);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as ControlMessage;
          onControlMessage?.(msg);
        } catch {
          console.warn('[WebRTC] JSON parse error', event.data);
        }
      } else {
        onBinaryChunk?.(event.data as ArrayBuffer);
      }
    },
    [onControlMessage, onBinaryChunk],
  );

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
    setChannelReady(true);
  }, []);

  const handleChannelClose = useCallback(
    (reason: 'closed' | 'error') => {
      setChannelReady(false);
      onChannelClose?.(reason);
    },
    [onChannelClose],
  );

  // role이 확정된 시점에 PeerConnection 생성
  useEffect(() => {
    if (!role || iceServers.length === 0) return;
    if (pcRef.current) return;

    pcRef.current = new PeerConnection({
      iceServers,
      role,
      onMessage: handleMessage,
      onConnectionState: handleConnectionState,
      onChannelOpen: handleChannelOpen,
      onChannelClose: handleChannelClose,
    });

    // offerer가 재연결했을 때 peer가 이미 방에 있으면 즉시 offer 전송 (Bug 1)
    if (role === 'offerer' && useRoomStore.getState().phase === 'peer_connected') {
      pcRef.current.triggerOffer();
    }

    return () => {
      pcRef.current?.destroy();
      pcRef.current = null;
      setChannelReady(false);
    };
  }, [role, iceServers, handleMessage, handleConnectionState, handleChannelOpen, handleChannelClose]);

  // 채널이 끊기면 10초마다 재연결 시도
  useEffect(() => {
    if (channelReady) {
      clearInterval(reconnectTimerRef.current);
      return;
    }
    if (!pcRef.current) return;

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

  const getBufferedAmount = useCallback(
    () => pcRef.current?.bufferedAmount ?? 0,
    [],
  );

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
