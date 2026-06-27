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
    <div className="space-y-4">
      {/* 전송 진행 헤더 */}
      {isLocked && queue.length > 0 && (
        <div className="text-sm text-gray-400 text-center">
          {currentIndex + 1} / {queue.length} 번째 파일 전송 중
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

      {/* 수신자 안내 */}
      {role === 'answerer' && !isLocked && (
        <p className="text-sm text-gray-500 text-center py-4">
          상대방이 파일을 보내면 자동으로 수신됩니다
        </p>
      )}

      {/* 전송 시작 버튼 */}
      {canStart && (
        <button
          onClick={onStartTransfer}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold transition-colors"
        >
          전송 시작 ({queue.length}개 파일)
        </button>
      )}

      {/* OPFS quota 안내 */}
      {role === 'answerer' && (
        <p className="text-xs text-gray-600 text-center">
          수신 파일은 브라우저 내부 저장소에 임시 저장됩니다. 브라우저 데이터를 지우면
          수신 중인 파일이 사라질 수 있습니다.
        </p>
      )}
    </div>
  );
}
