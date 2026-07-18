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
  connecting: '연결 중…',
  waiting_peer: '상대방 대기 중',
  peer_connected: '연결됨',
  peer_disconnected: '연결 끊김',
  error: '오류',
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
        console.warn('[Room] DataChannel dropped during transfer:', reason);
        setChannelDropped(true);
      }
    },
    [isLocked],
  );

  const { channelReady, isRelayed } = useRoomTransfer({ onChannelClose: handleChannelClose });
  const { lockQueue } = useTransferStore();

  useBeforeUnload();

  useEffect(() => {
    if (urlToken && !token) void rejoinByToken(urlToken);
  }, [urlToken, token, rejoinByToken]);

  useEffect(() => {
    if (channelReady) setChannelDropped(false);
  }, [channelReady]);

  const handleStartTransfer = useCallback(() => lockQueue(), [lockQueue]);

  const remainingMs = expiresAt ? expiresAt - Date.now() : ROOM_TTL_MS;
  const remainingMin = Math.max(0, Math.floor(remainingMs / 60_000));
  const displayToken = urlToken ?? token ?? '------';

  const isConnected = channelReady;
  const isWaiting = !channelReady && phase === 'waiting_peer';
  const isDisconnected = phase === 'peer_disconnected';

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto space-y-4">
        {/* 상단 바 */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => void navigate('/')}
            className="flex items-center gap-1 text-gray-500 text-sm hover:text-gray-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            홈
          </button>
          <span className="text-xs text-gray-400">{remainingMin}분 후 만료</span>
        </div>

        {/* PIN 카드 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 text-center space-y-3">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-widest">PIN</p>
          <p className="text-5xl font-mono font-bold text-gray-900 tracking-[0.2em]">
            {displayToken}
          </p>
          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              onClick={() => void navigator.clipboard.writeText(displayToken)}
              className="text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
            >
              PIN 복사
            </button>
            <span className="text-gray-200">|</span>
            <button
              onClick={() => void navigator.clipboard.writeText(window.location.href)}
              className="text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
            >
              링크 복사
            </button>
          </div>
        </div>

        {/* 연결 상태 카드 */}
        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <StatusDot phase={isConnected ? 'peer_connected' : phase} />
              <span className="text-sm font-medium text-gray-900">
                {isConnected ? 'P2P 연결됨' : PHASE_LABEL[phase] ?? phase}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {role && (
                <span className="text-xs text-gray-400">
                  {role === 'offerer' ? '보내기' : '받기'}
                </span>
              )}
              {isConnected && isRelayed && (
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                  중계
                </span>
              )}
            </div>
          </div>

          {/* 대기 상태 안내 */}
          {isWaiting && (
            <p className="mt-3 text-xs text-gray-400">
              상대방이 PIN을 입력하면 자동으로 연결됩니다
            </p>
          )}

          {/* 채널 드롭 경고 */}
          {channelDropped && !isConnected && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-sm font-medium text-red-500">채널이 끊겼습니다</p>
              <p className="text-xs text-gray-400 mt-0.5">
                복구 중입니다. 탭을 닫지 마세요.
              </p>
            </div>
          )}

          {/* 상대방 재연결 대기 */}
          {isDisconnected && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-sm font-medium text-amber-600">상대방이 끊겼습니다</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {remainingMin}분 안에 돌아오면 이어받을 수 있습니다
              </p>
            </div>
          )}

          {phase === 'error' && errorMessage && (
            <p className="mt-3 text-sm text-red-500">{errorMessage}</p>
          )}
        </div>

        {/* 전송 패널 */}
        {(isConnected || isDisconnected) && role && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <TransferPanel role={role} onStartTransfer={handleStartTransfer} />
          </div>
        )}
      </div>
    </main>
  );
}

function StatusDot({ phase }: { phase: string }) {
  const base = 'inline-block w-2 h-2 rounded-full flex-shrink-0';
  if (phase === 'peer_connected') return <span className={`${base} bg-green-400`} />;
  if (phase === 'peer_disconnected' || phase === 'error') return <span className={`${base} bg-red-400`} />;
  return <span className={`${base} bg-blue-400 animate-pulse`} />;
}
