// Sync with Google Drive: a "Lark" folder holds library.json (songs' details, playlists, folders,
// likes, history), the audio files (audio-<id>.<ext>) and covers (cover-<id>.jpg).
// Each run: merge the library both ways, then upload songs/covers this device has and Drive
// doesn't, download the ones Drive has and this device doesn't (on Wi-Fi), and tidy up deletions.
import { dominantColor } from '../color.js';
import * as db from '../db.js';
import * as opfs from '../opfs.js';
import * as store from '../store.js';
import { Emitter, sha256 } from '../util.js';
import * as auth from './auth.js';
import { createDrive, NeedAuth } from './drive.js';
import { canon, merge } from './merge.js';

export const events = new Emitter(); // 'status', 'need-auth'
export const status = { configured: auth.configured(), connected: false, email: '', state: 'off', message: '', lastSync: 0, progress: null, waitingWifi: 0 };
let st = { connected: false, email: '', folderId: null, remoteMd5: null, syncedHash: null, lastSync: 0 };
let tok = null;
let running = null, rerun = false, timer = 0, due = Infinity, applying = false, allowCellular = false;
const drive = createDrive(() => (tok && tok.expiresAt > Date.now() + 30000 ? tok.token : null));
const FOLDER = 'Lark';
const hashText = (t) => sha256(new TextEncoder().encode(t));

function set(patch) { Object.assign(status, patch); events.emit('status', status); }
const save = () => db.kvSet('sync', st);

export async function init() {
  st = { ...st, ...((await db.kvGet('sync')) || {}) };
  tok = (await db.kvGet('syncToken')) || null;
  set({ configured: auth.configured(), connected: st.connected, email: st.email, lastSync: st.lastSync || 0, state: st.connected ? 'idle' : 'off' });
  // ('all' = the library was reloaded, e.g. because another Lark window saved something; that window syncs it.)
  store.events.on('change', (what) => { if (!applying && what !== 'files' && what !== 'all') schedule(what === 'history' ? 60000 : 5000); });
  store.events.on('settings', (p) => { if (!applying && ('libHidden' in p || 'likedOrder' in p || 'songsOrder' in p)) schedule(5000); });
  addEventListener('online', () => schedule(1000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(1000); });
  setInterval(() => { if (document.visibilityState === 'visible') schedule(0); }, 180000);
  if (st.connected) { auth.loadGoogle().catch(() => {}); schedule(1500); }
}

/** Run a sync after `ms` (an earlier request wins). */
export function schedule(ms) {
  if (!st.connected) return;
  const d = Date.now() + ms;
  if (timer && d >= due) return;
  clearTimeout(timer);
  due = d;
  timer = setTimeout(() => { timer = 0; due = Infinity; run(); }, ms);
}

async function signIn() {
  tok = await auth.requestToken(st.email);
  await db.kvSet('syncToken', tok);
}
/** First-time connect (from a tap). */
export async function connect() {
  await signIn();
  const about = await drive.about();
  st = { ...st, connected: true, email: about.user?.emailAddress || '' };
  await save();
  set({ connected: true, email: st.email, state: 'idle' });
  return run();
}
/** "Sync now" (from a tap): signs in again first if the one-hour Google sign-in has run out. */
export async function syncNow() {
  if (!st.connected) return;
  if (!drive.hasToken()) await signIn();
  return run();
}
export function downloadOnMobileData() { allowCellular = true; return run(); }
export async function disconnect() {
  if (tok) auth.revoke(tok.token);
  tok = null;
  st = { connected: false, email: '', folderId: null, remoteMd5: null, syncedHash: null, lastSync: 0 };
  await db.kvSet('sync', st);
  await db.kvSet('syncToken', null);
  set({ connected: false, email: '', state: 'off', message: '', progress: null, waitingWifi: 0 });
}

export function run() {
  if (!st.connected) return Promise.resolve();
  if (running) { rerun = true; return running; }
  running = (async () => {
    do {
      rerun = false;
      if (!navigator.onLine) { set({ state: 'offline', message: "You're offline. Lark will sync when you're back online." }); break; }
      if (!drive.hasToken()) { needAuth(); break; }
      try {
        set({ state: 'syncing', message: 'Syncing…', progress: null });
        // One sync at a time, even with Lark open in several windows.
        if (navigator.locks?.request) await navigator.locks.request('lark-sync', () => doSync());
        else await doSync();
        st.lastSync = Date.now();
        await save();
        set({ state: 'idle', lastSync: st.lastSync, progress: null, message: status.waitingWifi ? `${status.waitingWifi} songs will transfer on Wi-Fi.` : 'Up to date.' });
      } catch (e) {
        if (e instanceof NeedAuth) { tok = null; needAuth(); } else set({ state: 'error', message: e.message || String(e), progress: null });
        break;
      }
    } while (rerun);
  })().finally(() => { running = null; });
  return running;
}
function needAuth() {
  set({ state: 'auth', message: 'Tap Sync to sign in to Google again (Google sign-ins last an hour).', progress: null });
  events.emit('need-auth');
}

