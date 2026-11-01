// Import worker: hashes each file (duplicate detection by content), reads tags and cover art,
// and writes the audio into OPFS. The main thread stores the resulting records.
import { parseBlob } from 'music-metadata';
import { makeCoverBlob } from './color.js';
import { AUDIO_TYPES, extOf, fromFileName } from './formats.js';
import { toLrc } from './lrc.js';
import { sha256 } from './util.js';

const known = new Set();
const coverCache = new Map(); // raw picture hash -> {id, blob, color}
const jobs = [];
let running = false;
let dirp;
const audioDir = () => (dirp ||= navigator.storage.getDirectory().then((r) => r.getDirectoryHandle('audio', { create: true })));

self.onmessage = ({ data }) => {
  if (data.type === 'known') data.ids.forEach((id) => known.add(id));
  if (data.type === 'forget') data.ids.forEach((id) => known.delete(id));
  if (data.type === 'jobs') { jobs.push(...data.jobs); run(); }
};

async function run() {
  if (running) return;
  running = true;
  while (jobs.length) {
    const job = jobs.shift();
    try { self.postMessage({ type: 'item', ...(await importOne(job)) }); }
    catch (e) { self.postMessage({ type: 'item', status: 'failed', name: job.file.name, error: String(e?.message || e) }); }
  }
  running = false;
  self.postMessage({ type: 'idle' });
}

async function importOne({ file, lrc, addedAt }) {
  const buf = await file.arrayBuffer();
  const id = await sha256(buf);
  if (known.has(id)) return { status: 'duplicate', name: file.name };
  known.add(id);
  try {
    const ext = extOf(file.name);
    let meta = null;
    try { meta = await parseBlob(file, { duration: false }); } catch {}
    if (meta && !meta.format.duration) { try { meta = await parseBlob(file, { duration: true }); } catch {} }
    const c = meta?.common || {};
    const guess = fromFileName(file.name);

    const name = `${id}.${ext}`;
    const fh = await (await audioDir()).getFileHandle(name, { create: true });
    const ah = await fh.createSyncAccessHandle();
    try { ah.truncate(0); ah.write(new Uint8Array(buf), { at: 0 }); ah.flush(); } finally { ah.close(); }

    let cover = null;
    const pics = c.picture || [];
    const pic = pics.find((p) => /front/i.test(p.type || '')) || pics[0];
    if (pic) {
      const rawHash = await sha256(pic.data);
      cover = coverCache.get(rawHash);
      if (!cover) {
        try {
          const made = await makeCoverBlob(new Blob([pic.data], { type: pic.format }));
          cover = { id: await sha256(await made.blob.arrayBuffer()), blob: made.blob, color: made.color };
          coverCache.set(rawHash, cover);
        } catch {}
      }
    }

    let lyrics = '';
    if (lrc) lyrics = await lrc.text();
    else if (c.lyrics?.length) {
      const synced = c.lyrics.find((l) => l.syncText?.length && l.timeStampFormat !== 1);
      lyrics = synced ? toLrc(synced.syncText) : (c.lyrics.find((l) => l.text)?.text || '');
    }
    // ReplayGain tags (gain to -18 LUFS) give the song's loudness without having to measure it.
    const rg = c.replaygain_track_gain?.dB, rgPeak = c.replaygain_track_peak?.ratio;

    const song = {
      id, file: name, type: AUDIO_TYPES[ext] || file.type, size: file.size, name: file.name,
      title: c.title || guess.title, artist: c.artist || guess.artist, album: c.album || '',
      albumArtist: c.albumartist || '', track: c.track?.no || 0, disc: c.disk?.no || 0,
      year: c.year || 0, genre: c.genre?.[0] || '', duration: meta?.format.duration || 0,
      coverId: cover?.id || null, lyrics,
      lufs: Number.isFinite(rg) ? Math.round((-18 - rg) * 100) / 100 : null, peak: Number.isFinite(rg) && rgPeak > 0 ? rgPeak : null,
      addedAt: addedAt || Date.now(),
    };
    return { status: 'added', name: file.name, song, cover };
  } catch (e) {
    known.delete(id);
    throw e;
  }
}
