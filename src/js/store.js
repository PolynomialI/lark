// In-memory library backed by IndexedDB (metadata) and OPFS (audio).
import * as db from './db.js';
import * as opfs from './opfs.js';
import { Emitter, norm, sha256, uid } from './util.js';

export const DEFAULT_SETTINGS = {
  volume: 0.8, muted: false, crossfade: 0, normalize: false, normLevel: 'normal',
  eq: { enabled: false, preset: 'flat', gains: [0, 0, 0, 0, 0, 0] },
  libFilter: 'all', libSort: 'recents', libView: 'list', libHidden: [],
};

export const lib = {
  songs: new Map(), covers: new Map(), playlists: new Map(), folders: new Map(),
  likes: new Map(), history: [], settings: structuredClone(DEFAULT_SETTINGS),
  tomb: { songs: {}, playlists: {}, folders: {}, likes: {} }, // deletions (for sync)
  files: new Set(), // audio files present on this device
};
export const events = new Emitter();
let derived = null;
// Several Lark windows (e.g. the installed app and a browser tab) share the same storage: when one saves
// something, the others reload the library, so none of them works from (and saves back) an old copy.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lark-library') : null;
let reloadTimer = 0;
const broadcast = () => channel?.postMessage('changed');
if (channel) channel.onmessage = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(reloadFromOtherWindow, 100); };
async function reloadFromOtherWindow() {
  const before = new Set(lib.songs.keys());
  await load();
  const gone = [...before].filter((id) => !lib.songs.has(id));
  if (gone.length) events.emit('deleted', gone);
}
const changed = (what) => { if (what === 'songs') derived = null; broadcast(); events.emit('change', what); };

export async function load() {
  const [songs, covers, playlists, folders, likes, history, settings, tomb, files] = await Promise.all([
    db.getAll('songs'), db.getAll('covers'), db.getAll('playlists'), db.getAll('folders'),
    db.getAll('likes'), db.getAll('history'), db.kvGet('settings'), db.kvGet('tombstones'), opfs.listNames().catch(() => []),
  ]);
  lib.tomb = { songs: {}, playlists: {}, folders: {}, likes: {}, ...(tomb || {}) };
  lib.files = new Set(files);
  for (const k of Object.keys(lib)) if (lib[k] instanceof Map) lib[k].clear();
  songs.forEach((s) => lib.songs.set(s.id, s));
  covers.forEach((c) => lib.covers.set(c.id, c));
  playlists.forEach((p) => lib.playlists.set(p.id, p));
  folders.forEach((f) => lib.folders.set(f.id, f));
  likes.forEach((l) => lib.likes.set(l.songId, l.at));
  lib.history = history.sort((a, b) => a.at - b.at);
  lib.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(settings || {}) };
  derived = null;
  events.emit('change', 'all');
}

// ---------- deletions & audio availability (used by sync) ----------
async function addTomb(kind, ids) {
  const now = Date.now();
  ids.forEach((id) => { lib.tomb[kind][id] = now; });
  const rec = await db.update('kv', 'tombstones', (r) => {
    const t = { songs: {}, playlists: {}, folders: {}, likes: {}, ...(r?.value || {}) };
    t[kind] = { ...t[kind] };
    ids.forEach((id) => { t[kind][id] = now; });
    return { key: 'tombstones', value: t };
  });
  lib.tomb = rec.value;
}
/** Whether this song's audio is on this device (it may still be downloading from Google Drive). */
export const isAvailable = (s) => !!s && lib.files.has(s.file);
export function markAvailable(file) { lib.files.add(file); broadcast(); events.emit('change', 'files'); }

// ---------- display helpers ----------
export const title = (s) => s?.title || s?.name || 'Unknown';
export const artistOf = (s) => s?.artist || 'Unknown artist';
export const albumOf = (s) => s?.album || '';
export const albumKey = (s) => `${norm(s.albumArtist || s.artist)}\u0001${norm(s.album)}`;
export const artistKey = (name) => norm(name || 'Unknown artist');

