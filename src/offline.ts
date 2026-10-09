import { newId } from './id';
import type { Command, Trip } from './domain';
export type Pending = { command: Command; status: 'pending' | 'conflict' | 'cancelled'; message?: string; queuedAt: string };
type Entry = { key: string; value: unknown };
let opened: Promise<IDBDatabase> | undefined;
function openDB() {
  return opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('operation-instructions-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別タブの保存処理を終了してください。'));
  });
}
export async function read<T>(key: string): Promise<T | undefined> {
  const db = await openDB(); return new Promise((resolve, reject) => {
    const request = db.transaction('entries', 'readonly').objectStore('entries').get(key);
    request.onsuccess = () => resolve((request.result as Entry | undefined)?.value as T | undefined); request.onerror = () => reject(request.error);
  });
}
export async function write(key: string, value: unknown) {
  const db = await openDB(); return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite'); tx.objectStore('entries').put({ key, value });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('端末保存に失敗しました。'));
  });
}
// Atomic compare-and-swap prevents two demo tabs from overwriting one another.
export async function update<T>(key: string, change: (current: T | undefined) => T): Promise<T> {
  const db = await openDB(); return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries'); const request = store.get(key); let result: T;
    request.onsuccess = () => { try { result = change(request.result?.value); store.put({ key, value: result }); } catch (error) { tx.abort(); reject(error); } };
    tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('端末保存を中断しました。'));
  });
}
export async function clearUser(scope: string) {
  const db = await openDB(); return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries'); const req = store.openCursor();
    req.onsuccess = () => { const cursor = req.result; if (!cursor) return; if (String(cursor.key) === scope || String(cursor.key).startsWith(`${scope}:`)) cursor.delete(); cursor.continue(); };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
export async function saveCarry(scope: string, trip: Trip) { const savedAt = new Date().toISOString(); await write(`${scope}:carry:${trip.id}`, { trip, savedAt }); return savedAt; }
export function deviceId() { let id = localStorage.getItem('operation-device'); if (!id) { id = newId(); localStorage.setItem('operation-device', id); } return id; }
