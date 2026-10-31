// LRC (synced lyrics) parsing. Lyrics text containing [mm:ss.xx] tags is treated as synced.
const TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
export const isSynced = (text) => /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(text || '');
export function parseLrc(text) {
  let offset = 0;
  const lines = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\]/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const times = [];
    let m, last = 0;
    TAG.lastIndex = 0;
    while ((m = TAG.exec(raw)) && m.index === last) {
      times.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')));
      last = TAG.lastIndex;
    }
    if (!times.length) continue;
    const words = raw.slice(last).trim();
    for (const t of times) lines.push({ t, text: words });
  }
  lines.forEach((l) => { l.t = Math.max(0, l.t - offset); });
  return lines.sort((a, b) => a.t - b.t);
}
export function toLrc(sync) {
  const ts = (ms) => { const s = ms / 1000; return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };
  return sync.filter((l) => l.timestamp != null).map((l) => `[${ts(l.timestamp)}]${l.text}`).join('\n');
}