// ---------- covers ----------
const coverUrls = new Map();
export function coverUrl(id) {
  if (!id) return '';
  let u = coverUrls.get(id);
  if (!u) {
    const c = lib.covers.get(id);
    if (!c) return '';
    coverUrls.set(id, (u = URL.createObjectURL(c.blob)));
  }
  return u;
}
export async function addCover(blob) {
  const id = await sha256(await blob.arrayBuffer());
  if (!lib.covers.has(id)) {
    const c = { id, blob };
    lib.covers.set(id, c);
    await db.put('covers', c);
  }
  return id;
}
export async function saveCovers(list) {
  const fresh = list.filter((c) => !lib.covers.has(c.id));
  fresh.forEach((c) => lib.covers.set(c.id, c));
  if (fresh.length) await db.put('covers', ...fresh);
}
export async function setCoverColor(id, color) {
  const c = lib.covers.get(id);
  if (c && c.color !== color) { c.color = color; await db.put('covers', c); }
}
/** Up to 4 distinct covers for a playlist mosaic. */
export function mosaic(songIds) {
  const out = [];
  for (const id of songIds) {
    const c = lib.songs.get(id)?.coverId;
    if (c && !out.includes(c)) out.push(c);
    if (out.length === 4) break;
  }
  return out.length >= 4 ? out : out.slice(0, 1);
}
export function playlistCovers(p) { return p.coverId ? [p.coverId] : mosaic(p.songs.map((e) => e.songId)); }

// ---------- songs ----------
export async function addSongs(songs) {
  const fresh = songs.filter((s) => !lib.songs.has(s.id));
  fresh.forEach((s) => { s.updatedAt ||= s.addedAt; lib.songs.set(s.id, s); lib.files.add(s.file); });
  if (fresh.length) { await db.put('songs', ...fresh); changed('songs'); }
  return fresh.length;
}
export async function updateSongs(ids, patch, { silent = false } = {}) {
  const now = Date.now();
  const fresh = await db.updateMany('songs', ids, (s) => s && { ...s, ...(typeof patch === 'function' ? patch(s) : patch), ...(silent ? {} : { updatedAt: now }) });
  fresh.forEach((s) => { if (!s) return; const m = lib.songs.get(s.id); if (m) Object.assign(m, s); else lib.songs.set(s.id, s); });
  if (!silent) changed('songs');
}
export async function deleteSongs(ids) {
  const set = new Set(ids);
  const files = ids.map((id) => lib.songs.get(id)?.file).filter(Boolean);
  ids.forEach((id) => { lib.songs.delete(id); lib.likes.delete(id); });
  const pls = [...lib.playlists.values()].filter((p) => p.songs.some((e) => set.has(e.songId))).map((p) => p.id);
  files.forEach((f) => lib.files.delete(f));
  await addTomb('songs', ids);
  await db.del('songs', ...ids);
  await db.del('likes', ...ids);
  for (const id of pls) await editPl(id, (p) => ({ songs: p.songs.filter((e) => !set.has(e.songId)) }), { quiet: true });
  for (const f of files) await opfs.remove(f);
  events.emit('deleted', ids);
  changed('songs');
}
// Liked Songs and All songs can have a custom order (drag to reorder): a stored list of song ids.
// Songs not in it yet (newly added or liked) come first, newest first.
function withOrder(ids, key) {
  const order = lib.settings[`${key}Order`];
  if (!order?.length) return ids;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...ids.filter((id) => !pos.has(id)), ...ids.filter((id) => pos.has(id)).sort((a, b) => pos.get(a) - pos.get(b))];
}
export const allSongIds = () => withOrder([...lib.songs.values()].sort((a, b) => b.addedAt - a.addedAt).map((s) => s.id), 'songs');
/** Move songs (keeping their relative order) to index `to` of the rest of Liked Songs ('liked') or All songs ('songs'). */
export async function reorderList(key, songIds, to) {
  const cur = key === 'liked' ? likedSongIds() : allSongIds();
  const mv = new Set(songIds);
  const rest = cur.filter((id) => !mv.has(id));
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, ...cur.filter((id) => mv.has(id)));
  await setSettings({ [`${key}Order`]: rest, [`${key}OrderAt`]: Date.now() });
  changed(key === 'liked' ? 'likes' : 'songs');
}

