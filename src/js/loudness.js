// Volume normalisation: songs without ReplayGain tags get their loudness measured in the background
// (an approximation of EBU R128 integrated loudness, gated), stored as a gain to -18 LUFS.
import * as opfs from './opfs.js';
import { lib, updateSongs } from './store.js';
import { clamp, sleep } from './util.js';

const failed = new Set();
let running = false;

export async function analyzePending() {
  if (running || !lib.settings.normalize) return;
  running = true;
  try {
    for (;;) {
      if (!lib.settings.normalize) break;
      const s = [...lib.songs.values()].find((x) => x.rg == null && x.loud == null && !failed.has(x.id) && lib.files.has(x.file));
      if (!s) break;
      try { await updateSongs([s.id], { loud: await measure(s) }, { silent: true }); } catch { failed.add(s.id); }
      await sleep(30);
    }
  } finally { running = false; }
}

export async function measure(song) {
  const file = await opfs.getFile(song.file);
  const ab = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
  const hop = Math.round(ab.sampleRate * 0.1), nseg = Math.floor(ab.length / hop);
  const seg = new Float64Array(nseg);
  let peak = 0;
  for (let ch = 0; ch < ab.numberOfChannels; ch++) {
    const d = ab.getChannelData(ch);
    for (let k = 0; k < nseg; k++) {
      let sum = 0;
      for (let i = k * hop, e = i + hop; i < e; i++) { const v = d[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
      seg[k] += sum / hop;
      if (k % 200 === 199) await sleep(0);
    }
  }
  const L = (z) => -0.691 + 10 * Math.log10(z);
  const blocks = [];
  for (let k = 0; k + 4 <= nseg; k++) blocks.push((seg[k] + seg[k + 1] + seg[k + 2] + seg[k + 3]) / 4);
  let g = blocks.filter((z) => z > 0 && L(z) > -70);
  if (!g.length) return 0;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rel = L(mean(g)) - 10;
  g = g.filter((z) => L(z) > rel);
  let gain = -18 - L(mean(g));
  if (peak > 0) gain = Math.min(gain, -20 * Math.log10(peak));
  return clamp(gain, -20, 12);
}
