import { useState } from 'react';
import { useDebugLog } from '@/hooks/useDebugLog';
import { clearLogEntries, formatLogEntries } from '@/lib/debugLog';

interface LogViewerModalProps {
  onClose: () => void;
}

const LEVEL_CLASS: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  log: 'text-gray-300',
};

export function LogViewerModal({ onClose }: LogViewerModalProps) {
  const entries = useDebugLog();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(formatLogEntries(entries)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
          <p className="text-sm font-semibold text-white">디버그 로그 ({entries.length})</p>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-lg leading-none transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs leading-relaxed">
          {entries.length === 0 ? (
            <p className="text-gray-500 py-4 text-center">아직 기록된 로그가 없습니다</p>
          ) : (
            entries.map((entry, i) => (
              <p key={i} className={`${LEVEL_CLASS[entry.level] ?? 'text-gray-300'} whitespace-pre-wrap break-all py-0.5`}>
                <span className="text-gray-600">{new Date(entry.time).toLocaleTimeString()}</span> {entry.message}
              </p>
            ))
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-gray-700 flex-shrink-0">
          <button
            onClick={handleCopy}
            className="flex-1 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition-colors"
          >
            {copied ? '복사됨!' : '전체 복사'}
          </button>
          <button
            onClick={clearLogEntries}
            className="flex-1 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-xl font-medium transition-colors"
          >
            지우기
          </button>
        </div>
      </div>
    </div>
  );
}
