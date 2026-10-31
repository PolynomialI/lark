// Instant search across songs, albums, artists and playlists, tolerant of typos (edit distance).
import * as store from './store.js';
import { norm } from './util.js';

let index = null;
store.events.on('change', () => { index = null; });
const words = (s) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function build() {
  const items = [];
  const add = (kind, id, fields) => items.push({ kind, id, fields: fields.map(([text, w]) => ({ w, words: words(text) })), main: norm(fields[0][0]) });
  for (const s of store.lib.songs.values()) add('song', s.id, [[store.title(s), 1], [s.artist, 0.8], [s.album, 0.6]]);
  for (const a of store.albums().values()) add('album', a.key, [[a.name, 1], [a.artist, 0.7]]);
  for (const a of store.artists().values()) add('artist', a.key, [[a.name, 1]]);
  for (const p of store.lib.playlists.values()) add('playlist', p.id, [[p.name, 1], [p.description, 0.4]]);
  return (index = items);
}

function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}
function tokenScore(q, w) {
  if (w === q) return 1;
  if (w.startsWith(q)) return 0.9;
  if (q.length >= 3 && w.includes(q)) return 0.6;
  if (q.length < 4) return 0;
  const max = q.length >= 7 ? 2 : 1;
  for (const len of [w.length, q.length - 1, q.length, q.length + 1]) {
    if (len < 1 || len > w.length) continue;
    if (dist(q, w.slice(0, len), max) <= max) return len === w.length ? 0.55 : 0.45;
  }
  return 0;
}

export function search(query) {
  const qs = words(query);
  const empty = { top: null, songs: [], albums: [], artists: [], playlists: [] };
  if (!qs.length) return empty;
  const full = norm(query);
  const scored = [];
  for (const it of index || build()) {
    let total = 0;
    for (const q of qs) {
      let best = 0;
      for (const f of it.fields) for (const w of f.words) { const s = tokenScore(q, w) * f.w; if (s > best) best = s; }
      if (!best) { total = 0; break; }
      total += best;
    }
    if (!total) continue;
    if (it.main.startsWith(full)) total += 0.5;
    if (it.main === full) total += 0.5;
    scored.push([total + (it.kind === 'artist' || it.kind === 'album' ? 0.05 : 0), it]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out = empty;
  for (const [, it] of scored) out[`${it.kind}s`].push(it.id);
  out.top = scored[0] ? { kind: scored[0][1].kind, id: scored[0][1].id } : null;
  return out;
}
