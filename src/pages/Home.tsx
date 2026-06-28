import { useState, useCallback } from 'react';
import { useSignaling } from '@/hooks/useSignaling';
import { useResumeDetection } from '@/hooks/useResumeDetection';
import { ResumeBanner } from '@/components/ui/ResumeBanner';
import { TOKEN_ALPHABET } from '@/constants/transfer';

const TOKEN_PATTERN = new RegExp(`^[${TOKEN_ALPHABET}]{6}$`);

export default function Home() {
  const { createRoom, joinRoom } = useSignaling();
  const { resumeInfo, dismiss } = useResumeDetection();
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    await createRoom();
    setIsCreating(false);
  }, [createRoom]);

  const handleJoin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const normalized = pin.trim().toUpperCase();
      if (!TOKEN_PATTERN.test(normalized)) {
        setPinError('올바른 핀 번호를 입력해주세요 (영숫자 6자 이상)');
        return;
      }
      setPinError('');
      await joinRoom(normalized);
    },
    [joinRoom, pin],
  );

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
      {resumeInfo && (
        <ResumeBanner
          session={resumeInfo.session}
          pendingTransfers={resumeInfo.pendingTransfers}
          onDismiss={dismiss}
        />
      )}

      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Radius</h1>
          <p className="text-gray-400 text-sm">서버를 거치지 않는 P2P 파일 공유</p>
        </div>

        <button
          onClick={() => void handleCreate()}
          disabled={isCreating}
          className="w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
        >
          {isCreating ? '룸 생성 중…' : '새 룸 만들기'}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-800" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-950 text-gray-500">또는</span>
          </div>
        </div>

        <form onSubmit={(e) => void handleJoin(e)} className="space-y-3">
          <div>
            <input
              type="text"
              value={pin}
              onChange={(e) => setPin(e.target.value.toUpperCase())}
              placeholder="핀 번호 입력 (예: AB3XK9)"
              maxLength={20}
              className="w-full py-3 px-4 bg-gray-900 border border-gray-700 rounded-lg text-center tracking-widest text-lg font-mono placeholder:text-gray-600 focus:outline-none focus:border-indigo-500"
            />
            {pinError && <p className="mt-1 text-sm text-red-400">{pinError}</p>}
          </div>
          <button
            type="submit"
            disabled={!pin.trim()}
            className="w-full py-3 px-6 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
          >
            룸 참여
          </button>
        </form>
      </div>
    </main>
  );
}
