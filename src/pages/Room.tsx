import { useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSignaling } from '@/hooks/useSignaling';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useRoomStore } from '@/store/roomStore';
import { useTransferStore } from '@/store/transferStore';
import { TransferPanel } from '@/components/transfer/TransferPanel';
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
  const { lockQueue } = useTransferStore();

  useEffect(() => {
    if (urlToken && !token) {
      void rejoinByToken(urlToken);
    }
  }, [urlToken, token, rejoinByToken]);

  const handleStartTransfer = useCallback(() => {
    lockQueue();
    // 실제 전송 시작은 useSenderHash → startSending 흐름과 연결 (이후 통합 단계)
  }, [lockQueue]);

  const remainingMs = expiresAt ? expiresAt - Date.now() : ROOM_TTL_MS;
  const remainingMin = Math.max(0, Math.floor(remainingMs / 60_000));

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4 py-8">
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
          <p className="text-xs text-gray-600 break-all">{window.location.href}</p>
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
                {channelReady ? 'P2P 연결됨' : PHASE_LABEL[phase] ?? phase}
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
              역할: {role === 'offerer' ? '보내기' : '받기'}
            </p>
          )}
          {phase === 'peer_disconnected' && (
            <p className="text-sm text-yellow-400 mt-2">
              상대방이 연결을 끊었습니다. 룸은 {remainingMin}분 동안 유지됩니다.
              상대방이 다시 연결하면 이어서 전송합니다.
            </p>
          )}
          {isRelayed && channelReady && (
            <p className="text-xs text-yellow-400/70">
              중계 서버를 통해 전송 중입니다 (직접 연결보다 느릴 수 있습니다)
            </p>
          )}
          {phase === 'error' && (
            <p className="text-sm text-red-400 mt-2">{errorMessage}</p>
          )}
        </div>

        {/* 파일 전송 패널 */}
        {channelReady && role && (
          <div className="bg-gray-900 rounded-xl p-4">
            <TransferPanel role={role} onStartTransfer={handleStartTransfer} />
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
