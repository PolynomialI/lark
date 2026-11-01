// Player: connects the queue, the audio engine, play history, the lock-screen/notification
// controls (Media Session), the sleep timer and resume-after-reload.
import * as db from './db.js';
import { Engine } from './engine.js';
import { Queue } from './queue.js';
import * as store from './store.js';
import { Emitter } from './util.js';

export const engine = new Engine();
export const queue = new Queue();
export const player = new Emitter(); // 'track' | 'state' | 'time' | 'queue' | 'sleep' | 'error' | 'unavailable'
export let sleep = null;             // { until } | { end: true } | null
let sleepTimer = 0, saveTimer = 0, lastSave = 0, lastPos = 0;
const songOf = (id) => store.lib.songs.get(id);

// ---------- playing ----------
export async function playContext(ctx, ids, index = 0) {
  if (!ids.length) return;
  queue.setContext({ ...ctx, name: ctx.name || store.contextName(ctx) }, ids, index);
  await startCurrent(true);
}
async function startCurrent(autoplay = true) {
  const s = songOf(queue.songId);
  if (!s) return;
  if (!store.isAvailable(s)) { engine.pause(); player.emit('unavailable', s); return; }
  await engine.load(s, { autoplay });
  afterTrackChange(autoplay);
}
function afterTrackChange(log) {
  const s = engine.song;
  if (log && s) store.addHistory(s.id, queue.context);
  refreshNext();
  save();
  updateMediaSession();
  player.emit('track', s);
  player.emit('queue');
}
/** Tell the engine what follows the current song (call after any queue change). */
export function refreshNext() {
  const s = songOf(queue.peekNext(true));
  engine.preload(store.isAvailable(s) ? s : null);
}
async function stopAtStart() {
  const s = songOf(queue.songId);
  if (store.isAvailable(s)) await engine.load(s, { autoplay: false });
  afterTrackChange(false);
}

export function toggle() {
  if (!engine.song) {
    const ids = store.allSongIds();
    if (ids.length) playContext({ type: 'songs' }, ids, 0);
    return;
  }
  engine.paused ? engine.play() : engine.pause();
}
export const play = () => engine.play();
export const pause = () => engine.pause();
export async function next() {
  if (!queue.current) return;
  if (queue.next(false)) await startCurrent(true);
  else await stopAtStart();
}
export async function prev() {
  if (!queue.current) return;
  if (engine.currentTime > 3) { engine.seek(0); return; }
  queue.prev();
  await startCurrent(true);
}
export const seek = (t) => { engine.seek(t); updatePosition(true); };
export function setShuffle(on) { queue.setShuffle(on); refreshNext(); save(); player.emit('queue'); }
export function cycleRepeat() { queue.cycleRepeat(); refreshNext(); save(); player.emit('queue'); }

// ---------- queue editing ----------
function queueChanged() { refreshNext(); save(); player.emit('queue'); }
export function playNext(ids) { if (!queue.current) return playContext({ type: 'queue' }, ids, 0); queue.playNext(ids); queueChanged(); }
export function addToQueue(ids) { if (!queue.current) return playContext({ type: 'queue' }, ids, 0); queue.addToQueue(ids); queueChanged(); }
export function removeQueued(uids) { queue.removeQueued(uids); queueChanged(); }
export function clearQueue() { queue.clearQueue(); queueChanged(); }
export function moveQueued(from, to) { queue.moveQueued(from, to); queueChanged(); }
export function removeUpcoming(k) { queue.removeUpcoming(k); queueChanged(); }
export function moveUpcoming(from, to) { queue.moveUpcoming(from, to); queueChanged(); }
export async function jumpToQueued(i) { queue.jumpToQueued(i); await startCurrent(true); }
export async function jumpToUpcoming(k) { queue.jumpToUpcoming(k); await startCurrent(true); }

