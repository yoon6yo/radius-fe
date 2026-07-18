import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '@/lib/socket';
import { fetchIceServers } from '@/lib/iceConfig';
import { saveSession, getActiveSession, deleteSession } from '@/lib/indexeddb';
import { useRoomStore } from '@/store/roomStore';

export function useSignaling() {
  const navigate = useNavigate();
  const { setRoom, setPhase, setError, setIceServers, token, role } = useRoomStore();

  // ── 소켓 이벤트 등록 ────────────────────────────────────────
  useEffect(() => {
    const onPeerJoined = () => setPhase('peer_connected');
    const onPeerReconnected = () => setPhase('peer_connected');
    const onPeerDisconnected = () => {
      // peer_left 상태일 때는 덮어쓰지 않음 (의도적 나가기 vs 네트워크 끊김 구분)
      if (useRoomStore.getState().phase !== 'peer_left') setPhase('peer_disconnected');
    };
    const onPeerLeft = async () => {
      const currentToken = useRoomStore.getState().token;
      if (currentToken) await deleteSession(currentToken);
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

  // ── 룸 생성 ─────────────────────────────────────────────────
  const createRoom = useCallback(async () => {
    setPhase('connecting');
    try {
      const servers = await fetchIceServers();
      setIceServers(servers);
    } catch {
      // 개발 환경 fallback
    }

    if (!socket.connected) socket.connect();

    socket.emit('create-room', async (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { token: newToken, role: newRole, expiresAt } = result;
      await saveSession({ token: newToken, role: newRole, expiresAt });
      setRoom(newToken, newRole, expiresAt);
      void navigate(`/r/${newToken}`);
    });
  }, [navigate, setError, setIceServers, setPhase, setRoom]);

  // ── 룸 참여 ─────────────────────────────────────────────────
  const joinRoom = useCallback(
    async (roomToken: string) => {
      setPhase('connecting');
      try {
        const servers = await fetchIceServers();
        setIceServers(servers);
      } catch {
        // 개발 환경 fallback
      }

      if (!socket.connected) socket.connect();

      socket.emit('join-room', roomToken, async (result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await saveSession({
          token: roomToken,
          role: result.role,
          expiresAt: result.expiresAt,
        });
        setRoom(roomToken, result.role, result.expiresAt);
        void navigate(`/r/${roomToken}`);
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
        setIceServers(servers);
      } catch {
        // 개발 환경 fallback
      }

      if (!socket.connected) socket.connect();

      socket.emit('rejoin', { token: roomToken, role: session.role }, (result) => {
        if (!result.ok) {
          void deleteSession(roomToken);
          void navigate('/');
          return;
        }
        setRoom(roomToken, result.role, result.expiresAt);
        void saveSession({ ...session, role: result.role, expiresAt: result.expiresAt });
        if (result.peerConnected) setPhase('peer_connected');
      });
    },
    [navigate, setIceServers, setPhase, setRoom],
  );

  const leaveRoom = useCallback(async () => {
    const currentToken = useRoomStore.getState().token;
    if (currentToken) {
      socket.emit('leave-room');
      await deleteSession(currentToken);
    }
    socket.disconnect();
    useRoomStore.getState().reset();
    void navigate('/');
  }, [navigate]);

  return { createRoom, joinRoom, rejoinByToken, leaveRoom, token, role };
}
