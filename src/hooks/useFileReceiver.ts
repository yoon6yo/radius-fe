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
  chunkHashes: string[];
  fileHash: string;
  receivedCount: number;
  exportPhase: ExportPhase;
  exportError: string | null;
}

export function useFileReceiver(sendControl: (msg: ControlMessage) => void) {
  const writerRef = useRef<FileWriter | null>(null);
  const receivedBitmap = useRef<Set<number>>(new Set());
  const hashPartsReceived = useRef(0);
  const allHashesRef = useRef<string[]>([]);

  const [state, setState] = useState<FileReceiveState>({
    meta: null,
    chunkHashes: [],
    fileHash: '',
    receivedCount: 0,
    exportPhase: 'idle',
    exportError: null,
  });

  // ── 제어 메시지 처리 ────────────────────────────────────────
  const handleControl = useCallback(
    async (msg: ControlMessage) => {
      if (msg.type === 'FILE_META') {
        // 새 파일 수신 시작
        receivedBitmap.current = new Set();
        hashPartsReceived.current = 0;
        allHashesRef.current = [];

        setState({
          meta: msg,
          chunkHashes: [],
          fileHash: '',
          receivedCount: 0,
          exportPhase: 'receiving',
          exportError: null,
        });

        // OPFS 파일 핸들 생성
        writerRef.current = await OPFSFileWriter.create(msg.fileName);
        return;
      }

      if (msg.type === 'HASH_PART') {
        allHashesRef.current.push(...msg.hashes);
        hashPartsReceived.current++;

        setState((s) => ({
          ...s,
          chunkHashes: [...allHashesRef.current],
        }));
        return;
      }

      if (msg.type === 'HASH_DONE') {
        setState((s) => ({ ...s, fileHash: msg.fileHash }));

        // 이어받기 여부 확인 후 READY/RESUME 전송
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
    [sendControl],
  );

  // ── 바이너리 청크 처리 ──────────────────────────────────────
  const handleBinaryChunk = useCallback(async (buffer: ArrayBuffer) => {
    const { chunkIndex, data } = parseChunk(buffer);
    const offset = chunkIndex * CHUNK_SIZE;

    await writerRef.current?.write(data, offset);
    receivedBitmap.current.add(chunkIndex);

    setState((s) => ({ ...s, receivedCount: receivedBitmap.current.size }));
  }, []);

  // ── 전송 완료 처리 ──────────────────────────────────────────
  const handleTransferDone = async (msg: TransferDone) => {
    await writerRef.current?.close();
    writerRef.current = null;

    setState((s) => ({ ...s, exportPhase: 'exporting' }));

    try {
      const meta = state.meta;
      if (!meta) throw new Error('meta is null');

      await exportFromOPFS(meta.fileName, undefined, (_loaded, _total) => {
        // 진행률은 단계 10에서 추가
      });

      sendControl({ type: 'VERIFY_OK', fileId: msg.fileId });
      setState((s) => ({ ...s, exportPhase: 'done' }));

      // OPFS에서 임시 파일 제거
      await deleteFromOPFS(meta.fileName);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, exportPhase: 'error', exportError: errorMsg }));
    }
  };

  return { state, handleControl, handleBinaryChunk };
}
