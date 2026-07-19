import { useState, useCallback } from 'react';
import { useSignaling } from '@/hooks/useSignaling';
import { useResumeDetection } from '@/hooks/useResumeDetection';
import { ResumeBanner } from '@/components/ui/ResumeBanner';
import { TOKEN_PATTERN } from '@/constants/transfer';

export default function Home() {
  const { createRoom, joinRoom } = useSignaling();
  const { resumeInfo, dismiss } = useResumeDetection();
  const [step, setStep] = useState<'select' | 'receive'>('select');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = useCallback(async () => {
    setIsLoading(true);
    await createRoom();
    setIsLoading(false);
  }, [createRoom]);

  const handleJoin = useCallback(
    async () => {
      const normalized = pin.trim();
      if (!TOKEN_PATTERN.test(normalized)) {
        setPinError('숫자 6자리를 입력해주세요');
        return;
      }
      setPinError('');
      setIsLoading(true);
      const result = await joinRoom(normalized);
      if (!result.ok) {
        setPinError(result.error);
      }
      setIsLoading(false);
    },
    [joinRoom, pin],
  );

  const handleBack = useCallback(() => {
    setStep('select');
    setPin('');
    setPinError('');
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      {resumeInfo && (
        <ResumeBanner
          session={resumeInfo.session}
          pendingTransfers={resumeInfo.pendingTransfers}
          onDismiss={dismiss}
        />
      )}

      <div className="w-full max-w-xs">
        {/* 로고 */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">rdrop</h1>
          <p className="text-gray-600 mt-1.5 text-sm">파일을 직접, 빠르게</p>
        </div>

        {step === 'select' ? (
          <div className="space-y-3">
            {/* 보내기 */}
            <button
              onClick={() => void handleSend()}
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-300 text-white rounded-2xl p-5 text-left transition-all duration-150 shadow-sm"
            >
              <span className="text-2xl block mb-2">📤</span>
              <span className="font-semibold text-base block">
                {isLoading ? '룸 생성 중…' : '파일 보내기'}
              </span>
              <span className="text-white/80 text-sm mt-0.5 block">
                PIN을 공유해 상대방을 초대하세요
              </span>
            </button>

            {/* 받기 */}
            <button
              onClick={() => setStep('receive')}
              disabled={isLoading}
              className="w-full bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-200 rounded-2xl p-5 text-left transition-all duration-150 shadow-sm"
            >
              <span className="text-2xl block mb-2">📥</span>
              <span className="font-semibold text-base text-gray-900 block">파일 받기</span>
              <span className="text-gray-600 text-sm mt-0.5 block">
                상대방에게 받은 PIN을 입력하세요
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-gray-500 text-sm hover:text-gray-700 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              뒤로
            </button>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 mb-1">PIN 입력</h2>
              <p className="text-sm text-gray-600 mb-5">
                상대방에게 받은 6자리 숫자를 입력하세요
              </p>

              <form onSubmit={(e) => { e.preventDefault(); void handleJoin(); }} className="space-y-3">
                <div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="\d{6}"
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setPinError('');
                    }}
                    placeholder="000 000"
                    maxLength={6}
                    autoFocus
                    className="w-full py-3.5 px-4 border border-gray-200 rounded-xl text-center tracking-[0.5em] text-2xl font-mono text-gray-900 placeholder:text-gray-300 placeholder:tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                  {pinError && (
                    <p className="mt-2 text-sm text-red-500 text-center">{pinError}</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={pin.length < 6 || isLoading}
                  className="w-full py-3.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-base transition-all duration-150"
                >
                  {isLoading ? '연결 중…' : '연결하기'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
