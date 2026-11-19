/** Audits importés, conservés dans ce navigateur (IndexedDB). Persistance serveur prévue en V2. */
import type { Audit } from '../core/types.ts';

export interface Stored { key: string; id: string; client: string; date?: string; titre?: string; imported_at: string; source: string; size: number; audit: Audit }
const DB = 'aav', STORE = 'audits', CUR = 'aav:current';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB indisponible'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => { const q = fn(db.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
export const storeKey = (a: Audit) => `${a.id}@${a.version || '1'}`;
export async function saveAudit(a: Audit, source: string): Promise<Stored> {
  const json = JSON.stringify(a);
  const rec: Stored = { key: storeKey(a), id: a.id, client: a.client, date: a.date, titre: typeof a.titre === 'string' ? a.titre : a.titre?.fr, imported_at: new Date().toISOString(), source, size: json.length, audit: a };
  await tx('readwrite', s => s.put(rec));
  return rec;
}
export async function listAudits(): Promise<Omit<Stored, 'audit'>[]> {
  try {
    const all = await tx<Stored[]>('readonly', s => s.getAll() as IDBRequest<Stored[]>);
    return all.map(({ audit: _a, ...r }) => r).sort((a, b) => b.imported_at.localeCompare(a.imported_at));
  } catch { return []; }
}
export async function getAudit(key: string): Promise<Audit | null> {
  try { const r = await tx<Stored | undefined>('readonly', s => s.get(key) as IDBRequest<Stored | undefined>); return r?.audit ?? null; } catch { return null; }
}
export async function deleteAudit(key: string) { await tx('readwrite', s => s.delete(key)); if (getCurrent() === key) setCurrent(null); }
export function getCurrent(): string | null { try { return localStorage.getItem(CUR); } catch { return null; } }
export function setCurrent(key: string | null) { try { if (key) localStorage.setItem(CUR, key); else localStorage.removeItem(CUR); } catch { /* indisponible */ } }
