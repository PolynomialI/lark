// Main-thread side of importing music files: collects files, feeds the worker, stores results.
import * as store from './store.js';
import { AUDIO_TYPES, extOf } from './formats.js';
import { analyzePending } from './loudness.js';
import { Emitter } from './util.js';

export const progress = new Emitter();
export const state = { active: false, total: 0, done: 0, added: 0, duplicate: 0, failed: 0, errors: [] };
let worker = null, pending = [], flushTimer = 0, emitTimer = 0;

store.events.on('deleted', (ids) => worker?.postMessage({ type: 'forget', ids }));
store.events.on('change', (what) => { if (what === 'all' && !state.active && worker) { worker.terminate(); worker = null; } });

function getWorker() {
  if (worker) return worker;
  worker = new Worker('import-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'item') {
      state.done++;
      if (data.status === 'added') { state.added++; pending.push(data); } else if (data.status === 'duplicate') state.duplicate++;
      else { state.failed++; state.errors.push(`${data.name}: ${data.error}`); }
      if (pending.length >= 50) flush(); else flushTimer ||= setTimeout(flush, 300);
      emitSoon();
    } else if (data.type === 'idle') finish();
  };
  worker.postMessage({ type: 'known', ids: [...store.lib.songs.keys()] });
  return worker;
}
function emitSoon() { emitTimer ||= setTimeout(() => { emitTimer = 0; progress.emit('progress', state); }, 100); }
async function flush() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  const batch = pending;
  pending = [];
  if (!batch.length) return;
  await store.saveCovers(batch.filter((b) => b.cover).map((b) => b.cover));
  await store.addSongs(batch.map((b) => b.song));
}
async function finish() {
  await flush();
  if (state.done < state.total) return;
  state.active = false;
  progress.emit('progress', state);
  progress.emit('done', state);
  navigator.storage?.persist?.();
  analyzePending();
}

const probe = document.createElement('audio');
const playable = new Map();
const canPlay = (ext) => {
  if (!playable.has(ext)) playable.set(ext, !!AUDIO_TYPES[ext] && probe.canPlayType(AUDIO_TYPES[ext]) !== '');
  return playable.get(ext);
};
const stem = (p) => p.replace(/\.[^./]+$/, '').toLowerCase();

/** items: [{ file, path }] — path is the relative path (used to match .lrc files to songs). */
export function importFiles(items) {
  const lrcs = new Map(), audio = [];
  for (const it of items) {
    const ext = extOf(it.file.name);
    if (ext === 'lrc') lrcs.set(stem(it.path || it.file.name), it.file);
    else if (AUDIO_TYPES[ext] || it.file.type.startsWith('audio/')) audio.push(it);
  }
  if (!audio.length) return 0;
  if (!state.active) Object.assign(state, { active: true, total: 0, done: 0, added: 0, duplicate: 0, failed: 0, errors: [] });
  const jobs = [], base = Date.now();
  audio.forEach((it, i) => {
    state.total++;
    if (!canPlay(extOf(it.file.name))) { state.done++; state.failed++; state.errors.push(`${it.file.name}: format not supported by this browser`); return; }
    jobs.push({ file: it.file, lrc: lrcs.get(stem(it.path || it.file.name)) || null, addedAt: base + i });
  });
  progress.emit('progress', state);
  if (!jobs.length) { finish(); return audio.length; }
  // Hand the files to the worker in small batches so the page never stalls on a huge selection.
  const w = getWorker();
  (async () => {
    for (let i = 0; i < jobs.length; i += 100) {
      w.postMessage({ type: 'jobs', jobs: jobs.slice(i, i + 100) });
      await new Promise((r) => setTimeout(r, 0));
    }
  })();
  return audio.length;
}

export const fromFileList = (list) => [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

/** Collect files (including whole folders) from a drop event. Must be called synchronously in the handler. */
export function fromDataTransfer(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const plain = [...dt.files];
  return (async () => {
    if (!entries.length) return plain.map((file) => ({ file, path: file.name }));
    const out = [];
    const walk = async (entry, path) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        out.push({ file, path: path + file.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const e of batch) await walk(e, `${path}${entry.name}/`);
        }
      }
    };
    for (const e of entries) await walk(e, '');
    return out;
  })();
}
