// "Import library": reads a Lark export (.zip, incl. ZIP64) straight from the picked file — entries are
// sliced out of the file and streamed into storage, so even very large libraries need little memory.
import * as db from './db.js';
import * as opfs from './opfs.js';
import { lib } from './store.js';

const u64 = (v, o) => Number(v.getBigUint64(o, true));

export async function readZipEntries(file) {
  const tailLen = Math.min(file.size, 65557 + 20);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a .zip file.');
  let count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  if (eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
    const at = u64(tail, eocd - 20 + 8);
    const z = new DataView(await file.slice(at, at + 56).arrayBuffer());
    if (z.getUint32(0, true) !== 0x06064b50) throw new Error('Damaged ZIP64 file.');
    count = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48);
  }
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const entries = new Map();
  for (let n = 0, p = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged .zip file.');
    const method = cd.getUint16(p + 10, true);
    let size = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true), off = cd.getUint32(p + 42, true);
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nlen));
    for (let x = p + 46 + nlen, end = x + xlen; x + 4 <= end;) {
      const id = cd.getUint16(x, true), sz = cd.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = u64(cd, q); q += 8; }
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (off === 0xffffffff) { off = u64(cd, q); q += 8; }
      }
      x += 4 + sz;
    }
    entries.set(name, { name, method, size, usize, off });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}
export async function entryBlob(file, e) {
  const h = new DataView(await file.slice(e.off, e.off + 30).arrayBuffer());
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error(`Damaged entry ${e.name}`);
  const start = e.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const raw = file.slice(start, start + e.size);
  if (e.method === 0) return raw;
  if (e.method === 8) return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  throw new Error(`Unsupported compression in ${e.name}`);
}

/** mode: 'replace' (library becomes exactly the export) or 'merge' (add what's missing; songs matched by content). */
export async function importLibrary(file, mode, onProgress = () => {}) {
  const entries = await readZipEntries(file);
  const je = entries.get('library.json');
  if (!je) throw new Error('This file is not a Lark library export (library.json is missing).');
  const data = JSON.parse(await (await entryBlob(file, je)).text());
  if (data.format !== 'lark-library') throw new Error('This file is not a Lark library export.');
  const replace = mode === 'replace';

  // 1. Copy audio and covers first; the existing library is only changed once everything is copied.
  const songs = data.songs.filter((s) => replace || !lib.songs.has(s.id));
  const total = songs.reduce((a, s) => a + (entries.get(`audio/${s.file}`)?.size || 0), 0);
  let done = 0;
  const missing = [];
  for (const s of songs) {
    const e = entries.get(`audio/${s.file}`);
    if (!e) { missing.push(s.id); continue; }
    if (!(lib.songs.has(s.id) && await opfs.hasFile(s.file))) await opfs.writeBlob(s.file, await entryBlob(file, e), (n) => onProgress((done += n), total));
    else onProgress((done += e.size), total);
  }
  const covers = [];
  for (const c of data.covers || []) {
    if (!replace && lib.covers.has(c.id)) continue;
    const e = entries.get(`covers/${c.id}.jpg`);
    if (e) covers.push({ id: c.id, color: c.color || undefined, blob: new Blob([await (await entryBlob(file, e)).arrayBuffer()], { type: 'image/jpeg' }) });
  }
  const gone = new Set(missing);
  const keepSongs = data.songs.filter((s) => !gone.has(s.id));

  // 2. Write the library metadata.
  if (replace) {
    await db.clear(...db.STORES);
    const keep = new Set(keepSongs.map((s) => s.file));
    for (const n of await opfs.listNames()) if (!keep.has(n)) await opfs.remove(n);
    if (keepSongs.length) await db.put('songs', ...keepSongs);
    if (covers.length) await db.put('covers', ...covers);
    if (data.playlists?.length) await db.put('playlists', ...data.playlists);
    if (data.folders?.length) await db.put('folders', ...data.folders);
    if (data.likes?.length) await db.put('likes', ...data.likes);
    if (data.history?.length) await db.put('history', ...data.history.map(({ songId, at, ctx }) => ({ songId, at, ctx })));
    if (data.settings) await db.kvSet('settings', data.settings);
  } else {
    const newSongs = keepSongs.filter((s) => !lib.songs.has(s.id));
    if (newSongs.length) await db.put('songs', ...newSongs);
    if (covers.length) await db.put('covers', ...covers);
    const pls = (data.playlists || []).filter((p) => !lib.playlists.has(p.id) || lib.playlists.get(p.id).updatedAt < p.updatedAt);
    if (pls.length) await db.put('playlists', ...pls);
    const folders = (data.folders || []).filter((f) => !lib.folders.has(f.id));
    if (folders.length) await db.put('folders', ...folders);
    const likes = (data.likes || []).filter((l) => !lib.likes.has(l.songId));
    if (likes.length) await db.put('likes', ...likes);
    const seen = new Set(lib.history.map((h) => `${h.songId}@${h.at}`));
    const hist = (data.history || []).filter((h) => !seen.has(`${h.songId}@${h.at}`));
    if (hist.length) await db.put('history', ...hist.map(({ songId, at, ctx }) => ({ songId, at, ctx })));
  }
  return { songs: keepSongs.length, added: replace ? keepSongs.length : keepSongs.filter((s) => !lib.songs.has(s.id)).length, missing: missing.length };
}
