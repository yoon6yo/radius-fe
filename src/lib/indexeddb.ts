import type { SessionRecord, TransferRecord } from '@/types/transfer';

const DB_NAME = 'radius';
const DB_VERSION = 1;

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

export async function updateReceivedIndices(
  fileId: string,
  newIndices: number[],
): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(database, 'transfers', 'readwrite');
    const getReq = store.get(fileId);
    getReq.onsuccess = () => {
      const record = getReq.result as TransferRecord | undefined;
      if (!record) return resolve();
      // 기존 인덱스에 새 인덱스를 병합 (replace가 아닌 append)
      const merged = Array.from(new Set([...record.receivedIndices, ...newIndices]));
      const putReq = store.put({ ...record, receivedIndices: merged });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
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
