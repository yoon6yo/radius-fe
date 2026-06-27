import { useCallback, useRef, useState } from 'react';
import { OPFSFileWriter, exportFromOPFS, deleteFromOPFS } from '@/lib/fileWriter';
import { parseChunk } from '@/lib/chunkUtils';
import { CHUNK_SIZE } from '@/constants/transfer';
import type { FileWriter } from '@/lib/fileWriter';
import type {
  FileMeta,
  TransferDone,
  ControlMessage,
} from '@/types/transfer';

export type ExportPhase = 'idle' | 'receiving' | 'exporting' | 'done' | 'error';

interface FileReceiveState {
  meta: FileMeta | null;
  receivedCount: number;
  exportPhase: ExportPhase;
  exportError: string | null;
}

interface UseFileReceiverOptions {
  sendControl: (msg: ControlMessage) => void;
  verifyChunkHash: (fileId: string, chunkIndex: number, data: ArrayBuffer) => Promise<boolean>;
  verifyFileHash: (fileId: string, fileName: string, expectedHash: string) => Promise<boolean>;
  // IndexedDB 비트맵 영속화 연동
  onChunkVerified?: (fileId: string, chunkIndex: number) => void;
  onTransferComplete?: (fileId: string) => Promise<void>;
  getRestoredIndices?: (fileId: string) => Promise<number[]>;
}

export function useFileReceiver({
  sendControl,
  verifyChunkHash,
  verifyFileHash,
  onChunkVerified,
  onTransferComplete,
  getRestoredIndices,
}: UseFileReceiverOptions) {
  const writerRef = useRef<FileWriter | null>(null);
  const receivedBitmap = useRef<Set<number>>(new Set());
  const chunkHashesRef = useRef<string[]>([]);
  const fileHashRef = useRef('');
  const metaRef = useRef<FileMeta | null>(null);

  const [state, setState] = useState<FileReceiveState>({
    meta: null,
    receivedCount: 0,
    exportPhase: 'idle',
    exportError: null,
  });

  // ── 제어 메시지 처리 ────────────────────────────────────────
  const handleControl = useCallback(
    async (msg: ControlMessage) => {
      if (msg.type === 'FILE_META') {
        chunkHashesRef.current = [];
        fileHashRef.current = '';
        metaRef.current = msg;

        // IndexedDB에서 이전 수신 인덱스 복원
        const restored = getRestoredIndices
          ? await getRestoredIndices(msg.fileId)
          : [];
        receivedBitmap.current = new Set(restored);

        setState({
          meta: msg,
          receivedCount: restored.length,
          exportPhase: 'receiving',
          exportError: null,
        });

        writerRef.current = await OPFSFileWriter.create(msg.fileName);
        return;
      }

      if (msg.type === 'HASH_PART') {
        chunkHashesRef.current.push(...msg.hashes);
        return;
      }

      if (msg.type === 'HASH_DONE') {
        fileHashRef.current = msg.fileHash;

        const received = [...receivedBitmap.current];
        if (received.length > 0) {
          sendControl({ type: 'RESUME', fileId: msg.fileId, receivedIndices: received });
        } else {
          sendControl({ type: 'READY', fileId: msg.fileId });
        }
        return;
      }

      if (msg.type === 'TRANSFER_DONE') {
        await handleTransferDone(msg);
      }
    },
    [sendControl, getRestoredIndices],
  );

  // ── 바이너리 청크 처리 + 해시 검증 ─────────────────────────
  const handleBinaryChunk = useCallback(
    async (buffer: ArrayBuffer) => {
      const { chunkIndex, data } = parseChunk(buffer);

      // 이미 받은 청크는 건너뜀 (이어받기 시나리오)
      if (receivedBitmap.current.has(chunkIndex)) return;

      const offset = chunkIndex * CHUNK_SIZE;
      await writerRef.current?.write(data, offset);

      const valid = await verifyChunkHash(
        metaRef.current?.fileId ?? '',
        chunkIndex,
        data,
      );

      if (valid) {
        receivedBitmap.current.add(chunkIndex);
        onChunkVerified?.(metaRef.current?.fileId ?? '', chunkIndex);
        setState((s) => ({ ...s, receivedCount: receivedBitmap.current.size }));
      }
      // 검증 실패 → 비트맵 미기록 → 재연결 시 자동 재요청 대상
    },
    [verifyChunkHash, onChunkVerified],
  );

  // ── 전송 완료 처리 ──────────────────────────────────────────
  const handleTransferDone = async (msg: TransferDone) => {
    await writerRef.current?.close();
    writerRef.current = null;

    const meta = metaRef.current;
    if (!meta) return;

    setState((s) => ({ ...s, exportPhase: 'exporting' }));

    try {
      const fileValid = await verifyFileHash(
        msg.fileId,
        meta.fileName,
        fileHashRef.current,
      );

      if (!fileValid) {
        console.error('[Receiver] 전체 파일 해시 불일치 — 클라이언트 로직 버그 의심', {
          fileId: msg.fileId,
          fileName: meta.fileName,
          expectedHash: fileHashRef.current,
        });
        sendControl({
          type: 'VERIFY_FAIL',
          fileId: msg.fileId,
          reason: 'file_hash_mismatch',
        });
        setState((s) => ({
          ...s,
          exportPhase: 'error',
          exportError: '파일 무결성 검증 실패. 처음부터 다시 시도해주세요.',
        }));
        await deleteFromOPFS(meta.fileName);
        return;
      }

      await exportFromOPFS(meta.fileName);
      await onTransferComplete?.(msg.fileId);

      sendControl({ type: 'VERIFY_OK', fileId: msg.fileId });
      setState((s) => ({ ...s, exportPhase: 'done' }));

      await deleteFromOPFS(meta.fileName);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, exportPhase: 'error', exportError: errorMsg }));
    }
  };

  const getReceivedIndices = useCallback(() => [...receivedBitmap.current], []);
  const getChunkHashes = useCallback(() => chunkHashesRef.current, []);
  const getFileHash = useCallback(() => fileHashRef.current, []);

  return {
    state,
    handleControl,
    handleBinaryChunk,
    getReceivedIndices,
    getChunkHashes,
    getFileHash,
  };
}
