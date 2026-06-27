import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSignaling } from '@/hooks/useSignaling';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useRoomStore } from '@/store/roomStore';
import { ROOM_TTL_MS } from '@/constants/transfer';

const PHASE_LABEL: Record<string, string> = {
  idle: '초기화 중…',
  connecting: '서버에 연결 중…',
  waiting_peer: '상대방을 기다리는 중',
  peer_connected: '연결됨',
  peer_disconnected: '상대방 연결 끊김',
  error: '오류 발생',
};

export default function Room() {
  const { token: urlToken } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { rejoinByToken } = useSignaling();
  const { token, role, phase, expiresAt, errorMessage } = useRoomStore();
  const { channelReady, isRelayed } = useWebRTC();

  // URL 토큰으로 자동 재진입 시도
  useEffect(() => {
    if (urlToken && !token) {
      void rejoinByToken(urlToken);
    }
  }, [urlToken, token, rejoinByToken]);

  const remainingMs = expiresAt ? expiresAt - Date.now() : ROOM_TTL_MS;
  const remainingMin = Math.max(0, Math.floor(remainingMs / 60_000));

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
      <div className="w-full max-w-md space-y-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => void navigate('/')}
            className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            ← 홈으로
          </button>
          <span className="text-xs text-gray-600">
            룸 만료: {remainingMin}분 후
          </span>
        </div>

        {/* 핀 번호 + 링크 */}
        <div className="bg-gray-900 rounded-xl p-6 space-y-4 text-center">
          <p className="text-sm text-gray-400">핀 번호</p>
          <p className="text-5xl font-mono font-bold tracking-[0.3em]">
            {urlToken ?? token ?? '------'}
          </p>
          <p className="text-xs text-gray-600 break-all">
            {window.location.href}
          </p>
          <button
            onClick={() => void navigator.clipboard.writeText(window.location.href)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            링크 복사
          </button>
        </div>

        {/* 연결 상태 */}
        <div className="bg-gray-900 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot phase={channelReady ? 'peer_connected' : phase} />
              <span className="text-sm">
                {channelReady ? 'DataChannel 연결됨' : PHASE_LABEL[phase] ?? phase}
              </span>
            </div>
            {channelReady && isRelayed && (
              <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded">
                중계 서버 경유
              </span>
            )}
          </div>
          {role && (
            <p className="text-xs text-gray-600">
              역할: {role === 'offerer' ? '파일 보내기' : '파일 받기'}
            </p>
          )}
          {phase === 'peer_disconnected' && (
            <p className="text-sm text-yellow-400 mt-2">
              상대방이 연결을 끊었습니다. 룸은 {remainingMin}분 동안 유지됩니다.
            </p>
          )}
          {isRelayed && channelReady && (
            <p className="text-xs text-yellow-400/70">
              현재 중계 서버를 통해 전송 중입니다 (직접 연결보다 느릴 수 있습니다)
            </p>
          )}
          {phase === 'error' && (
            <p className="text-sm text-red-400 mt-2">{errorMessage}</p>
          )}
        </div>

        {/* 파일 전송 영역 (다음 단계에서 구현) */}
        {channelReady && (
          <div className="bg-gray-900 rounded-xl p-6 text-center text-gray-500 text-sm">
            파일 전송 기능 구현 중…
          </div>
        )}
      </div>
    </main>
  );
}

function StatusDot({ phase }: { phase: string }) {
  const color =
    phase === 'peer_connected'
      ? 'bg-green-500'
      : phase === 'peer_disconnected' || phase === 'error'
        ? 'bg-red-500'
        : 'bg-yellow-500 animate-pulse';

  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}
