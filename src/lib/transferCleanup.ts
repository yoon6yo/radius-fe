import { deleteFromOPFS } from '@/lib/fileWriter';
import { deleteTransferRecord, clearReceivedBatches, getPendingTransfersByToken } from '@/lib/indexeddb';
import type { TransferRecord } from '@/types/transfer';

// 다시는 이어받을 수 없게 된 pending 전송의 OPFS 파일 데이터 + IndexedDB 기록을 정리한다.
// 피어 이탈(peer-left)이나 세션 만료처럼 재개 가능성이 완전히 사라진 경우에만 호출해야
// 한다 — 아직 재연결 가능성이 있는 peer-disconnected 상태에서 호출하면 이어받기 기능이
// 깨진다.
export async function cleanupAbandonedTransfer(record: TransferRecord): Promise<void> {
  await Promise.all([
    deleteFromOPFS(record.fileName).catch(() => {}),
    clearReceivedBatches(record.fileId).catch(() => {}),
  ]);
  await deleteTransferRecord(record.fileId).catch(() => {});
}

export async function cleanupAbandonedTransfersForToken(token: string): Promise<void> {
  const pending = await getPendingTransfersByToken(token);
  await Promise.all(pending.map(cleanupAbandonedTransfer));
}
