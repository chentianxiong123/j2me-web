// Games are kept only in this browser (IndexedDB); nothing is uploaded anywhere.

export interface GameRecord {
  id: string;
  fileName: string;
  name: string;
  vendor: string;
  size: number;
  addedAt: number;
  lastPlayedAt: number;
  iconDataUrl: string | null;
  bytes: ArrayBuffer;
}

export type GameSummary = Omit<GameRecord, 'bytes'>;

const DB_NAME = 'j2me-web-player';
const STORE = 'games';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

export async function gameId(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function saveGame(record: GameRecord): Promise<void> {
  await withStore('readwrite', (s) => s.put(record));
}

export async function loadGame(id: string): Promise<GameRecord | undefined> {
  return withStore('readonly', (s) => s.get(id) as IDBRequest<GameRecord | undefined>);
}

export async function listGames(): Promise<GameSummary[]> {
  const all = await withStore('readonly', (s) => s.getAll() as IDBRequest<GameRecord[]>);
  return all
    .map(({ bytes: _bytes, ...summary }) => summary)
    .sort((a, b) => Math.max(b.lastPlayedAt, b.addedAt) - Math.max(a.lastPlayedAt, a.addedAt));
}

export async function deleteGame(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

export async function touchGame(id: string): Promise<void> {
  const record = await loadGame(id);
  if (record) await saveGame({ ...record, lastPlayedAt: Date.now() });
}
