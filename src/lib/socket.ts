import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/types/signaling';

// VITE_SIGNALING_URL 미설정 시 현재 origin 사용 (Vite proxy 또는 nginx 경유)
const signalingUrl = (import.meta.env.VITE_SIGNALING_URL as string) || undefined;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  signalingUrl,
  { transports: ['polling', 'websocket'], autoConnect: false },
);
