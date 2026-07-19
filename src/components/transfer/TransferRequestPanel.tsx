import type { PendingFileInfo } from '@/store/transferStore';

interface TransferRequestPanelProps {
  files: PendingFileInfo[];
  onAccept: () => void;
  onReject: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function TransferRequestPanel({ files, onAccept, onReject }: TransferRequestPanelProps) {
  const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">파일 수신 요청</p>
        <p className="text-xs text-gray-400 mt-0.5">상대방이 파일을 보냈습니다</p>
      </div>

      <div className="space-y-2">
        {files.map((file) => (
          <div key={file.fileId} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
            <p className="text-sm text-gray-800 truncate min-w-0">{file.fileName}</p>
            <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(file.fileSize)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>파일 {files.length}개</span>
        <span>총 {formatBytes(totalSize)}</span>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onReject}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          거절
        </button>
        <button
          onClick={onAccept}
          className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm"
        >
          수락
        </button>
      </div>
    </div>
  );
}
