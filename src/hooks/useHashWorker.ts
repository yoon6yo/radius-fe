import { useEffect, useRef, useCallback } from 'react';
import type { HashWorkerRequest, HashWorkerResponse } from '@/workers/hashWorker';

type ChunkHashCallback = (fileId: string, chunkIndex: number, hash: string) => void;
type ChunksDoneCallback = (fileId: string, hashes: string[]) => void;
type FileHashCallback = (fileId: string, hash: string) => void;
type BufferHashCallback = (fileId: string, chunkIndex: number, hash: string) => void;

interface UseHashWorkerOptions {
  onChunkHash?: ChunkHashCallback;
  onChunksDone?: ChunksDoneCallback;
  onFileHash?: FileHashCallback;
  onBufferHash?: BufferHashCallback;
}

export function useHashWorker(options: UseHashWorkerOptions = {}) {
  const workerRef = useRef<Worker | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../workers/hashWorker.ts', import.meta.url),
      { type: 'module' },
    );

    workerRef.current.onmessage = (event: MessageEvent<HashWorkerResponse>) => {
      const msg = event.data;
      const { onChunkHash, onChunksDone, onFileHash, onBufferHash } = optionsRef.current;

      if (msg.type === 'CHUNK_HASH') {
        onChunkHash?.(msg.fileId, msg.chunkIndex, msg.hash);
      } else if (msg.type === 'CHUNKS_DONE') {
        onChunksDone?.(msg.fileId, msg.hashes);
      } else if (msg.type === 'FILE_HASH') {
        onFileHash?.(msg.fileId, msg.hash);
      } else if (msg.type === 'BUFFER_HASH') {
        onBufferHash?.(msg.fileId, msg.chunkIndex, msg.hash);
      } else if (msg.type === 'ERROR') {
        console.error('[HashWorker] error:', msg.fileId, msg.message);
      }
    };

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const hashChunks = useCallback((fileId: string, file: File, chunkSize: number) => {
    const req: HashWorkerRequest = { type: 'HASH_CHUNKS', fileId, file, chunkSize };
    workerRef.current?.postMessage(req);
  }, []);

  const hashFile = useCallback((fileId: string, file: File) => {
    const req: HashWorkerRequest = { type: 'HASH_FILE', fileId, file };
    workerRef.current?.postMessage(req);
  }, []);

  const hashBuffer = useCallback(
    (fileId: string, buffer: ArrayBuffer, chunkIndex: number) => {
      const req: HashWorkerRequest = { type: 'HASH_BUFFER', fileId, buffer, chunkIndex };
      // ArrayBuffer를 transfer하여 복사 오버헤드 제거
      workerRef.current?.postMessage(req, [buffer]);
    },
    [],
  );

  return { hashChunks, hashFile, hashBuffer };
}
