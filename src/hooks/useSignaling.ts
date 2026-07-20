import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '@/lib/socket';
import { fetchIceServers } from '@/lib/iceConfig';
import { saveSession, getActiveSession, deleteSession } from '@/lib/indexeddb';
import { canAttemptJoin, recordJoinFailure, recordJoinSuccess } from '@/lib/joinAttemptGuard';
import { cleanupAbandonedTransfersForToken } from '@/lib/transferCleanup';
import { useRoomStore } from '@/store/roomStore';
import { useTransferStore } from '@/store/transferStore';

export function useSignaling() {
  const navigate = useNavigate();
  const { setRoom, setPhase, setError, setIceServers, token, role } = useRoomStore();
  const resetTransfer = useTransferStore((s) => s.reset);

  // ── 소켓 이벤트 등록 ────────────────────────────────────────
  useEffect(() => {
    const onPeerJoined = () => {
      console.log('[Signal] peer-joined');
      setPhase('peer_connected');
    };
    const onPeerReconnected = () => {
      console.log('[Signal] peer-reconnected');
      setPhase('peer_connected');
    };
    const onPeerDisconnected = () => {
      console.log('[Signal] peer-disconnected');
      if (useRoomStore.getState().phase !== 'peer_left') setPhase('peer_disconnected');
    };
    const onPeerLeft = async () => {
      console.log('[Signal] peer-left');
      const currentToken = useRoomStore.getState().token;
      if (currentToken) {
        await deleteSession(currentToken);
        // 상대가 완전히 나갔으니 다시 이어받을 수 없음 — 남아있던 OPFS 파일/기록 정리
        void cleanupAbandonedTransfersForToken(currentToken);
      }
      setPhase('peer_left');
    };

    socket.on('peer-joined', onPeerJoined);
    socket.on('peer-reconnected', onPeerReconnected);
    socket.on('peer-disconnected', onPeerDisconnected);
    socket.on('peer-left', onPeerLeft);

    return () => {
      socket.off('peer-joined', onPeerJoined);
      socket.off('peer-reconnected', onPeerReconnected);
      socket.off('peer-disconnected', onPeerDisconnected);
      socket.off('peer-left', onPeerLeft);
    };
  }, [setPhase]);

  // 이미 방에 들어와 있는 상태에서 Socket.IO 트랜스포트가 끊겼다 자동 재연결되면
  // (모바일 네트워크 전환/일시 순단 등), 서버는 이걸 새 연결로 취급해 새 socket.id를
  // 발급한다 — 예전 socket.id는 서버 쪽 방(room)에서 자동으로 빠지고
  // roomService.clearSocket()으로 offererSocketId/answererSocketId가 지워진다.
  // 클라이언트 상태(store의 token/role)는 그대로 남아있어서 겉으로는 여전히 방에
  // 있는 것처럼 보이지만, 서버 입장에선 더 이상 이 피어가 방에 없다 — 상대에게
  // signaling(offer/answer/ice-candidate)이 전달되지 않고, 상대가 재입장해도
  // peerConnected: false로 응답받아 "상대방 대기 중"에 고착된다.
  // 페이지를 새로고침해야만 동작하는 rejoinByToken과 달리, 여기서는 소켓이 재연결될
  // 때마다(최초 연결 포함) 이미 방에 있었는지 확인해서 필요하면 자동으로 rejoin을
  // 다시 보내 서버 쪽 방 멤버십을 복구한다.
  useEffect(() => {
    const onSocketConnect = () => {
      const { token: currentToken, role: currentRole } = useRoomStore.getState();
      // 최초 연결 시점엔 setRoom()이 아직 호출되기 전이라 token이 비어있어 자연히 스킵된다 —
      // create/join/rejoin 요청 자체가 각자의 흐름에서 처리하므로 여기서 중복 전송하지 않는다.
      if (!currentToken || !currentRole) return;
      console.log('[Signal] socket (re)connected while already in a room → re-sending rejoin');
      socket.emit('rejoin', { token: currentToken, role: currentRole }, (result) => {
        if (!result.ok) {
          console.warn('[Signal] auto-rejoin after reconnect failed:', result.error);
          return;
        }
        if (result.peerConnected) setPhase('peer_connected');
      });
    };

    socket.on('connect', onSocketConnect);
    return () => {
      socket.off('connect', onSocketConnect);
    };
  }, [setPhase]);

  // ── 룸 생성 ─────────────────────────────────────────────────
  const createRoom = useCallback(async () => {
    resetTransfer();
    setPhase('connecting');
    try {
      const servers = await fetchIceServers();
      console.log('[Signal] ICE servers fetched:', servers.length);
      setIceServers(servers);
    } catch {
      console.warn('[Signal] ICE fetch failed → using Google STUN fallback');
      setIceServers([{ urls: 'stun:stun.l.google.com:19302' }]);
    }

    if (!socket.connected) socket.connect();

    socket.emit('create-room', async (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { token: newToken, role: newRole, expiresAt } = result;
      console.log('[Signal] room created, token:', newToken, 'role:', newRole);
      await saveSession({ token: newToken, role: newRole, expiresAt });
      setRoom(newToken, newRole, expiresAt);
      void navigate(`/r/${newToken}`);
    });
  }, [navigate, setError, setIceServers, setPhase, setRoom]);

  // ── 룸 참여 ─────────────────────────────────────────────────
  const joinRoom = useCallback(
    async (roomToken: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      // PIN 무작위 대입 저지선 (UX 수준 — 실제 방어는 서버 rate-limit이 담당)
      const guard = canAttemptJoin();
      if (!guard.allowed) {
        const seconds = Math.ceil(guard.retryAfterMs / 1000);
        return { ok: false, error: `너무 많이 시도했습니다. ${seconds}초 후 다시 시도해주세요.` };
      }

      resetTransfer();
      setPhase('connecting');
      try {
        const servers = await fetchIceServers();
        console.log('[Signal] ICE servers fetched:', servers.length);
        setIceServers(servers);
      } catch {
        console.warn('[Signal] ICE fetch failed → using Google STUN fallback');
        setIceServers([{ urls: 'stun:stun.l.google.com:19302' }]);
      }

      if (!socket.connected) socket.connect();

      return new Promise((resolve) => {
        socket.emit('join-room', roomToken, async (result) => {
          if (!result.ok) {
            recordJoinFailure();
            setError(result.error);
            resolve({ ok: false, error: result.error });
            return;
          }
          recordJoinSuccess();
          console.log('[Signal] room joined, token:', roomToken, 'role:', result.role);
          await saveSession({
            token: roomToken,
            role: result.role,
            expiresAt: result.expiresAt,
          });
          setRoom(roomToken, result.role, result.expiresAt);
          void navigate(`/r/${roomToken}`);
          resolve({ ok: true });
        });
      });
    },
    [navigate, setError, setIceServers, setPhase, setRoom],
  );

  // ── URL 토큰으로 자동 재진입 ────────────────────────────────
  const rejoinByToken = useCallback(
    async (roomToken: string) => {
      const session = await getActiveSession();
      if (!session || session.token !== roomToken) {
        // 세션이 없거나 만료된 경우 홈으로 이동
        void navigate('/');
        return;
      }

      try {
        const servers = await fetchIceServers();
        console.log('[Signal] ICE servers fetched:', servers.length);
        setIceServers(servers);
      } catch {
        console.warn('[Signal] ICE fetch failed → using Google STUN fallback');
        setIceServers([{ urls: 'stun:stun.l.google.com:19302' }]);
      }

      if (!socket.connected) socket.connect();

      socket.emit('rejoin', { token: roomToken, role: session.role }, (result) => {
        if (!result.ok) {
          console.warn('[Signal] rejoin failed, redirecting home');
          void deleteSession(roomToken);
          void cleanupAbandonedTransfersForToken(roomToken);
          void navigate('/');
          return;
        }
        console.log('[Signal] rejoined, token:', roomToken, 'role:', result.role, 'peerConnected:', result.peerConnected);
        setRoom(roomToken, result.role, result.expiresAt);
        void saveSession({ ...session, role: result.role, expiresAt: result.expiresAt });
        if (result.peerConnected) setPhase('peer_connected');
      });
    },
    [navigate, setIceServers, setPhase, setRoom],
  );

  // navigate 없이 소켓 연결 해제 + 세션 삭제 + 스토어 초기화만 한다. 이미 다른 경로로
  // 라우트가 바뀐 뒤(예: 컴포넌트 언마운트 시점의 정리)에 호출될 수 있어서, 여기서
  // 또 navigate('/')를 부르면 사용자가 뒤로가기로 다른 곳에 도착했는데 홈으로 다시
  // 끌려가는 상황이 생길 수 있다 — 그래서 navigate는 leaveRoom에서만 명시적으로 한다.
  const leaveRoomSilently = useCallback(async () => {
    const currentToken = useRoomStore.getState().token;
    if (currentToken) {
      socket.emit('leave-room');
      await deleteSession(currentToken);
      // 세션을 지웠으니 이 토큰의 pending 전송은 다시는 이어받을 수 없음 — 정리
      void cleanupAbandonedTransfersForToken(currentToken);
    }
    socket.disconnect();
    useRoomStore.getState().reset();
    useTransferStore.getState().reset();
  }, []);

  const leaveRoom = useCallback(async () => {
    await leaveRoomSilently();
    void navigate('/');
  }, [navigate, leaveRoomSilently]);

  return { createRoom, joinRoom, rejoinByToken, leaveRoom, leaveRoomSilently, token, role };
}
