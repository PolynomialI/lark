// In-memory library backed by IndexedDB (metadata) and OPFS (audio).
import * as db from './db.js';
import * as opfs from './opfs.js';
import { Emitter, norm, sha256, uid } from './util.js';

export const DEFAULT_SETTINGS = {
  volume: 0.8, muted: false, crossfade: 0, normalize: false,
  eq: { enabled: false, preset: 'flat', gains: [0, 0, 0, 0, 0, 0] },
  libFilter: 'all', libSort: 'recents', libView: 'list',
};

export const lib = {
  songs: new Map(), covers: new Map(), playlists: new Map(), folders: new Map(),
  likes: new Map(), history: [], settings: structuredClone(DEFAULT_SETTINGS),
};
export const events = new Emitter();
let derived = null;
const changed = (what) => { if (what === 'songs') derived = null; events.emit('change', what); };

export async function load() {
  const [songs, covers, playlists, folders, likes, history, settings] = await Promise.all([
    db.getAll('songs'), db.getAll('covers'), db.getAll('playlists'), db.getAll('folders'),
    db.getAll('likes'), db.getAll('history'), db.kvGet('settings'),
  ]);
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
  fresh.forEach((s) => lib.songs.set(s.id, s));
  if (fresh.length) { await db.put('songs', ...fresh); changed('songs'); }
  return fresh.length;
}
export async function updateSongs(ids, patch, { silent = false } = {}) {
  const list = ids.map((id) => lib.songs.get(id)).filter(Boolean);
  for (const s of list) Object.assign(s, typeof patch === 'function' ? patch(s) : patch);
  await db.put('songs', ...list);
  if (!silent) changed('songs');
}
export async function deleteSongs(ids) {
  const set = new Set(ids);
  const files = ids.map((id) => lib.songs.get(id)?.file).filter(Boolean);
  ids.forEach((id) => { lib.songs.delete(id); lib.likes.delete(id); });
  const pls = [...lib.playlists.values()].filter((p) => p.songs.some((e) => set.has(e.songId)));
  pls.forEach((p) => { p.songs = p.songs.filter((e) => !set.has(e.songId)); });
  await db.del('songs', ...ids);
  await db.del('likes', ...ids);
  if (pls.length) await db.put('playlists', ...pls);
  for (const f of files) await opfs.remove(f);
  events.emit('deleted', ids);
  changed('songs');
}
export const allSongIds = () => [...lib.songs.values()].sort((a, b) => b.addedAt - a.addedAt).map((s) => s.id);

// ---------- likes ----------
export const isLiked = (id) => lib.likes.has(id);
export async function setLiked(ids, liked) {
  const at = Date.now();
  if (liked) {
    const add = ids.filter((id) => !lib.likes.has(id));
    add.forEach((id, i) => lib.likes.set(id, at + i));
    await db.put('likes', ...add.map((id) => ({ songId: id, at: lib.likes.get(id) })));
  } else {
    ids.forEach((id) => lib.likes.delete(id));
    await db.del('likes', ...ids);
  }
  changed('likes');
}
export const toggleLike = (id) => setLiked([id], !isLiked(id));
export const likedSongIds = () => [...lib.likes.entries()].filter(([id]) => lib.songs.has(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id);

// ---------- playlists & folders ----------
const savePl = async (p) => { p.updatedAt = Date.now(); await db.put('playlists', p); changed('playlists'); };
export async function createPlaylist({ name, songIds = [], folderId = null, description = '', coverId = null } = {}) {
  const n = [...lib.playlists.values()].length + 1;
  const now = Date.now();
  const p = { id: uid(), name: name || `My Playlist #${n}`, description, coverId, folderId, pinned: false, createdAt: now, updatedAt: now, playedAt: 0,
    songs: [...new Set(songIds)].map((songId, i) => ({ songId, addedAt: now + i })) };
  lib.playlists.set(p.id, p);
  await savePl(p);
  return p;
}
export async function updatePlaylist(id, patch) {
  const p = lib.playlists.get(id);
  if (p) { Object.assign(p, patch); await savePl(p); }
}
export async function deletePlaylist(id) {
  lib.playlists.delete(id);
  await db.del('playlists', id);
  changed('playlists');
}
export async function duplicatePlaylist(id) {
  const p = lib.playlists.get(id);
  return createPlaylist({ name: `${p.name} (copy)`, songIds: p.songs.map((e) => e.songId), folderId: p.folderId, description: p.description, coverId: p.coverId });
}
/** Returns how many songs were actually added (duplicates are skipped). */
export async function addToPlaylist(id, songIds) {
  const p = lib.playlists.get(id);
  const have = new Set(p.songs.map((e) => e.songId));
  const now = Date.now();
  const add = [...new Set(songIds)].filter((s) => !have.has(s));
  p.songs.push(...add.map((songId, i) => ({ songId, addedAt: now + i })));
  await savePl(p);
  return add.length;
}
export async function removeFromPlaylist(id, songIds) {
  const p = lib.playlists.get(id);
  const rm = new Set(songIds);
  p.songs = p.songs.filter((e) => !rm.has(e.songId));
  await savePl(p);
}
/** Move `songIds` (in their current relative order) so they sit at index `to` of the remaining list. */
export async function reorderPlaylist(id, songIds, to) {
  const p = lib.playlists.get(id);
  const mv = new Set(songIds);
  const moving = p.songs.filter((e) => mv.has(e.songId));
  const rest = p.songs.filter((e) => !mv.has(e.songId));
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, ...moving);
  p.songs = rest;
  await savePl(p);
}
export async function createFolder(name) {
  const f = { id: uid(), name: name || 'New Folder', createdAt: Date.now() };
  lib.folders.set(f.id, f);
  await db.put('folders', f);
  changed('playlists');
  return f;
}
export async function renameFolder(id, name) {
  const f = lib.folders.get(id);
  f.name = name;
  await db.put('folders', f);
  changed('playlists');
}
export async function deleteFolder(id) {
  const pls = [...lib.playlists.values()].filter((p) => p.folderId === id);
  pls.forEach((p) => { p.folderId = null; });
  if (pls.length) await db.put('playlists', ...pls);
  lib.folders.delete(id);
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
    const p = lib.playlists.get(ctx.id);
    p.playedAt = h.at;
    await db.put('playlists', p);
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
export async function setSettings(patch) {
  Object.assign(lib.settings, patch);
  await db.kvSet('settings', lib.settings);
  events.emit('settings', patch);
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
export async function wipeAll() {
  await db.clear(...db.STORES);
  await opfs.clearAll();
  coverUrls.forEach((u) => URL.revokeObjectURL(u));
  coverUrls.clear();
  await load();
}