// ---------- likes ----------
export const isLiked = (id) => lib.likes.has(id);
export async function setLiked(ids, liked) {
  // Always later than the latest like, so "newest first" is exact even for likes in the same millisecond.
  let at = Date.now();
  for (const t of lib.likes.values()) if (t >= at) at = t + 1;
  if (liked) {
    const add = ids.filter((id) => !lib.likes.has(id));
    add.forEach((id, i) => lib.likes.set(id, at + i));
    await db.put('likes', ...add.map((id) => ({ songId: id, at: lib.likes.get(id) })));
  } else {
    ids.forEach((id) => lib.likes.delete(id));
    await addTomb('likes', ids);
    await db.del('likes', ...ids);
  }
  changed('likes');
}
export const toggleLike = (id) => setLiked([id], !isLiked(id));
export const likedSongIds = () => withOrder([...lib.likes.entries()].filter(([id]) => lib.songs.has(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id), 'liked');

// ---------- playlists & folders ----------
const savePl = async (p) => { p.updatedAt = Date.now(); await db.put('playlists', p); changed('playlists'); };
/** Change a playlist from its latest saved version: fn(saved) returns the fields to change. */
async function editPl(id, fn, { quiet = false } = {}) {
  const rec = await db.update('playlists', id, (p) => p && { ...p, ...fn(p), updatedAt: Date.now() });
  if (!rec) return null;
  const m = lib.playlists.get(id);
  if (m) { for (const k of Object.keys(m)) if (!(k in rec)) delete m[k]; Object.assign(m, rec); } else lib.playlists.set(id, rec);
  if (!quiet) changed('playlists');
  return rec;
}
export async function createPlaylist({ name, songIds = [], folderId = null, description = '', coverId = null } = {}) {
  const n = [...lib.playlists.values()].length + 1;
  const now = Date.now();
  const p = { id: uid(), name: name || `My Playlist #${n}`, description, coverId, folderId, pinned: false, createdAt: now, updatedAt: now, playedAt: 0,
    songs: [...new Set(songIds)].map((songId, i) => ({ songId, addedAt: now + i })) };
  lib.playlists.set(p.id, p);
  await savePl(p);
  return p;
}
export async function updatePlaylist(id, patch) { await editPl(id, () => patch); }
export async function deletePlaylist(id) {
  lib.playlists.delete(id);
  await addTomb('playlists', [id]);
  await db.del('playlists', id);
  changed('playlists');
}
export async function duplicatePlaylist(id) {
  const p = lib.playlists.get(id);
  return createPlaylist({ name: `${p.name} (copy)`, songIds: p.songs.map((e) => e.songId), folderId: p.folderId, description: p.description, coverId: p.coverId });
}
/** Returns how many songs were actually added (duplicates are skipped). */
export async function addToPlaylist(id, songIds) {
  let added = 0;
  await editPl(id, (p) => {
    const have = new Set(p.songs.map((e) => e.songId));
    const now = Date.now();
    const add = [...new Set(songIds)].filter((s) => !have.has(s));
    added = add.length;
    return { songs: [...p.songs, ...add.map((songId, i) => ({ songId, addedAt: now + i }))] };
  });
  return added;
}
export async function removeFromPlaylist(id, songIds) {
  const rm = new Set(songIds);
  await editPl(id, (p) => ({ songs: p.songs.filter((e) => !rm.has(e.songId)) }));
}
/** Move `songIds` (in their current relative order) so they sit at index `to` of the remaining list. */
export async function reorderPlaylist(id, songIds, to) {
  const mv = new Set(songIds);
  await editPl(id, (p) => {
    const moving = p.songs.filter((e) => mv.has(e.songId));
    const rest = p.songs.filter((e) => !mv.has(e.songId));
    rest.splice(Math.max(0, Math.min(to, rest.length)), 0, ...moving);
    return { songs: rest };
  });
}
export async function createFolder(name) {
  const f = { id: uid(), name: name || 'New Folder', createdAt: Date.now(), updatedAt: Date.now() };
  lib.folders.set(f.id, f);
  await db.put('folders', f);
  changed('playlists');
  return f;
}
export async function renameFolder(id, name) {
  const rec = await db.update('folders', id, (f) => f && { ...f, name, updatedAt: Date.now() });
  if (rec) Object.assign(lib.folders.get(id) || {}, rec);
  changed('playlists');
}
export async function deleteFolder(id) {
  for (const p of [...lib.playlists.values()].filter((x) => x.folderId === id)) await editPl(p.id, () => ({ folderId: null }), { quiet: true });
  lib.folders.delete(id);
  await addTomb('folders', [id]);
  await db.del('folders', id);
  changed('playlists');
}

// ---------- history ----------
export async function addHistory(songId, ctx) {
  const h = { songId, at: Date.now(), ctx: ctx ? { type: ctx.type, id: ctx.id ?? null } : null };
  h.id = await new Promise((res) => db.openDB().then((d) => {
    const r = d.transaction('history', 'readwrite').objectStore('history').add(h);
    r.onsuccess = () => res(r.result);
  }));
  lib.history.push(h);
  if (ctx?.type === 'playlist' && lib.playlists.has(ctx.id)) {
    lib.playlists.get(ctx.id).playedAt = h.at;
    await db.update('playlists', ctx.id, (p) => p && { ...p, playedAt: h.at }); // only the play time
  }
  if (lib.history.length > 5000) {
    const old = lib.history.splice(0, lib.history.length - 5000);
    await db.del('history', ...old.map((x) => x.id));
  }
  changed('history');
}
export function recentSongIds(limit = 200) {
  const seen = new Set(), out = [];
  for (let i = lib.history.length - 1; i >= 0 && out.length < limit; i--) {
    const id = lib.history[i].songId;
    if (!seen.has(id) && lib.songs.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}
/** Distinct recently played contexts (playlists, albums, artists, liked songs), newest first. */
export function recentContexts(limit = 12) {
  const seen = new Set(), out = [];
  for (let i = lib.history.length - 1; i >= 0 && out.length < limit; i--) {
    const c = lib.history[i].ctx;
    if (!c || !['playlist', 'album', 'artist', 'liked', 'songs'].includes(c.type)) continue;
    const k = `${c.type}:${c.id}`;
    if (seen.has(k) || !contextExists(c)) continue;
    seen.add(k);
    out.push({ ...c, at: lib.history[i].at });
  }
  return out;
}
export function lastPlayed(type, id) {
  for (let i = lib.history.length - 1; i >= 0; i--) {
    const c = lib.history[i].ctx;
    if (c && c.type === type && c.id === id) return lib.history[i].at;
  }
  return 0;
}

// ---------- settings ----------
// Albums, artists, All songs and Liked Songs can be removed from (hidden in) the Your Library list.
const libItemKey = (c) => `${c.type}:${c.id ?? ''}`;
export const isHiddenInLibrary = (c) => (lib.settings.libHidden || []).includes(libItemKey(c));
export function setHiddenInLibrary(c, hidden) {
  const set = new Set(lib.settings.libHidden || []);
  if (hidden) set.add(libItemKey(c)); else set.delete(libItemKey(c));
  return setSettings({ libHidden: [...set], libHiddenAt: Date.now() });
}

export async function setSettings(patch) {
  const rec = await db.update('kv', 'settings', (r) => ({ key: 'settings', value: { ...(r?.value || {}), ...patch } }));
  Object.assign(lib.settings, rec.value);
  broadcast();
  events.emit('settings', patch);
}
/** The library exactly as saved (not this window's copy in memory), for sync. */
export async function readSaved() {
  const [songs, playlists, folders, likes, history, settings, tomb] = await Promise.all([
    db.getAll('songs'), db.getAll('playlists'), db.getAll('folders'), db.getAll('likes'), db.getAll('history'), db.kvGet('settings'), db.kvGet('tombstones'),
  ]);
  return { songs, playlists, folders, likes, history: history.sort((a, b) => a.at - b.at), settings: settings || {}, tomb: { songs: {}, playlists: {}, folders: {}, likes: {}, ...(tomb || {}) } };
}

// ---------- derived: albums & artists ----------
function derive() {
  if (derived) return derived;
  const albums = new Map(), artists = new Map();
  for (const s of lib.songs.values()) {
    if (s.album) {
      const k = albumKey(s);
      let a = albums.get(k);
      if (!a) albums.set(k, (a = { key: k, name: s.album, artist: s.albumArtist || artistOf(s), year: s.year || 0, coverId: null, songIds: [], addedAt: 0 }));
      a.songIds.push(s.id);
      a.coverId ||= s.coverId;
      a.year ||= s.year || 0;
      a.addedAt = Math.max(a.addedAt, s.addedAt);
    }
    const ak = artistKey(s.artist);
    let ar = artists.get(ak);
    if (!ar) artists.set(ak, (ar = { key: ak, name: artistOf(s), songIds: [], coverId: null, addedAt: 0 }));
    ar.songIds.push(s.id);
    ar.coverId ||= s.coverId;
    ar.addedAt = Math.max(ar.addedAt, s.addedAt);
  }
  const byTrack = (a, b) => (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0) || title(a).localeCompare(title(b));
  for (const a of albums.values()) a.songIds.sort((x, y) => byTrack(lib.songs.get(x), lib.songs.get(y)));
  for (const a of artists.values()) a.albumKeys = [...new Set(a.songIds.map((id) => lib.songs.get(id)).filter((s) => s.album).map(albumKey))];
  return (derived = { albums, artists });
}
export const albums = () => derive().albums;
export const artists = () => derive().artists;

// ---------- contexts (what is being played from) ----------
export function contextExists(c) {
  if (c.type === 'playlist') return lib.playlists.has(c.id);
  if (c.type === 'album') return albums().has(c.id);
  if (c.type === 'artist') return artists().has(c.id);
  return true;
}
export function contextName(c) {
  if (!c) return '';
  switch (c.type) {
    case 'playlist': return lib.playlists.get(c.id)?.name || 'Playlist';
    case 'album': return albums().get(c.id)?.name || 'Album';
    case 'artist': return artists().get(c.id)?.name || 'Artist';
    case 'liked': return 'Liked Songs';
    case 'songs': return 'All songs';
    case 'recent': return 'Recently played';
    case 'search': return 'Search';
    default: return '';
  }
}
export function contextSongIds(c) {
  switch (c.type) {
    case 'playlist': return lib.playlists.get(c.id)?.songs.map((e) => e.songId) || [];
    case 'album': return albums().get(c.id)?.songIds || [];
    case 'artist': return artists().get(c.id)?.songIds || [];
    case 'liked': return likedSongIds();
    case 'songs': return allSongIds();
    case 'recent': return recentSongIds();
    default: return [];
  }
}
export const contextHref = (c) => ({ playlist: `#/playlist/${c.id}`, album: `#/album/${encodeURIComponent(c.id)}`, artist: `#/artist/${encodeURIComponent(c.id)}`, liked: '#/liked', songs: '#/songs', recent: '#/recent' }[c.type] || '#/');

// ---------- maintenance ----------
/** Remove audio files and covers nothing refers to (e.g. after an interrupted import or edits). */
export async function collectGarbage() {
  const files = new Set([...lib.songs.values()].map((s) => s.file));
  for (const name of await opfs.listNames()) if (!files.has(name) && !name.endsWith('.part')) await opfs.remove(name);
  const used = new Set();
  lib.songs.forEach((s) => s.coverId && used.add(s.coverId));
  lib.playlists.forEach((p) => p.coverId && used.add(p.coverId));
  const unused = [...lib.covers.keys()].filter((id) => !used.has(id));
  unused.forEach((id) => { lib.covers.delete(id); const u = coverUrls.get(id); if (u) URL.revokeObjectURL(u); coverUrls.delete(id); });
  if (unused.length) await db.del('covers', ...unused);
}
/** Replace the library with a merged copy from sync (songs' details, playlists, folders, likes, history). */
export async function replaceLibrary(s) {
  const now = new Set(s.songs.map((x) => x.id));
  const gone = [...lib.songs.values()].filter((x) => !now.has(x.id));
  await db.replace({ songs: s.songs, playlists: s.playlists, folders: s.folders, likes: s.likes, history: s.history.map(({ songId, at, ctx }) => ({ songId, at, ctx })) });
  await db.kvSet('tombstones', s.tomb);
  const o = s.orders || {};
  await db.update('kv', 'settings', (r) => ({ key: 'settings', value: {
    ...(r?.value || {}), libHidden: s.hidden.list, libHiddenAt: s.hidden.at,
    ...(o.liked ? { likedOrder: o.liked.list, likedOrderAt: o.liked.at } : {}), ...(o.songs ? { songsOrder: o.songs.list, songsOrderAt: o.songs.at } : {}),
  } }));
  for (const x of gone) await opfs.remove(x.file);
  await load();
  broadcast();
  if (gone.length) events.emit('deleted', gone.map((x) => x.id));
}

export async function wipeAll() {
  await db.clear(...db.STORES);
  await opfs.clearAll();
  coverUrls.forEach((u) => URL.revokeObjectURL(u));
  coverUrls.clear();
  await load();
}
