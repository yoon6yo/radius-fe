import { useCallback, useRef } from 'react';
import { useHashWorker } from '@/hooks/useHashWorker';

type VerifyResult = (valid: boolean) => void;

export function useReceiverHash() {
  // chunkIndex별 대기 중인 resolve 함수
  const pendingRef = useRef<Map<string, VerifyResult>>(new Map());
  const chunkHashesRef = useRef<Map<string, string[]>>(new Map());

  const { hashBuffer, hashFile } = useHashWorker({
    onBufferHash: (_fileId, chunkIndex, hash) => {
      const key = `${_fileId}:${chunkIndex}`;
      const expected = chunkHashesRef.current.get(_fileId)?.[chunkIndex];
      const resolve = pendingRef.current.get(key);
      if (resolve) {
        resolve(hash === expected);
        pendingRef.current.delete(key);
      }
    },
    onFileHash: (_fileId, hash) => {
      const key = `${_fileId}:__file__`;
      const resolve = pendingRef.current.get(key);
      if (resolve) {
        // resolve with the hash so caller can compare
        (resolve as unknown as (hash: string) => void)(hash);
        pendingRef.current.delete(key);
      }
    },
  });

  const setChunkHashes = useCallback((fileId: string, hashes: string[]) => {
    chunkHashesRef.current.set(fileId, hashes);
  }, []);

  const verifyChunkHash = useCallback(
    (fileId: string, chunkIndex: number, data: ArrayBuffer): Promise<boolean> => {
      const hashes = chunkHashesRef.current.get(fileId);
      if (!hashes || hashes.length === 0) {
        // 해시 매니페스트가 아직 없는 경우 — 검증 없이 통과
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const key = `${fileId}:${chunkIndex}`;
        pendingRef.current.set(key, resolve);
        // ArrayBuffer를 transfer하여 복사 오버헤드 제거
        const copy = data.slice(0);
        hashBuffer(fileId, copy, chunkIndex);
      });
    },
    [hashBuffer],
  );

  const verifyFileHash = useCallback(
    (fileId: string, fileName: string, expectedHash: string): Promise<boolean> => {
      return new Promise((resolve) => {
        const key = `${fileId}:__file__`;
        pendingRef.current.set(key, ((hash: string) => {
          resolve(hash === expectedHash);
        }) as unknown as VerifyResult);

        // OPFS에서 File 객체를 가져와 해시 계산
        void navigator.storage.getDirectory().then(async (root) => {
          const fh = await root.getFileHandle(fileName);
          const file = await fh.getFile();
          hashFile(fileId, file);
        });
      });
    },
    [hashFile],
  );

  return { setChunkHashes, verifyChunkHash, verifyFileHash };
}
