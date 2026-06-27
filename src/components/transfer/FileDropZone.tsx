import { useCallback, useState } from 'react';

interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function FileDropZone({ onFiles, disabled }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(files);
    },
    [onFiles, disabled],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length) onFiles(files);
      e.target.value = '';
    },
    [onFiles],
  );

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={[
        'flex flex-col items-center justify-center gap-2',
        'border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors',
        isDragging && !disabled
          ? 'border-indigo-500 bg-indigo-500/10'
          : 'border-gray-700 hover:border-gray-500',
        disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : '',
      ].join(' ')}
    >
      <span className="text-3xl">📁</span>
      <p className="text-sm text-gray-400 text-center">
        파일을 끌어다 놓거나 클릭하여 선택
      </p>
      <input
        type="file"
        multiple
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
    </label>
  );
}
