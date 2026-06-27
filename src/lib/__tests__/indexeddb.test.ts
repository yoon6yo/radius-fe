import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  _resetDB,
  saveSession,
  getSession,
  deleteSession,
  getActiveSession,
  saveTransfer,
  getTransfer,
  updateReceivedIndices,
  markTransferDone,
  getPendingTransfersByToken,
} from '@/lib/indexeddb';
import type { SessionRecord, TransferRecord } from '@/types/transfer';

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  _resetDB();
});

const makeSession = (override: Partial<SessionRecord> = {}): SessionRecord => ({
  token: 'TESTTOKEN',
  role: 'offerer',
  expiresAt: Date.now() + 3_600_000,
  ...override,
});

const makeTransfer = (override: Partial<TransferRecord> = {}): TransferRecord => ({
  fileId: 'file-001',
  token: 'TESTTOKEN',
  fileName: 'test.bin',
  fileSize: 1024,
  chunkSize: 65536,
  totalChunks: 1,
  fileHash: 'abc123',
  chunkHashes: ['h0'],
  receivedIndices: [],
  status: 'pending',
  ...override,
});

// ── Sessions ─────────────────────────────────────────────────

describe('saveSession / getSession', () => {
  it('저장 후 조회하면 동일한 레코드를 반환한다', async () => {
    const session = makeSession();
    await saveSession(session);
    const result = await getSession('TESTTOKEN');
    expect(result).toEqual(session);
  });

  it('존재하지 않는 토큰은 null 반환', async () => {
    expect(await getSession('NOTEXIST')).toBeNull();
  });
});

describe('deleteSession', () => {
  it('삭제 후 조회하면 null 반환', async () => {
    await saveSession(makeSession());
    await deleteSession('TESTTOKEN');
    expect(await getSession('TESTTOKEN')).toBeNull();
  });
});

describe('getActiveSession', () => {
  it('만료되지 않은 세션을 반환한다', async () => {
    const session = makeSession({ expiresAt: Date.now() + 60_000 });
    await saveSession(session);
    const result = await getActiveSession();
    expect(result?.token).toBe('TESTTOKEN');
  });

  it('만료된 세션은 반환하지 않는다', async () => {
    await saveSession(makeSession({ expiresAt: Date.now() - 1 }));
    expect(await getActiveSession()).toBeNull();
  });

  it('세션이 없으면 null 반환', async () => {
    expect(await getActiveSession()).toBeNull();
  });
});

// ── Transfers ────────────────────────────────────────────────

describe('saveTransfer / getTransfer', () => {
  it('저장 후 조회하면 동일한 레코드를 반환한다', async () => {
    const transfer = makeTransfer();
    await saveTransfer(transfer);
    expect(await getTransfer('file-001')).toEqual(transfer);
  });

  it('존재하지 않는 fileId는 null 반환', async () => {
    expect(await getTransfer('no-file')).toBeNull();
  });
});

describe('updateReceivedIndices', () => {
  it('기존 인덱스에 새 인덱스를 append한다 (replace 아님)', async () => {
    await saveTransfer(makeTransfer({ receivedIndices: [0, 1, 2] }));
    await updateReceivedIndices('file-001', [3, 4, 5]);
    const result = await getTransfer('file-001');
    expect(result?.receivedIndices.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('중복 인덱스는 제거된다', async () => {
    await saveTransfer(makeTransfer({ receivedIndices: [0, 1] }));
    await updateReceivedIndices('file-001', [1, 2]); // 1 중복
    const result = await getTransfer('file-001');
    expect(result?.receivedIndices.sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('여러 번 flush해도 누적이 유지된다', async () => {
    await saveTransfer(makeTransfer({ receivedIndices: [] }));

    await updateReceivedIndices('file-001', [0, 1]);
    await updateReceivedIndices('file-001', [2, 3]);
    await updateReceivedIndices('file-001', [4]);

    const result = await getTransfer('file-001');
    expect(result?.receivedIndices.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('레코드가 없으면 아무것도 하지 않는다', async () => {
    await expect(updateReceivedIndices('no-file', [0])).resolves.toBeUndefined();
  });
});

describe('markTransferDone', () => {
  it('status를 done으로 변경한다', async () => {
    await saveTransfer(makeTransfer({ status: 'pending' }));
    await markTransferDone('file-001');
    const result = await getTransfer('file-001');
    expect(result?.status).toBe('done');
  });
});

describe('getPendingTransfersByToken', () => {
  it('pending 상태의 전송만 반환한다', async () => {
    await saveTransfer(makeTransfer({ fileId: 'f1', status: 'pending' }));
    await saveTransfer(makeTransfer({ fileId: 'f2', status: 'done' }));
    await saveTransfer(makeTransfer({ fileId: 'f3', status: 'pending' }));

    const pending = await getPendingTransfersByToken('TESTTOKEN');
    expect(pending.map((t) => t.fileId).sort()).toEqual(['f1', 'f3']);
  });

  it('다른 토큰의 전송은 반환하지 않는다', async () => {
    await saveTransfer(makeTransfer({ fileId: 'f1', token: 'TOKEN_A' }));
    await saveTransfer(makeTransfer({ fileId: 'f2', token: 'TOKEN_B' }));

    const results = await getPendingTransfersByToken('TOKEN_A');
    expect(results).toHaveLength(1);
    expect(results[0].fileId).toBe('f1');
  });
});
