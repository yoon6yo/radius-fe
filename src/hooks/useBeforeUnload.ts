import { useEffect } from 'react';
import { useTransferStore } from '@/store/transferStore';

export function useBeforeUnload() {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const { isLocked, queue } = useTransferStore.getState();
      const hasActiveTransfer =
        isLocked && queue.some((f) => f.status !== 'done' && f.status !== 'error');

      if (!hasActiveTransfer) return;

      e.preventDefault();
      // 구형 브라우저 호환
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
}
