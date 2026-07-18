import { create } from 'zustand';
import type { PeerRole } from '@/types/signaling';

export type RoomPhase =
  | 'idle'
  | 'connecting'
  | 'waiting_peer'
  | 'peer_connected'
  | 'peer_disconnected'
  | 'peer_left'
  | 'error';

interface RoomState {
  token: string | null;
  role: PeerRole | null;
  expiresAt: number | null;
  phase: RoomPhase;
  errorMessage: string | null;
  iceServers: RTCIceServer[];

  setRoom: (token: string, role: PeerRole, expiresAt: number) => void;
  setPhase: (phase: RoomPhase) => void;
  setError: (message: string) => void;
  setIceServers: (servers: RTCIceServer[]) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  token: null,
  role: null,
  expiresAt: null,
  phase: 'idle',
  errorMessage: null,
  iceServers: [],

  setRoom: (token, role, expiresAt) =>
    set({ token, role, expiresAt, phase: 'waiting_peer', errorMessage: null }),

  setPhase: (phase) => set({ phase }),

  setError: (errorMessage) => set({ phase: 'error', errorMessage }),

  setIceServers: (iceServers) => set({ iceServers }),

  reset: () =>
    set({
      token: null,
      role: null,
      expiresAt: null,
      phase: 'idle',
      errorMessage: null,
    }),
}));
