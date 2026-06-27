import { useEffect, useRef, useCallback, useState } from 'react';
import { PeerConnection } from '@/lib/webrtc';
import { useRoomStore } from '@/store/roomStore';
import type { ControlMessage } from '@/types/transfer';

interface UseWebRTCOptions {
  onControlMessage?: (msg: ControlMessage) => void;
  onBinaryChunk?: (buffer: ArrayBuffer) => void;
}

export function useWebRTC({ onControlMessage, onBinaryChunk }: UseWebRTCOptions = {}) {
  const { iceServers, role } = useRoomStore();
  const pcRef = useRef<PeerConnection | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const [isRelayed, setIsRelayed] = useState(false);

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
    });

    return () => {
      pcRef.current?.destroy();
      pcRef.current = null;
      setChannelReady(false);
    };
  }, [role, iceServers, handleMessage, handleConnectionState, handleChannelOpen]);

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

  return {
    channelReady,
    isRelayed,
    sendControl,
    sendBinary,
    getBufferedAmount,
    setBufferedAmountLowThreshold,
    onBufferedAmountLow,
  };
}
