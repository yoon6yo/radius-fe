import { useCallback, useRef } from 'react';
import { useHashWorker } from '@/hooks/useHashWorker';
import { CHUNK_SIZE } from '@/constants/transfer';

type HashReadyCallback = (
  fileId: string,
  chunkHashes: string[],
  fileHash: string,
) => void;

export function useSenderHash(
  onHashReady: HashReadyCallback,
  onHashError?: (fileId: string) => void,
) {
  const chunkHashesRef = useRef<Map<string, string[]>>(new Map());
  const fileHashRef = useRef<Map<string, string>>(new Map());
  const pendingCountRef = useRef<Map<string, number>>(new Map());
  const totalChunksRef = useRef<Map<string, number>>(new Map());

  const checkComplete = useCallback(
    (fileId: string) => {
      const chunksDone = chunkHashesRef.current.has(fileId);
      const fileDone = fileHashRef.current.has(fileId);
      const allChunksReceived =
        (chunkHashesRef.current.get(fileId)?.length ?? 0) >=
        (totalChunksRef.current.get(fileId) ?? Infinity);

      if (chunksDone && fileDone && allChunksReceived) {
        onHashReady(
          fileId,
          chunkHashesRef.current.get(fileId)!,
          fileHashRef.current.get(fileId)!,
        );
        chunkHashesRef.current.delete(fileId);
        fileHashRef.current.delete(fileId);
        pendingCountRef.current.delete(fileId);
        totalChunksRef.current.delete(fileId);
      }
    },
    [onHashReady],
  );

  const { hashChunks, hashFile } = useHashWorker({
    onChunksDone: (fileId, hashes) => {
      chunkHashesRef.current.set(fileId, hashes);
      checkComplete(fileId);
    },
    onFileHash: (fileId, hash) => {
      fileHashRef.current.set(fileId, hash);
      checkComplete(fileId);
    },
    onError: onHashError
      ? (fileId, message) => {
          console.error('[SenderHash] worker error for', fileId, ':', message);
          onHashError(fileId);
        }
      : undefined,
  });

  const computeHashes = useCallback(
    (fileId: string, file: File) => {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      totalChunksRef.current.set(fileId, totalChunks);
      hashChunks(fileId, file, CHUNK_SIZE);
      hashFile(fileId, file);
    },
    [hashChunks, hashFile],
  );

  return { computeHashes };
}
