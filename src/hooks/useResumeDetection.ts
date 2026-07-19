import { useEffect, useState } from 'react';
import { getActiveSession, getAllTransfers } from '@/lib/indexeddb';
import { cleanupAbandonedTransfer } from '@/lib/transferCleanup';
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
      const [session, allTransfers] = await Promise.all([getActiveSession(), getAllTransfers()]);

      // 탭이 그냥 닫히는 등 이벤트 없이 중단된 전송은 다음 앱 시작 시 여기서 한 번씩 훑어
      // 정리한다. 활성 세션(만료되지 않은)에 속한 pending 기록만 이어받기 후보로 남기고,
      // 그 외(세션이 만료됐거나 다른 세션의) pending 기록은 다시 이어받을 수 없으므로
      // OPFS 파일/기록을 정리한다.
      const pendingForActiveSession: TransferRecord[] = [];
      for (const record of allTransfers) {
        if (record.status !== 'pending') continue;
        if (session && record.token === session.token) {
          pendingForActiveSession.push(record);
          continue;
        }
        void cleanupAbandonedTransfer(record);
      }

      if (session && pendingForActiveSession.length > 0) {
        setResumeInfo({ session, pendingTransfers: pendingForActiveSession });
      }
    })();
  }, []);

  return {
    resumeInfo,
    dismiss: () => setResumeInfo(null),
  };
}