/** This device's library as saved (read fresh, so another Lark window's changes are included). */
async function localState() {
  const L = await store.readSaved();
  return {
    songs: L.songs, playlists: L.playlists, folders: L.folders,
    likes: L.likes.map(({ songId, at }) => ({ songId, at })),
    history: L.history.map(({ songId, at, ctx }) => ({ songId, at, ctx: ctx ?? null })),
    hidden: { list: L.settings.libHidden || [], at: L.settings.libHiddenAt || 0 },
    orders: Object.fromEntries(['liked', 'songs'].map((k) => [k, { list: L.settings[`${k}Order`] || [], at: L.settings[`${k}OrderAt`] || 0 }])),
    tomb: L.tomb,
  };
}

async function ensureFolder() {
  if (st.folderId) { const m = await drive.meta(st.folderId, 'id,trashed'); if (m && !m.trashed) return st.folderId; }
  const found = await drive.findFolder(FOLDER);
  st.folderId = found?.id || (await drive.createFolder(FOLDER)).id;
  st.remoteMd5 = null;
  st.syncedHash = null;
  await save();
  return st.folderId;
}

async function doSync() {
  const folderId = await ensureFolder();
  let files = await drive.list(folderId);
  const libFile = files.get('library.json');

  // 1. Merge the library both ways.
  const local = await localState();
  let merged = local, remoteHash = st.syncedHash;
  if (libFile && libFile.md5Checksum !== st.remoteMd5) {
    const remote = await (await drive.download(libFile.id)).json();
    merged = merge(local, remote);
    remoteHash = await hashText(canon(merge(remote, remote)));
  }
  const mergedText = canon(merged);
  await downloadCovers(merged, files);
  if (mergedText !== canon(local)) await applyLocal(merged);
  const finalState = await localState();
  const finalHash = await hashText(canon(finalState));
  if (!libFile || finalHash !== remoteHash) {
    if (libFile) {
      const now = await drive.meta(libFile.id, 'id,md5Checksum');
      if (now && now.md5Checksum !== libFile.md5Checksum) { rerun = true; return; } // another device just saved; merge again
    }
    const body = new Blob([JSON.stringify({ format: 'lark-sync', version: 1, savedAt: Date.now(), ...finalState })], { type: 'application/json' });
    const r = libFile ? await drive.updateContent(libFile.id, body, 'application/json') : await drive.createSmall(folderId, 'library.json', body, 'application/json');
    st.remoteMd5 = r.md5Checksum;
  } else st.remoteMd5 = libFile.md5Checksum;
  st.syncedHash = finalHash;
  await save();

  // 2. Covers and songs: upload what Drive lacks, download what this device lacks.
  files = await drive.list(folderId);
  const usedCovers = new Set();
  store.lib.songs.forEach((s) => s.coverId && usedCovers.add(s.coverId));
  store.lib.playlists.forEach((p) => p.coverId && usedCovers.add(p.coverId));
  for (const id of usedCovers) {
    const c = store.lib.covers.get(id);
    if (c && !files.has(`cover-${id}.jpg`)) await drive.createSmall(folderId, `cover-${id}.jpg`, c.blob, 'image/jpeg');
  }
  const songs = [...store.lib.songs.values()];
  const up = songs.filter((s) => store.isAvailable(s) && !files.has(`audio-${s.file}`));
  const down = songs.filter((s) => !store.isAvailable(s) && files.has(`audio-${s.file}`));
  const cellular = navigator.connection?.type === 'cellular';
  if (cellular && !allowCellular && (up.length || down.length)) {
    set({ waitingWifi: up.length + down.length });
  } else {
    set({ waitingWifi: 0 });
    for (let i = 0; i < up.length; i++) {
      set({ message: `Uploading songs to Google Drive… ${i + 1} of ${up.length}`, progress: { done: i, total: up.length } });
      const s = up[i];
      if (store.lib.songs.has(s.id) && store.isAvailable(s)) await drive.uploadLarge(folderId, `audio-${s.file}`, await opfs.getFile(s.file), s.type || 'application/octet-stream');
    }
    for (let i = 0; i < down.length; i++) {
      set({ message: `Downloading songs from Google Drive… ${i + 1} of ${down.length}`, progress: { done: i, total: down.length } });
      const s = down[i];
      if (!store.lib.songs.has(s.id)) continue;
      const res = await drive.download(files.get(`audio-${s.file}`).id);
      await opfs.writeStream(s.file, res.body);
      store.markAvailable(s.file);
    }
  }

  // 3. Songs deleted on any device: move their files in Drive to the bin.
  for (const [name, f] of files) {
    const m = name.match(/^audio-([0-9a-f]{64})\./);
    if (m && store.lib.tomb.songs[m[1]] && !store.lib.songs.has(m[1])) await drive.trash(f.id);
  }
}

async function downloadCovers(state, files) {
  const need = new Set();
  state.songs.forEach((s) => s.coverId && need.add(s.coverId));
  state.playlists.forEach((p) => p.coverId && need.add(p.coverId));
  const got = [];
  for (const id of need) {
    const f = files.get(`cover-${id}.jpg`);
    if (store.lib.covers.has(id) || !f) continue;
    const blob = new Blob([await (await drive.download(f.id)).arrayBuffer()], { type: 'image/jpeg' });
    let color = null;
    try { const bmp = await createImageBitmap(blob); color = dominantColor(bmp); bmp.close(); } catch {}
    got.push({ id, blob, color });
  }
  if (got.length) await store.saveCovers(got);
}

async function applyLocal(merged) {
  applying = true;
  try {
    // Merge once more with this device's current library, in case it changed during the sync.
    await store.replaceLibrary(merge(await localState(), merged));
  } finally { applying = false; }
}
