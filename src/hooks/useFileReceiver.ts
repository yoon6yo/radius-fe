import { useCallback, useRef, useState } from 'react';
import { OPFSFileWriter, exportFromOPFS, deleteFromOPFS } from '@/lib/fileWriter';
import { parseChunk, isValidFileMeta } from '@/lib/chunkUtils';
import { CHUNK_SIZE, PROGRESS_UPDATE_MS } from '@/constants/transfer';
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
  onChunkVerified?: (fileId: string, chunkIndex: number) => void;
  onTransferComplete?: (fileId: string) => Promise<void>;
  getRestoredIndices?: (fileId: string) => Promise<number[]>;
  onProgress?: (fileId: string, received: number, total: number) => void;
  onFileDone?: (fileId: string) => void;
}

export function useFileReceiver({
  sendControl,
  verifyChunkHash,
  verifyFileHash,
  onChunkVerified,
  onTransferComplete,
  getRestoredIndices,
  onProgress,
  onFileDone,
}: UseFileReceiverOptions) {
  const writerRef = useRef<FileWriter | null>(null);
  const receivedBitmap = useRef<Set<number>>(new Set());
  const chunkHashesRef = useRef<string[]>([]);
  const fileHashRef = useRef('');
  const metaRef = useRef<FileMeta | null>(null);
  const chunkQueueRef = useRef<Promise<void>>(Promise.resolve());
  // state.receivedCount는 현재 어떤 UI도 구독하지 않지만, 매 청크마다 setState하면
  // 이 훅을 호출하는 컴포넌트가 파일당 수천 번 리렌더된다. 다른 진행률 갱신과
  // 동일하게 leading+trailing 스로틀을 적용해 리렌더 횟수를 줄인다.
  const lastStateFlushRef = useRef(0);
  const stateFlushTimerRef = useRef(0);

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
        // 상대 피어가 보낸 값이므로 사용 전 검증 — 조작된 크기/청크 수 조합을 거부한다.
        if (!isValidFileMeta(msg)) {
          console.warn('[Receiver] rejecting invalid FILE_META:', msg);
          return;
        }
        console.log('[Receiver] FILE_META:', msg.fileId, msg.fileName);
        chunkHashesRef.current = [];
        fileHashRef.current = '';
        metaRef.current = msg;
        chunkQueueRef.current = Promise.resolve();
        lastStateFlushRef.current = 0;
        clearTimeout(stateFlushTimerRef.current);

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

        writerRef.current = await OPFSFileWriter.create(msg.fileName, restored.length > 0);
        return;
      }

      if (msg.type === 'HASH_PART') {
        chunkHashesRef.current.push(...msg.hashes);
        return;
      }

      if (msg.type === 'HASH_DONE') {
        fileHashRef.current = msg.fileHash;

        const received = [...receivedBitmap.current];
        console.log(
          '[Receiver] HASH_DONE:', msg.fileId,
          '→ sending', received.length > 0 ? 'RESUME' : 'READY',
          'chunkHashes:', chunkHashesRef.current.length,
        );
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
  // 청크를 직렬 큐로 처리해 OPFS 동시 write race와 TRANSFER_DONE 선행 처리를 방지
  const handleBinaryChunk = useCallback(
    (buffer: ArrayBuffer): void => {
      chunkQueueRef.current = chunkQueueRef.current.then(async () => {
        const { chunkIndex, data } = parseChunk(buffer);

        // 상대는 신뢰할 수 없는 피어 — chunkIndex를 조작해 OPFS에 임의로 큰 오프셋을
        // 쓰게 만들 수 있으므로(스토리지 소진 DoS) 실제 쓰기 전에 범위를 검증한다.
        const totalChunks = metaRef.current?.totalChunks ?? 0;
        if (chunkIndex >= totalChunks || data.byteLength > CHUNK_SIZE) {
          console.warn('[Receiver] rejecting out-of-range chunk:', chunkIndex, '/', totalChunks);
          return;
        }

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
          const count = receivedBitmap.current.size;

          const now = Date.now();
          clearTimeout(stateFlushTimerRef.current);
          if (now - lastStateFlushRef.current >= PROGRESS_UPDATE_MS) {
            lastStateFlushRef.current = now;
            setState((s) => ({ ...s, receivedCount: count }));
          } else {
            stateFlushTimerRef.current = window.setTimeout(() => {
              lastStateFlushRef.current = Date.now();
              setState((s) => ({ ...s, receivedCount: count }));
            }, PROGRESS_UPDATE_MS);
          }

          onProgress?.(metaRef.current?.fileId ?? '', count, metaRef.current?.totalChunks ?? 0);
        }
      }).catch(() => {});
    },
    [verifyChunkHash, onChunkVerified, onProgress],
  );

  // ── 전송 완료 처리 ──────────────────────────────────────────
  const handleTransferDone = async (msg: TransferDone) => {
    console.log('[Receiver] TRANSFER_DONE:', msg.fileId, '— 남은 청크 큐 비우는 중');
    // TRANSFER_DONE 수신 시점에 아직 처리 중인 청크가 있을 수 있으므로 큐가 비워질 때까지 대기
    await chunkQueueRef.current;

    const meta = metaRef.current;
    if (!meta || meta.fileId !== msg.fileId) {
      console.warn('[Receiver] TRANSFER_DONE fileId 불일치 또는 meta 없음 — 무시:', msg.fileId, 'current meta:', meta?.fileId);
      return;
    }

    console.log('[Receiver] 청크 큐 소진 완료, writer close 시작:', meta.fileName);
    setState((s) => ({ ...s, exportPhase: 'exporting' }));

    try {
      // close()를 try 안에서 실행 — OPFS 오류 시 VERIFY_FAIL 전송 가능
      await writerRef.current?.close();
      writerRef.current = null;
      console.log('[Receiver] writer close 완료, 전체 파일 해시 검증 시작:', meta.fileName);

      const fileValid = await verifyFileHash(
        msg.fileId,
        meta.fileName,
        fileHashRef.current,
      );
      console.log('[Receiver] 전체 파일 해시 검증 결과:', meta.fileName, 'valid:', fileValid);

      if (!fileValid) {
        console.warn('[Receiver] 해시 불일치 — VERIFY_FAIL 전송, OPFS 삭제:', meta.fileName);
        sendControl({ type: 'VERIFY_FAIL', fileId: msg.fileId, reason: 'file_hash_mismatch' });
        setState((s) => ({
          ...s,
          exportPhase: 'error',
          exportError: '파일 무결성 검증 실패. 처음부터 다시 시도해주세요.',
        }));
        await deleteFromOPFS(meta.fileName);
        return;
      }

      console.log('[Receiver] 해시 검증 통과, 다운로드로 내보내는 중:', meta.fileName);
      await exportFromOPFS(meta.fileName);
      console.log('[Receiver] exportFromOPFS 반환됨(내보내기 자체는 성공 판단):', meta.fileName);
      await onTransferComplete?.(msg.fileId);
      sendControl({ type: 'VERIFY_OK', fileId: msg.fileId });
      setState((s) => ({ ...s, exportPhase: 'done' }));
      onFileDone?.(msg.fileId);
      await deleteFromOPFS(meta.fileName);
      console.log('[Receiver] 전송 완료 처리 끝, OPFS 원본 삭제됨:', meta.fileName);
    } catch (err) {
      // OPFS 오류, 내보내기 실패, onTransferComplete 예외 — 모두 sender에게 알림
      console.error('[Receiver] handleTransferDone 중 예외 발생:', meta.fileName, err);
      sendControl({ type: 'VERIFY_FAIL', fileId: msg.fileId, reason: 'file_hash_mismatch' });
      const errorMsg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, exportPhase: 'error', exportError: errorMsg }));
      writerRef.current = null;
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
