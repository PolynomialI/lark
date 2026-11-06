// IndexedDB: library metadata. Schema changes must only ever add stores/indexes (never wipe data).
const NAME = 'lark';
const VERSION = 1;
export const STORES = ['songs', 'covers', 'playlists', 'folders', 'likes', 'history', 'kv'];
let dbp;

export function openDB() {
  return (dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const mk = (name, opts) => db.objectStoreNames.contains(name) || db.createObjectStore(name, opts);
      mk('songs', { keyPath: 'id' });
      mk('covers', { keyPath: 'id' });
      mk('playlists', { keyPath: 'id' });
      mk('folders', { keyPath: 'id' });
      mk('likes', { keyPath: 'songId' });
      mk('history', { keyPath: 'id', autoIncrement: true });
      mk('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database blocked by another tab'));
  }));
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
const result = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function getAll(store) {
  const db = await openDB();
  return result(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, key) {
  const db = await openDB();
  return result(db.transaction(store).objectStore(store).get(key));
}
export async function put(store, ...vals) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of vals) os.put(v);
  return done(tx);
}
export async function del(store, ...keys) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  for (const k of keys) tx.objectStore(store).delete(k);
  return done(tx);
}
export async function clear(...stores) {
  const db = await openDB();
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  return done(tx);
}
/**
 * Read-modify-write records in one transaction, so a change never overwrites newer data saved by another
 * window. fn(current) returns the new record (or undefined to leave it). Resolves to the new records.
 */
export async function updateMany(store, keys, fn) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  const out = [];
  keys.forEach((key, i) => {
    const r = os.get(key);
    r.onsuccess = () => { const v = fn(r.result); if (v !== undefined) { os.put(v); out[i] = v; } };
  });
  await done(tx);
  return out;
}
export const update = async (store, key, fn) => (await updateMany(store, [key], fn))[0];
/** Replace the whole contents of some stores in one transaction: { store: [records] }. */
export async function replace(data) {
  const db = await openDB();
  const names = Object.keys(data);
  const tx = db.transaction(names, 'readwrite');
  for (const n of names) { const os = tx.objectStore(n); os.clear(); for (const v of data[n]) os.put(v); }
  return done(tx);
}
export async function kvGet(key) { return (await get('kv', key))?.value; }
export async function kvSet(key, value) { return put('kv', { key, value }); }
