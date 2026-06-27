import { useNavigate } from 'react-router-dom';
import type { SessionRecord, TransferRecord } from '@/types/transfer';

interface ResumeBannerProps {
  session: SessionRecord;
  pendingTransfers: TransferRecord[];
  onDismiss: () => void;
}

export function ResumeBanner({ session, pendingTransfers, onDismiss }: ResumeBannerProps) {
  const navigate = useNavigate();
  const remainingMin = Math.max(
    0,
    Math.floor((session.expiresAt - Date.now()) / 60_000),
  );

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 w-full max-w-sm z-50 px-4">
      <div className="bg-gray-800 border border-indigo-500/50 rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-indigo-400">이전 전송 이어받기 가능</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {pendingTransfers.length}개 파일 미완료 · 룸 {remainingMin}분 후 만료
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="text-gray-500 hover:text-gray-300 text-sm flex-shrink-0"
          >
            ✕
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void navigate(`/r/${session.token}`)}
            className="flex-1 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors"
          >
            이어받기
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
          >
            무시
          </button>
        </div>
      </div>
    </div>
  );
}
