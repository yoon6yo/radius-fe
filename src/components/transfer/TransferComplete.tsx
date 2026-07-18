interface TransferCompleteProps {
  totalFiles: number;
  onReset: () => void;
}

export function TransferComplete({ totalFiles, onReset }: TransferCompleteProps) {
  return (
    <div className="text-center space-y-4 py-2">
      <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-gray-900">전송 완료</p>
        <p className="text-sm text-gray-400 mt-1">{totalFiles}개 파일이 모두 전달되었습니다</p>
      </div>
      <button
        onClick={onReset}
        className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition-colors"
      >
        새 전송
      </button>
    </div>
  );
}
