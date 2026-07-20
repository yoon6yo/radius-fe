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
      console.log(
        '[Resume] 세션:', session ? `token=${session.token} role=${session.role} expiresAt=${new Date(session.expiresAt).toLocaleTimeString()}` : '없음',
        '/ 전체 transfer 기록:', allTransfers.length, '건',
      );

      const pendingForActiveSession: TransferRecord[] = [];
      for (const record of allTransfers) {
        if (record.status !== 'pending') continue;
        if (session && record.token === session.token) {
          pendingForActiveSession.push(record);
          continue;
        }
        console.log('[Resume] 세션과 무관한 pending 기록 정리:', record.fileId, 'token:', record.token);
        void cleanupAbandonedTransfer(record);
      }

      if (session && pendingForActiveSession.length > 0) {
        console.log('[Resume] 이어받기 배너 표시:', pendingForActiveSession.length, '개 파일');
        setResumeInfo({ session, pendingTransfers: pendingForActiveSession });
      } else {
        console.log('[Resume] 이어받기 배너 표시 안 함 (세션 없음 또는 pending 기록 없음)');
      }
    })();
  }, []);

  return {
    resumeInfo,
    dismiss: () => setResumeInfo(null),
  };
}
