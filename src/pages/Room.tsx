import { useEffect, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSignaling } from '@/hooks/useSignaling';
import { useRoomTransfer } from '@/hooks/useRoomTransfer';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
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
  const { isLocked } = useTransferStore();
  const [channelDropped, setChannelDropped] = useState(false);

  const handleChannelClose = useCallback(
    (reason: 'closed' | 'error') => {
      if (isLocked) {
        // 전송 진행 중에 채널이 끊기면 별도 알림
        console.warn('[Room] DataChannel dropped during transfer:', reason);
        setChannelDropped(true);
      }
    },
    [isLocked],
  );

  const { channelReady, isRelayed } = useRoomTransfer({ onChannelClose: handleChannelClose });
  const { lockQueue } = useTransferStore();

  // 전송 중 탭 닫기 경고
  useBeforeUnload();

  // URL 토큰으로 자동 재진입 시도
  useEffect(() => {
    if (urlToken && !token) {
      void rejoinByToken(urlToken);
    }
  }, [urlToken, token, rejoinByToken]);

  // 채널 복구 시 드롭 알림 해제
  useEffect(() => {
    if (channelReady) setChannelDropped(false);
  }, [channelReady]);

  const handleStartTransfer = useCallback(() => {
    lockQueue();
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

          {/* DataChannel 드롭 감지 — 전송 중 채널 끊김 */}
          {channelDropped && !channelReady && (
            <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-400 font-medium">전송 채널이 끊겼습니다</p>
              <p className="text-xs text-red-400/70 mt-1">
                P2P 연결을 복구하는 중입니다. 탭을 닫지 마세요.
                복구되면 이어서 전송을 재개합니다.
              </p>
            </div>
          )}

          {/* 상대방 재연결 대기 안내 */}
          {phase === 'peer_disconnected' && (
            <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-sm text-yellow-400 font-medium">상대방이 연결을 끊었습니다</p>
              <p className="text-xs text-yellow-400/70 mt-1">
                룸은 {remainingMin}분 동안 유지됩니다. 탭을 닫지 말고 대기하면
                상대방이 돌아왔을 때 이어서 전송할 수 있습니다.
              </p>
            </div>
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

        {/* 재연결 대기 중에도 TransferPanel 유지 (전송 상태 보존) */}
        {(channelReady || phase === 'peer_disconnected') && role && (
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
