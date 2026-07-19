import type { PendingFileInfo } from '@/store/transferStore';

interface TransferPreparingPanelProps {
  files: PendingFileInfo[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// 수락 버튼을 누른 뒤 상대방이 해시 계산을 마치고 첫 FILE_META를 보낼 때까지의 공백 구간.
// 이 화면이 없으면 "아직 아무 요청도 없는 대기 상태"와 구분이 안 돼 멈춘 것처럼 보인다.
export function TransferPreparingPanel({ files }: TransferPreparingPanelProps) {
  const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);

  return (
    <div className="space-y-4">
      <div className="text-center py-2">
        <div className="w-10 h-10 mx-auto mb-3 relative">
          <div className="absolute inset-0 rounded-full border-2 border-blue-100" />
          <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
        </div>
        <p className="text-sm font-medium text-gray-700">상대방이 전송을 준비하고 있어요</p>
        <p className="text-xs text-gray-400 mt-1">잠시 후 자동으로 수신이 시작됩니다</p>
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
    </div>
  );
}
