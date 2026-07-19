import type { QueuedFile } from '@/types/transfer';

interface FileQueueItemProps {
  item: QueuedFile;
  index: number;
  currentIndex: number;
  isLocked: boolean;
  onRemove: (fileId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}초`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}분 ${s}초`;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  queued:         { label: '대기',       className: 'bg-gray-100 text-gray-500' },
  waiting_accept: { label: '수락 대기',  className: 'bg-amber-50 text-amber-600' },
  hashing:        { label: '해싱 중',    className: 'bg-blue-50 text-blue-500' },
  waiting_ready:  { label: '응답 대기',  className: 'bg-blue-50 text-blue-500' },
  transferring:   { label: '전송 중',    className: 'bg-blue-50 text-blue-600' },
  verifying:      { label: '검증 중',    className: 'bg-blue-50 text-blue-500' },
  done:           { label: '완료',       className: 'bg-green-50 text-green-600' },
  error:          { label: '오류',       className: 'bg-red-50 text-red-500' },
};

export function FileQueueItem({
  item,
  index,
  currentIndex,
  isLocked,
  onRemove,
}: FileQueueItemProps) {
  const isActive = isLocked && index === currentIndex;
  const isDone = item.status === 'done';
  const isPending = isLocked && index > currentIndex;

  const progress =
    item.totalChunks > 0
      ? Math.round(((item.sentChunks + item.receivedChunks) / item.totalChunks) * 100)
      : 0;

  const { label, className } = STATUS_CONFIG[item.status] ?? { label: item.status, className: 'bg-gray-100 text-gray-500' };

  return (
    <div
      className={[
        'rounded-xl p-4 transition-all',
        isActive ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-gray-50',
        isDone ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{item.file.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatBytes(item.file.size)}
            {isActive && item.speedBps > 0 && (
              <> · {formatSpeed(item.speedBps)} · 남은 시간 {formatEta(item.etaSeconds)}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${className}`}>
            {label}
          </span>
          {!isLocked && (
            <button
              onClick={() => onRemove(item.fileId)}
              className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {isLocked && !isDone && (
        <div className="mt-3">
          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: isPending ? '0%' : `${progress}%` }}
            />
          </div>
          {!isPending && (
            <p className="text-xs text-gray-400 text-right mt-1">{progress}%</p>
          )}
        </div>
      )}
    </div>
  );
}
