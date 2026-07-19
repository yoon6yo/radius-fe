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
  // 수락은 눌렀지만 아직 첫 FILE_META를 못 받은 구간(송신 측 해싱 대기)에 보여줄 정보.
  // 이게 없으면 이 구간이 "아무 요청도 없는 대기 상태"와 화면상 구분이 안 됨.
  acceptedRequest: PendingFileInfo[] | null;

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
  acceptPendingRequest: () => void;
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
  acceptedRequest: null,

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
      // 실제 데이터가 도착했으니 "준비 중" 화면은 더 이상 필요 없음
      acceptedRequest: null,
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
  // 수락 버튼을 누른 시점 — pendingRequest를 그냥 버리지 않고 acceptedRequest로 옮겨서
  // 첫 FILE_META가 올 때까지의 공백 구간에도 어떤 파일을 기다리는지 계속 보여줄 수 있게 함
  acceptPendingRequest: () =>
    set((s) => ({ pendingRequest: null, acceptedRequest: s.pendingRequest })),

  reset: () => set({ queue: [], currentIndex: 0, isLocked: false, pendingRequest: null, acceptedRequest: null }),
}));
