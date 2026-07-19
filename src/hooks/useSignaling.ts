import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '@/lib/socket';
import { fetchIceServers } from '@/lib/iceConfig';
import { saveSession, getActiveSession, deleteSession } from '@/lib/indexeddb';
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
    async (roomToken: string) => {
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

      socket.emit('join-room', roomToken, async (result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        console.log('[Signal] room joined, token:', roomToken, 'role:', result.role);
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

  const leaveRoom = useCallback(async () => {
    const currentToken = useRoomStore.getState().token;
    if (currentToken) {
      socket.emit('leave-room');
      await deleteSession(currentToken);
    }
    socket.disconnect();
    useRoomStore.getState().reset();
    useTransferStore.getState().reset();
    void navigate('/');
  }, [navigate]);

  return { createRoom, joinRoom, rejoinByToken, leaveRoom, token, role };
}
