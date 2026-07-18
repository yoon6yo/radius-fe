export type PeerRole = 'offerer' | 'answerer';

// ── Callback 응답 타입 ──────────────────────────────────────
export type CreateRoomResult =
  | { ok: true;  token: string; role: PeerRole; expiresAt: number }
  | { ok: false; error: string };

export type JoinRoomResult =
  | { ok: true;  role: PeerRole; expiresAt: number }
  | { ok: false; error: string };

export type RejoinResult =
  | { ok: true;  role: PeerRole; peerConnected: boolean; expiresAt: number }
  | { ok: false; error: string };

// ── Socket.io 페이로드 ──────────────────────────────────────
export interface SdpPayload          { sdp: RTCSessionDescriptionInit }
export interface IceCandidatePayload { candidate: RTCIceCandidateInit }
export interface RejoinPayload       { token: string; role: PeerRole }

// ── 이벤트 맵 (socket.io-client 제네릭에 사용) ─────────────
export interface ServerToClientEvents {
  'peer-joined':       () => void;
  'peer-reconnected':  (data: { role: PeerRole }) => void;
  'peer-disconnected': () => void;
  'peer-left':         () => void;
  offer:               (data: SdpPayload) => void;
  answer:              (data: SdpPayload) => void;
  'ice-candidate':     (data: IceCandidatePayload) => void;
}

export interface ClientToServerEvents {
  'create-room': (cb: (r: CreateRoomResult) => void) => void;
  'join-room':   (token: string, cb: (r: JoinRoomResult) => void) => void;
  rejoin:        (payload: RejoinPayload, cb: (r: RejoinResult) => void) => void;
  'leave-room':  () => void;
  offer:         (data: SdpPayload) => void;
  answer:        (data: SdpPayload) => void;
  'ice-candidate': (data: IceCandidatePayload) => void;
}
