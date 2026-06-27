import { create } from 'zustand';
import type { QueuedFile, TransferStatus } from '@/types/transfer';

interface TransferState {
  queue: QueuedFile[];
  currentIndex: number;
  isLocked: boolean;

  addFiles: (files: File[]) => void;
  removeFile: (fileId: string) => void;
  lockQueue: () => void;
  updateFileStatus: (fileId: string, status: TransferStatus) => void;
  updateProgress: (
    fileId: string,
    delta: { sentChunks?: number; receivedChunks?: number; speedBps?: number; etaSeconds?: number }
  ) => void;
  advanceQueue: () => void;
  reset: () => void;
}

function generateFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useTransferStore = create<TransferState>((set) => ({
  queue: [],
  currentIndex: 0,
  isLocked: false,

  addFiles: (files) =>
    set((s) => {
      if (s.isLocked) return s;
      const newItems: QueuedFile[] = files.map((file) => ({
        fileId: generateFileId(),
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

  reset: () => set({ queue: [], currentIndex: 0, isLocked: false }),
}));
