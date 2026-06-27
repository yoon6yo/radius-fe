import { useEffect, useState } from 'react';
import { getActiveSession, getPendingTransfersByToken } from '@/lib/indexeddb';
import type { SessionRecord, TransferRecord } from '@/types/transfer';

interface ResumeInfo {
  session: SessionRecord;
  pendingTransfers: TransferRecord[];
}

export function useResumeDetection(): {
  resumeInfo: ResumeInfo | null;
  dismiss: () => void;
} {
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);

  useEffect(() => {
    void (async () => {
      const session = await getActiveSession();
      if (!session) return;

      const pendingTransfers = await getPendingTransfersByToken(session.token);
      if (pendingTransfers.length > 0) {
        setResumeInfo({ session, pendingTransfers });
      }
    })();
  }, []);

  return {
    resumeInfo,
    dismiss: () => setResumeInfo(null),
  };
}
