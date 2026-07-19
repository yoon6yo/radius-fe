import type { SessionRecord, TransferRecord } from '@/types/transfer';

const DB_NAME = 'rdrop';
const DB_VERSION = 2;

let db: IDBDatabase | null = null;

/** @internal 테스트 전용: 모듈 싱글턴 DB 연결 초기화 */
export function _resetDB(): void {
  db = null;
}

export async function openDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains('sessions')) {
        database.createObjectStore('sessions', { keyPath: 'token' });
      }
      if (!database.objectStoreNames.contains('transfers')) {
        const ts = database.createObjectStore('transfers', { keyPath: 'fileId' });
        ts.createIndex('by_token', 'token', { unique: false });
      }
      // v2: 수신 청크 인덱스를 append-only로 기록하는 별도 스토어.
      // 예전에는 flush(≈100ms)마다 transfers.receivedIndices 배열 전체를 읽어 병합 후
      // 통째로 재기록해 O(n²)이었음 — 배치를 그냥 추가(add)만 하도록 분리해 O(1) 상각.
      if (!database.objectStoreNames.contains('receivedBatches')) {
        const rb = database.createObjectStore('receivedBatches', {
          keyPath: 'id',
          autoIncrement: true,
        });
        rb.createIndex('by_fileId', 'fileId', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      db = (e.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    req.onerror = () => reject(req.error);
  });
}

function tx(
  database: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return database.transaction(store, mode).objectStore(store);
}

// ── Sessions ────────────────────────────────────────────────

export async function saveSession(record: SessionRecord): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(database, 'sessions', 'readwrite').put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getSession(token: string): Promise<SessionRecord | null> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(database, 'sessions', 'readonly').get(token);
    req.onsuccess = () => resolve((req.result as SessionRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSession(token: string): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(database, 'sessions', 'readwrite').delete(token);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getActiveSession(): Promise<SessionRecord | null> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(database, 'sessions', 'readonly').getAll();
    req.onsuccess = () => {
      const now = Date.now();
      const records = (req.result as SessionRecord[]).filter(
        (r) => r.expiresAt > now,
      );
      resolve(records[0] ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

// ── Transfers ───────────────────────────────────────────────

export async function saveTransfer(record: TransferRecord): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(database, 'transfers', 'readwrite').put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getTransfer(fileId: string): Promise<TransferRecord | null> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(database, 'transfers', 'readonly').get(fileId);
    req.onsuccess = () => resolve((req.result as TransferRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

// 새로 받은 배치를 그대로 추가만 한다 — 기존 데이터를 읽거나 합칠 필요 없음 (O(배치 크기)).
export async function addReceivedBatch(fileId: string, indices: number[]): Promise<void> {
  if (indices.length === 0) return;
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(database, 'receivedBatches', 'readwrite').add({ fileId, indices });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// fileId에 쌓인 모든 배치를 모아 중복 제거된 청크 인덱스 목록으로 합친다.
// (flush 때마다가 아니라 이어받기/재구성처럼 드물게만 호출됨)
export async function getReceivedChunkIndices(fileId: string): Promise<number[]> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const index = tx(database, 'receivedBatches', 'readonly').index('by_fileId');
    const req = index.getAll(fileId);
    req.onsuccess = () => {
      const batches = req.result as { fileId: string; indices: number[] }[];
      const merged = new Set<number>();
      for (const batch of batches) {
        for (const i of batch.indices) merged.add(i);
      }
      resolve([...merged]);
    };
    req.onerror = () => reject(req.error);
  });
}

// 완료되었거나 새로 시작하는 전송의 이전 배치 기록을 정리한다.
export async function clearReceivedBatches(fileId: string): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(database, 'receivedBatches', 'readwrite');
    const req = store.index('by_fileId').openKeyCursor(IDBKeyRange.only(fileId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function markTransferDone(fileId: string): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(database, 'transfers', 'readwrite');
    const getReq = store.get(fileId);
    getReq.onsuccess = () => {
      const record = getReq.result as TransferRecord | undefined;
      if (!record) return resolve();
      const putReq = store.put({ ...record, status: 'done' });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getPendingTransfersByToken(
  token: string,
): Promise<TransferRecord[]> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const index = tx(database, 'transfers', 'readonly').index('by_token');
    const req = index.getAll(token);
    req.onsuccess = () => {
      const records = (req.result as TransferRecord[]).filter(
        (r) => r.status === 'pending',
      );
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

// 고아 레코드 정리(startup sweep)에 필요 — 토큰 구분 없이 전체 레코드를 훑는다.
export async function getAllTransfers(): Promise<TransferRecord[]> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(database, 'transfers', 'readonly').getAll();
    req.onsuccess = () => resolve(req.result as TransferRecord[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTransferRecord(fileId: string): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(database, 'transfers', 'readwrite').delete(fileId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
