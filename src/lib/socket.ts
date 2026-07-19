import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents, SdpPayload } from '@/types/signaling';

const signalingUrl = (import.meta.env.VITE_SIGNALING_URL as string) || undefined;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  signalingUrl,
  { transports: ['polling', 'websocket'], autoConnect: false },
);

// Offer가 PeerConnection 생성 전에 도착하는 race condition 대비 — 모듈 로드 시점에 등록
let _pendingOffer: SdpPayload | null = null;
socket.on('offer', (data) => {
  _pendingOffer = data;
  console.log('[Socket] offer captured in buffer');
});

export function consumeBufferedOffer(): SdpPayload | null {
  const offer = _pendingOffer;
  _pendingOffer = null;
  return offer;
}

export function clearBufferedOffer() {
  _pendingOffer = null;
}
