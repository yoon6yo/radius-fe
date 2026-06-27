interface TransferCompleteProps {
  totalFiles: number;
  onReset: () => void;
}

export function TransferComplete({ totalFiles, onReset }: TransferCompleteProps) {
  return (
    <div className="text-center space-y-4 py-4">
      <div className="text-4xl">✅</div>
      <div>
        <p className="font-semibold text-green-400">전송 완료!</p>
        <p className="text-sm text-gray-400 mt-1">
          {totalFiles}개 파일이 모두 전달되었습니다
        </p>
      </div>
      <button
        onClick={onReset}
        className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
      >
        새 전송 시작
      </button>
    </div>
  );
}
