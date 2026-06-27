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
  if (seconds < 60) return `${Math.ceil(seconds)}초 남음`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}분 ${s}초 남음`;
}

const STATUS_LABEL: Record<string, string> = {
  queued: '대기 중',
  hashing: '해시 계산 중',
  waiting_ready: '상대방 준비 중',
  transferring: '전송 중',
  verifying: '검증 중',
  done: '완료',
  error: '오류',
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
      ? Math.round(
          ((item.sentChunks + item.receivedChunks) / item.totalChunks) * 100,
        )
      : 0;

  return (
    <div
      className={[
        'rounded-lg p-3 space-y-2 border',
        isActive ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-800 bg-gray-900',
        isDone ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{item.file.name}</p>
          <p className="text-xs text-gray-500">
            {formatBytes(item.file.size)}
            {isActive && item.speedBps > 0 && (
              <> · {formatSpeed(item.speedBps)} · {formatEta(item.etaSeconds)}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={[
              'text-xs px-2 py-0.5 rounded',
              isDone
                ? 'bg-green-500/20 text-green-400'
                : isActive
                  ? 'bg-indigo-500/20 text-indigo-400'
                  : 'bg-gray-700 text-gray-400',
            ].join(' ')}
          >
            {STATUS_LABEL[item.status] ?? item.status}
          </span>
          {!isLocked && (
            <button
              onClick={() => onRemove(item.fileId)}
              className="text-gray-600 hover:text-red-400 transition-colors text-sm"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 진행률 바 */}
      {isLocked && !isDone && (
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {isLocked && (
        <p className="text-xs text-gray-600 text-right">
          {isPending ? '대기' : `${progress}%`}
        </p>
      )}
    </div>
  );
}
