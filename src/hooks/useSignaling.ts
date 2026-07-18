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
    const onPeerDisconnected = () => setPhase('peer_disconnected');

    socket.on('peer-joined', onPeerJoined);
    socket.on('peer-reconnected', onPeerReconnected);
    socket.on('peer-disconnected', onPeerDisconnected);

    return () => {
      socket.off('peer-joined', onPeerJoined);
      socket.off('peer-reconnected', onPeerReconnected);
      socket.off('peer-disconnected', onPeerDisconnected);
    };
  }, [setPhase]);

  // ── 페이지 로드 시 미완료 세션 확인 ─────────────────────────
  useEffect(() => {
    void (async () => {
      // /r/ 경로에서는 Room.tsx의 rejoinByToken이 처리하므로 중복 실행 방지 (Bug 2)
      if (window.location.pathname.startsWith('/r/')) return;

      const session = await getActiveSession();
      if (!session) return;

      try {
        const servers = await fetchIceServers();
        setIceServers(servers);
        socket.connect();

        socket.emit('rejoin', { token: session.token, role: session.role }, (result) => {
          if (!result.ok) {
            void deleteSession(session.token);
            socket.disconnect();
            return;
          }
          setRoom(session.token, result.role, result.expiresAt);
          void saveSession({ ...session, role: result.role, expiresAt: result.expiresAt });
          if (result.peerConnected) {
            setPhase('peer_connected');
          }
          void navigate(`/r/${session.token}`);
        });
      } catch {
        // ICE fetch 실패 시 조용히 무시 (서버 미실행 개발 환경)
      }
    })();
    // 마운트 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return { createRoom, joinRoom, rejoinByToken, token, role };
}
