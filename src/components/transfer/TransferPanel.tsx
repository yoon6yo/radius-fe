import { useCallback } from 'react';
import { FileDropZone } from './FileDropZone';
import { FileQueueItem } from './FileQueueItem';
import { TransferComplete } from './TransferComplete';
import { useTransferStore } from '@/store/transferStore';

interface TransferPanelProps {
  onStartTransfer: () => void;
  role: 'offerer' | 'answerer';
}

export function TransferPanel({ onStartTransfer, role }: TransferPanelProps) {
  const { queue, currentIndex, isLocked, addFiles, removeFile, reset } = useTransferStore();

  const handleFiles = useCallback(
    (files: File[]) => {
      if (isLocked) return;
      addFiles(files);
    },
    [isLocked, addFiles],
  );

  const canStart = !isLocked && queue.length > 0 && role === 'offerer';
  const totalDone = queue.filter((f) => f.status === 'done').length;
  const isAllDone = isLocked && queue.length > 0 && totalDone === queue.length;

  if (isAllDone) {
    return <TransferComplete totalFiles={queue.length} onReset={reset} />;
  }

  return (
    <div className="space-y-3">
      {/* 수신 대기 안내 */}
      {role === 'answerer' && !isLocked && queue.length === 0 && (
        <div className="text-center py-6">
          <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700">파일 수신 대기 중</p>
          <p className="text-xs text-gray-400 mt-1">상대방이 파일을 보내면 자동으로 수신됩니다</p>
        </div>
      )}

      {/* 전송 진행 헤더 */}
      {isLocked && queue.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">
            {role === 'offerer' ? '전송 중' : '수신 중'}
          </p>
          <p className="text-xs text-gray-400">
            {Math.min(currentIndex + 1, queue.length)} / {queue.length}
          </p>
        </div>
      )}

      {/* 파일 선택 영역 */}
      {!isLocked && role === 'offerer' && (
        <FileDropZone onFiles={handleFiles} disabled={isLocked} />
      )}

      {/* 파일 목록 */}
      {queue.length > 0 && (
        <div className="space-y-2">
          {queue.map((item, idx) => (
            <FileQueueItem
              key={item.fileId}
              item={item}
              index={idx}
              currentIndex={currentIndex}
              isLocked={isLocked}
              onRemove={removeFile}
            />
          ))}
        </div>
      )}

      {/* 전송 시작 버튼 */}
      {canStart && (
        <button
          onClick={onStartTransfer}
          className="w-full py-3.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-all duration-150 shadow-sm"
        >
          전송 시작 {queue.length > 1 ? `(${queue.length}개)` : ''}
        </button>
      )}

      {/* OPFS 안내 */}
      {role === 'answerer' && queue.length > 0 && (
        <p className="text-xs text-gray-300 text-center">
          수신 파일은 브라우저 임시 저장소에 보관됩니다
        </p>
      )}
    </div>
  );
}
