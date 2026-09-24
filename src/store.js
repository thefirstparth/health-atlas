// Everything the app keeps lives in this browser's IndexedDB. Nothing is sent anywhere.
const DB = 'health-atlas', ST = 'kv';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(ST, mode), s = t.objectStore(ST); const r = fn(s);
    t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
export const get = k => tx('readonly', s => s.get(k)).catch(() => undefined);
export const set = (k, v) => tx('readwrite', s => s.put(v, k));
export async function forget() {
  await tx('readwrite', s => s.clear()).catch(() => {});
  try { localStorage.removeItem('ha-state'); localStorage.removeItem('ha-stage'); } catch (e) {}
}
export async function persist() { try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {} return false; }