// ---------- engine events ----------
engine.on('advance', (song) => {
  // The engine started the preloaded song on its own (end of the previous one).
  queue.next(true);
  if (queue.songId !== song.id) queue.current = { songId: song.id, fromQueue: false };
  afterTrackChange(true);
});
engine.on('ended', async () => {
  if (sleep?.end) {
    setSleep(null);
    if (!queue.next(true)) return stopAtStart();
    return startCurrent(false);
  }
  if (queue.next(true)) await startCurrent(true);
  else await stopAtStart();
});
engine.on('error', (song) => {
  player.emit('error', song);
  if (song === engine.song) setTimeout(next, 500);
});
engine.on('state', () => {
  if (navigator.mediaSession) navigator.mediaSession.playbackState = engine.song ? (engine.paused ? 'paused' : 'playing') : 'none';
  updatePosition(true);
  player.emit('state');
  save();
});
engine.on('time', () => {
  player.emit('time');
  updatePosition(false);
  if (sleep?.until && Date.now() >= sleep.until) fireSleep();
  if (!engine.paused && Date.now() - lastSave > 5000) saveNow();
});
engine.on('track', () => player.emit('time'));

// ---------- sleep timer ----------
/** minutes > 0, 'end' (end of the current song) or null (off). */
export function setSleep(v) {
  clearTimeout(sleepTimer);
  sleep = null;
  engine.stopAfterCurrent = false;
  if (v === 'end') { sleep = { end: true }; engine.stopAfterCurrent = true; }
  else if (v > 0) { sleep = { until: Date.now() + v * 60000 }; sleepTimer = setTimeout(fireSleep, v * 60000); }
  if (!sleep) refreshNext();
  player.emit('sleep', sleep);
}
function fireSleep() { engine.pause(); setSleep(null); }

// ---------- persistence (resume after closing) ----------
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
export function saveNow() {
  clearTimeout(saveTimer);
  lastSave = Date.now();
  if (!queue.current) return db.kvSet('playback', null);
  return db.kvSet('playback', { queue: queue.serialize(), t: engine.currentTime });
}
addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveNow());

export async function restore() {
  const st = await db.kvGet('playback');
  if (!st?.queue) return;
  queue.restore(st.queue);
  queue.prune((id) => store.lib.songs.has(id));
  const s = songOf(queue.songId);
  if (!store.isAvailable(s)) return;
  await engine.load(s, { autoplay: false, at: st.t || 0 });
  refreshNext();
  updateMediaSession();
  player.emit('track', s);
  player.emit('queue');
}

store.events.on('deleted', async () => {
  const cur = queue.songId;
  queue.prune((id) => store.lib.songs.has(id));
  if (queue.songId !== cur) {
    engine.pause();
    if (queue.songId) await startCurrent(false);
    else { queue.current = null; saveNow(); player.emit('track', null); }
  }
  queueChanged();
});

// ---------- Media Session (lock screen, notification, headphone/Bluetooth buttons, media keys) ----------
const ms = navigator.mediaSession;
if (ms) {
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch {} };
  set('play', () => engine.play());
  set('pause', () => engine.pause());
  set('stop', () => engine.pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', (d) => seek(d.seekTime));
  set('seekbackward', (d) => seek(engine.currentTime - (d.seekOffset || 10)));
  set('seekforward', (d) => seek(engine.currentTime + (d.seekOffset || 10)));
}
const artCache = new Map();
async function artwork(coverId) {
  if (!coverId) return new URL('icons/icon-512.png', location.href).href;
  if (!artCache.has(coverId)) {
    const blob = store.lib.covers.get(coverId)?.blob;
    if (!blob) return null;
    artCache.clear();
    artCache.set(coverId, await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); }));
  }
  return artCache.get(coverId);
}
export async function updateMediaSession() {
  if (!ms) return;
  const s = engine.song;
  if (!s) { ms.metadata = null; return; }
  const meta = { title: store.title(s), artist: store.artistOf(s), album: s.album || '' };
  ms.metadata = new MediaMetadata(meta);
  const src = await artwork(s.coverId);
  if (src && engine.song === s) ms.metadata = new MediaMetadata({ ...meta, artwork: [{ src, sizes: '512x512', type: s.coverId ? 'image/jpeg' : 'image/png' }] });
}
function updatePosition(force) {
  if (!ms?.setPositionState) return;
  const now = Date.now();
  if (!force && now - lastPos < 1000) return;
  lastPos = now;
  const d = engine.duration;
  try { if (d > 0) ms.setPositionState({ duration: d, playbackRate: 1, position: Math.min(engine.currentTime, d) }); } catch {}
}

// ---------- settings ----------
export function applySettings() {
  const st = store.lib.settings;
  engine.volume = st.volume;
  engine.muted = st.muted;
  engine.setVolume(st.volume);
  return engine.setOptions({ crossfade: st.crossfade, normalize: st.normalize, eq: st.eq });
}
