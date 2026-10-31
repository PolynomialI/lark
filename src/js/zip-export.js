// "Export library": one .zip with library.json + covers/ + audio/ (audio stored as-is, no recompression).
// The zip is generated as a stream (client-zip, ZIP64 for > 4 GB) and handed to the service worker,
// which serves it as a download — so nothing is held in memory and no extra disk space is needed.
import { downloadZip, predictLength } from 'client-zip';
import * as opfs from './opfs.js';
import { lib } from './store.js';

export function libraryJson() {
  return {
    format: 'lark-library', version: 1, exportedAt: new Date().toISOString(),
    songs: [...lib.songs.values()],
    covers: [...lib.covers.values()].map((c) => ({ id: c.id, color: c.color || null })),
    playlists: [...lib.playlists.values()],
    folders: [...lib.folders.values()],
    likes: [...lib.likes].map(([songId, at]) => ({ songId, at })),
    history: lib.history.map(({ songId, at, ctx }) => ({ songId, at, ctx })),
    settings: lib.settings,
  };
}

export async function exportLibrary(onProgress = () => {}) {
  const reg = await navigator.serviceWorker?.ready;
  if (!navigator.serviceWorker?.controller || !reg) throw new Error('Export needs the offline service to be running. Reload the app and try again.');
  const json = new Blob([JSON.stringify(libraryJson())], { type: 'application/json' });
  const now = new Date();
  const covers = [...lib.covers.values()], songs = [...lib.songs.values()];
  const files = [
    { name: 'library.json', size: json.size },
    ...covers.map((c) => ({ name: `covers/${c.id}.jpg`, size: c.blob.size })),
    ...songs.map((s) => ({ name: `audio/${s.file}`, size: s.size })),
  ];
  const total = Number(predictLength(files));
  async function* inputs() {
    yield { name: 'library.json', input: json, lastModified: now };
    for (const c of covers) yield { name: `covers/${c.id}.jpg`, input: c.blob, lastModified: now };
    for (const s of songs) yield { name: `audio/${s.file}`, input: await opfs.getFile(s.file), lastModified: new Date(s.addedAt) };
  }
  let sent = 0;
  let finish, fail;
  const finished = new Promise((res, rej) => { finish = res; fail = rej; });
  const reader = downloadZip(inputs(), { length: total }).body.getReader();
  const counted = new ReadableStream({
    async pull(c) {
      try {
        const { done, value } = await reader.read();
        if (done) { c.close(); finish(); return; }
        sent += value.byteLength;
        onProgress(sent, total);
        c.enqueue(value);
      } catch (e) { c.error(e); fail(e); }
    },
    cancel() { reader.cancel(); fail(new Error('The export was cancelled.')); },
  });
  const id = crypto.randomUUID();
  const name = `lark-library-${now.toISOString().slice(0, 10)}.zip`;
  const ch = new MessageChannel();
  const ack = new Promise((res) => { ch.port1.onmessage = res; });
  navigator.serviceWorker.controller.postMessage({ type: 'export', id, name, size: total, stream: counted }, [ch.port2, counted]);
  await ack;
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = `__export/${id}`;
  document.body.append(frame);
  // Keep the service worker awake while it streams the download.
  const ping = setInterval(() => navigator.serviceWorker.controller?.postMessage({ type: 'ping' }), 10000);
  try { await finished; } finally { clearInterval(ping); setTimeout(() => frame.remove(), 60000); }
  return { name, size: total };
}
