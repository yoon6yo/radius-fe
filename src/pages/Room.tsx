import { useEffect, useCallback, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSignaling } from '@/hooks/useSignaling';
import { useRoomTransfer } from '@/hooks/useRoomTransfer';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { useRoomStore } from '@/store/roomStore';
import { useTransferStore } from '@/store/transferStore';
import { TransferPanel } from '@/components/transfer/TransferPanel';
import { LogViewerModal } from '@/components/ui/LogViewerModal';
import { ROOM_TTL_MS } from '@/constants/transfer';

const PHASE_LABEL: Record<string, string> = {
  idle: '초기화 중…',
  connecting: '연결 중…',
  waiting_peer: '상대방 대기 중',
  peer_connected: '연결됨',
  peer_disconnected: '연결 끊김',
  peer_left: '상대방이 나갔습니다',
  error: '오류',
};

export default function Room() {
  const { token: urlToken } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { rejoinByToken, leaveRoom, leaveRoomSilently } = useSignaling();
  const [pinCopied, setPinCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const pinCopyTimerRef = useRef<number>(0);
  const linkCopyTimerRef = useRef<number>(0);
  const { token, role, phase, expiresAt, errorMessage } = useRoomStore();
  const { isLocked } = useTransferStore();
  const [channelDropped, setChannelDropped] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);

  const handleChannelClose = useCallback(
    (reason: 'closed' | 'error') => {
      if (isLocked) {
        console.warn('[Room] DataChannel dropped during transfer:', reason);
        setChannelDropped(true);
      }
    },
    [isLocked],
  );

  const { channelReady, isRelayed, abortCurrent, acceptTransfer, rejectTransfer } = useRoomTransfer({ onChannelClose: handleChannelClose });
  const { lockQueue } = useTransferStore();

  const handleLeaveRoom = useCallback(async () => {
    abortCurrent();
    await leaveRoom();
  }, [abortCurrent, leaveRoom]);

  const handleCopyPin = useCallback(() => {
    const pin = urlToken ?? token ?? '';
    void navigator.clipboard.writeText(pin).then(() => {
      setPinCopied(true);
      clearTimeout(pinCopyTimerRef.current);
      pinCopyTimerRef.current = window.setTimeout(() => setPinCopied(false), 2000);
    });
  }, [urlToken, token]);

  const handleCopyLink = useCallback(() => {
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setLinkCopied(true);
      clearTimeout(linkCopyTimerRef.current);
      linkCopyTimerRef.current = window.setTimeout(() => setLinkCopied(false), 2000);
    });
  }, []);

  useBeforeUnload();

  // 브라우저 뒤로가기/제스처처럼 버튼 클릭 없이 페이지를 벗어나는 경우까지 포함해,
  // 방을 나갈 때는 항상 소켓 연결 해제 + 세션 삭제 + 스토어 초기화가 일어나야 한다.
  // 이전에는 상단 "홈" 버튼이 navigate('/')만 호출하고 이 정리를 건너뛰어서, 뒤로가기로
  // 나가도 소켓이 연결된 채 남아 서버 입장에서는 여전히 방에 있는 것처럼 보였다.
  // navigate는 다시 부르지 않는다(leaveRoomSilently) — 이미 다른 경로로 라우트가 바뀐
  // 뒤라 여기서 또 navigate('/')하면 사용자가 도착한 곳에서 홈으로 다시 끌려간다.
  useEffect(() => {
    return () => {
      if (useRoomStore.getState().token) {
        abortCurrent();
        void leaveRoomSilently();
      }
    };
  }, [abortCurrent, leaveRoomSilently]);

  useEffect(() => {
    if (urlToken && !token) void rejoinByToken(urlToken);
  }, [urlToken, token, rejoinByToken]);

  useEffect(() => {
    if (channelReady) setChannelDropped(false);
  }, [channelReady]);

  const handleStartTransfer = useCallback(() => lockQueue(), [lockQueue]);

  // 세션 확인 중 — rejoinByToken이 유효하지 않으면 navigate('/') 처리
  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">확인 중…</p>
      </div>
    );
  }

  // 상대방이 방을 나간 경우
  if (phase === 'peer_left') {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center space-y-5 w-full max-w-sm">
          <p className="text-gray-900 font-medium text-base">상대방이 방을 나갔습니다</p>
          <p className="text-gray-400 text-sm">세션이 종료되었습니다</p>
          <button
            onClick={() => void navigate('/')}
            className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            홈으로
          </button>
        </div>
      </main>
    );
  }

  const remainingMs = expiresAt ? expiresAt - Date.now() : ROOM_TTL_MS;
  const remainingMin = Math.max(0, Math.floor(remainingMs / 60_000));
  const displayToken = urlToken ?? token;

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
              onClick={handleCopyPin}
              className="text-xs font-medium transition-colors"
              style={{ color: pinCopied ? '#22c55e' : '#3b82f6' }}
            >
              {pinCopied ? '복사됨!' : 'PIN 복사'}
            </button>
            <span className="text-gray-200">|</span>
            <button
              onClick={handleCopyLink}
              className="text-xs font-medium transition-colors"
              style={{ color: linkCopied ? '#22c55e' : '#3b82f6' }}
            >
              {linkCopied ? '복사됨!' : '링크 복사'}
            </button>
          </div>
        </div>

        {/* 연결 상태 카드 */}
        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            {/* 평소엔 그냥 상태 표시처럼 보이지만, 눌러보면 디버그 로그 뷰어가 뜬다 — 티 안 나게 */}
            <div
              className="flex items-center gap-2.5"
              onClick={() => setShowLogViewer(true)}
            >
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

          {/* 채널 드롭 경고 — 눌러도 티 안 나지만 디버그 로그 뷰어가 뜬다 */}
          {channelDropped && !isConnected && (
            <div className="mt-3 pt-3 border-t border-gray-100" onClick={() => setShowLogViewer(true)}>
              <p className="text-sm font-medium text-red-500">채널이 끊겼습니다</p>
              <p className="text-xs text-gray-400 mt-0.5">
                복구 중입니다. 탭을 닫지 마세요.
              </p>
            </div>
          )}

          {/* 상대방 네트워크 끊김 — 재연결 대기. 눌러도 티 안 나지만 디버그 로그 뷰어가 뜬다 */}
          {isDisconnected && (
            <div className="mt-3 pt-3 border-t border-gray-100" onClick={() => setShowLogViewer(true)}>
              <p className="text-sm font-medium text-amber-600">상대방 연결이 끊겼습니다</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {remainingMin}분 안에 돌아오면 이어받을 수 있습니다
              </p>
            </div>
          )}

          {phase === 'error' && errorMessage && (
            <p className="mt-3 text-sm text-red-500">{errorMessage}</p>
          )}

          {/* 방 나가기 버튼 */}
          <div className="mt-4 pt-3 border-t border-gray-100">
            <button
              onClick={() => void handleLeaveRoom()}
              className="w-full py-2 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors"
            >
              방 나가기
            </button>
          </div>
        </div>

        {/* 전송 패널 */}
        {(isConnected || isDisconnected) && role && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <TransferPanel
              role={role}
              onStartTransfer={handleStartTransfer}
              onAccept={acceptTransfer}
              onReject={rejectTransfer}
            />
          </div>
        )}
      </div>

      {showLogViewer && <LogViewerModal onClose={() => setShowLogViewer(false)} />}
    </main>
  );
}

function StatusDot({ phase }: { phase: string }) {
  const base = 'inline-block w-2 h-2 rounded-full flex-shrink-0';
  if (phase === 'peer_connected') return <span className={`${base} bg-green-400`} />;
  if (phase === 'peer_disconnected' || phase === 'error') return <span className={`${base} bg-red-400`} />;
  return <span className={`${base} bg-blue-400 animate-pulse`} />;
}
