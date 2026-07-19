import { useCallback } from 'react';
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
  // 전체 파일 해시는 청크 해시와 같은 read pass 안에서 스트리밍으로 함께 계산되어
  // CHUNKS_DONE에 같이 실려온다 (hashWorker.ts) — 별도 HASH_FILE 왕복이나
  // 두 결과를 기다리는 완료 대기 로직이 필요 없다.
  const { hashChunks } = useHashWorker({
    onChunksDone: (fileId, hashes, fileHash) => {
      onHashReady(fileId, hashes, fileHash);
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
      hashChunks(fileId, file, CHUNK_SIZE);
    },
    [hashChunks],
  );

  return { computeHashes };
}
