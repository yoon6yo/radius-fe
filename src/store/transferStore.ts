import { create } from 'zustand';
import type { QueuedFile, TransferStatus } from '@/types/transfer';

export interface PendingFileInfo {
  fileId: string;
  fileName: string;
  fileSize: number;
}

interface TransferState {
  queue: QueuedFile[];
  currentIndex: number;
  isLocked: boolean;
  pendingRequest: PendingFileInfo[] | null;

  addFiles: (files: File[]) => void;
  addReceivedFile: (fileId: string, fileName: string, fileSize: number, totalChunks: number) => void;
  removeFile: (fileId: string) => void;
  lockQueue: () => void;
  updateFileStatus: (fileId: string, status: TransferStatus) => void;
  updateProgress: (
    fileId: string,
    delta: { totalChunks?: number; sentChunks?: number; receivedChunks?: number; speedBps?: number; etaSeconds?: number }
  ) => void;
  advanceQueue: () => void;
  setPendingRequest: (files: PendingFileInfo[]) => void;
  clearPendingRequest: () => void;
  reset: () => void;
}

function generateFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useTransferStore = create<TransferState>((set) => ({
  queue: [],
  currentIndex: 0,
  isLocked: false,
  pendingRequest: null,

  addFiles: (files) =>
    set((s) => {
      if (s.isLocked) return s;
      const newItems: QueuedFile[] = files.map((file) => ({
        fileId: generateFileId(),
        fileName: file.name,
        fileSize: file.size,
        file,
        status: 'queued',
        totalChunks: 0,
        sentChunks: 0,
        receivedChunks: 0,
        speedBps: 0,
        etaSeconds: 0,
      }));
      return { queue: [...s.queue, ...newItems] };
    }),

  addReceivedFile: (fileId, fileName, fileSize, totalChunks) =>
    set((s) => ({
      queue: [
        ...s.queue,
        {
          fileId,
          fileName,
          fileSize,
          file: undefined,
          status: 'transferring' as const,
          totalChunks,
          sentChunks: 0,
          receivedChunks: 0,
          speedBps: 0,
          etaSeconds: 0,
        },
      ],
      isLocked: true,
    })),

  removeFile: (fileId) =>
    set((s) => {
      if (s.isLocked) return s;
      return { queue: s.queue.filter((f) => f.fileId !== fileId) };
    }),

  lockQueue: () => set({ isLocked: true }),

  updateFileStatus: (fileId, status) =>
    set((s) => ({
      queue: s.queue.map((f) => (f.fileId === fileId ? { ...f, status } : f)),
    })),

  updateProgress: (fileId, delta) =>
    set((s) => ({
      queue: s.queue.map((f) =>
        f.fileId === fileId ? { ...f, ...delta } : f,
      ),
    })),

  advanceQueue: () => set((s) => ({ currentIndex: s.currentIndex + 1 })),

  setPendingRequest: (files) => set({ pendingRequest: files }),
  clearPendingRequest: () => set({ pendingRequest: null }),

  reset: () => set({ queue: [], currentIndex: 0, isLocked: false, pendingRequest: null }),
}));
