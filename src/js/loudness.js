// Volume normalisation: each song's loudness is measured once, in the background, following the
// broadcast standard (ITU-R BS.1770 / EBU R128: K-weighting, 400 ms blocks, -70 LUFS and -10 LU gates).
// Songs with ReplayGain tags don't need measuring. The result is stored as { lufs, peak } on the song.
import * as opfs from './opfs.js';
import { lib, updateSongs } from './store.js';
import { sleep } from './util.js';

const failed = new Set();
let running = false;

export async function analyzePending() {
  if (running || !lib.settings.normalize) return;
  running = true;
  try {
    for (;;) {
      if (!lib.settings.normalize) break;
      const s = [...lib.songs.values()].find((x) => x.lufs == null && !failed.has(x.id) && lib.files.has(x.file));
      if (!s) break;
      try { await updateSongs([s.id], await measure(s), { silent: true }); } catch { failed.add(s.id); }
      await sleep(30);
    }
  } finally { running = false; }
}

/** K-weighting filter coefficients for a sample rate (pre-filter shelf + RLB high-pass), as in libebur128. */
function kWeighting(rate) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416, a0 = 1 + K / Q + K * K;
  const shelf = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  const d = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / d, (1 - K / Q + K * K) / d] };
  return [shelf, hp];
}

/** Integrated loudness (LUFS) and sample peak of decoded audio channels. */
export async function loudnessOf(channels, rate) {
  const filters = kWeighting(rate);
  const hop = Math.round(rate * 0.1), nseg = Math.floor(channels[0].length / hop);
  const seg = new Float64Array(nseg);
  let peak = 0;
  for (const data of channels) {
    const st = filters.map(() => [0, 0, 0, 0]); // x1, x2, y1, y2 per filter
    for (let k = 0; k < nseg; k++) {
      let sum = 0;
      for (let i = k * hop, e = i + hop; i < e; i++) {
        let v = data[i];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        for (let f = 0; f < 2; f++) {
          const { b, a: A } = filters[f], s = st[f];
          const y = b[0] * v + b[1] * s[0] + b[2] * s[1] - A[0] * s[2] - A[1] * s[3];
          s[1] = s[0]; s[0] = v; s[3] = s[2]; s[2] = y;
          v = y;
        }
        sum += v * v;
      }
      seg[k] += sum / hop;
      if (k % 150 === 149) await sleep(0);
    }
  }
  const L = (z) => -0.691 + 10 * Math.log10(z);
  const blocks = [];
  for (let k = 0; k + 4 <= nseg; k++) blocks.push((seg[k] + seg[k + 1] + seg[k + 2] + seg[k + 3]) / 4);
  let gated = blocks.filter((z) => z > 0 && L(z) > -70);
  if (!gated.length) return { lufs: -70, peak };
  const mean = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
  const rel = L(mean(gated)) - 10;
  gated = gated.filter((z) => L(z) > rel);
  return { lufs: Math.round(L(mean(gated)) * 100) / 100, peak: Math.round(peak * 10000) / 10000 };
}

export async function measure(song) {
  const file = await opfs.getFile(song.file);
  const ab = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await file.arrayBuffer());
  const channels = Array.from({ length: Math.min(ab.numberOfChannels, 2) }, (_, i) => ab.getChannelData(i));
  return loudnessOf(channels, ab.sampleRate);
}
