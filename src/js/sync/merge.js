// Merging two copies of the library (this device and Google Drive).
// Per song / playlist / folder / like the newest change wins; a deletion wins over older changes.
// History from both sides is combined.

const stamp = (x) => x.updatedAt || x.addedAt || x.createdAt || 0;
const KINDS = ['songs', 'playlists', 'folders', 'likes'];

function newest(a = [], b = []) {
  const m = new Map();
  for (const x of [...a, ...b]) {
    const cur = m.get(x.id);
    if (!cur || stamp(x) > stamp(cur)) m.set(x.id, x);
    else if (stamp(x) === stamp(cur) && x !== cur) m.set(x.id, { ...x, ...cur }); // same edit: keep fields either side has (e.g. measured loudness)
  }
  return [...m.values()];
}

export function merge(a, b) {
  const tomb = {};
  for (const k of KINDS) {
    tomb[k] = { ...(a.tomb?.[k] || {}) };
    for (const [id, t] of Object.entries(b.tomb?.[k] || {})) tomb[k][id] = Math.max(tomb[k][id] || 0, t);
  }
  const alive = (kind, x) => !((tomb[kind][x.id] || 0) >= stamp(x));
  const songs = newest(a.songs, b.songs).filter((s) => alive('songs', s));
  const ids = new Set(songs.map((s) => s.id));
  const playlists = newest(a.playlists, b.playlists).filter((p) => alive('playlists', p))
    .map((p) => (p.songs.every((e) => ids.has(e.songId)) ? p : { ...p, songs: p.songs.filter((e) => ids.has(e.songId)) }));
  const folders = newest(a.folders, b.folders).filter((f) => alive('folders', f));
  const likeAt = new Map();
  for (const l of [...(a.likes || []), ...(b.likes || [])]) likeAt.set(l.songId, Math.max(likeAt.get(l.songId) || 0, l.at));
  const likes = [...likeAt].filter(([id, at]) => ids.has(id) && !((tomb.likes[id] || 0) >= at)).map(([songId, at]) => ({ songId, at }));
  const seen = new Set();
  const history = [...(a.history || []), ...(b.history || [])]
    .filter((h) => { const k = `${h.songId}@${h.at}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => x.at - y.at).slice(-5000).map(({ songId, at, ctx }) => ({ songId, at, ctx: ctx ?? null }));
  const ha = a.hidden || { list: [], at: 0 }, hb = b.hidden || { list: [], at: 0 };
  const orders = {};
  for (const k of ['liked', 'songs']) {
    const oa = a.orders?.[k] || { list: [], at: 0 }, ob = b.orders?.[k] || { list: [], at: 0 };
    orders[k] = ob.at > oa.at ? ob : oa;
  }
  return { songs, playlists, folders, likes, history, hidden: hb.at > ha.at ? hb : ha, orders, tomb };
}

/** Same data → same text, whatever the order of items or object keys. */
export function canon(s) {
  const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, stable(v[k])])) : v);
  const by = (k) => (x, y) => (String(x[k]) < String(y[k]) ? -1 : String(x[k]) > String(y[k]) ? 1 : 0);
  return JSON.stringify(stable({
    songs: [...s.songs].sort(by('id')), playlists: [...s.playlists].sort(by('id')), folders: [...s.folders].sort(by('id')),
    likes: [...s.likes].sort(by('songId')), history: s.history, hidden: s.hidden, orders: s.orders, tomb: s.tomb,
  }));
}
