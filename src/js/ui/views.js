// Pages: Home, Search, Library (phone tab), All songs, Liked Songs, Recently played, playlist,
// album, artist, folder, lyrics and settings. Each returns { html, mount(root), deps }.
import { EQ_BANDS, EQ_PRESETS, MAX_VOLUME } from '../engine.js';
import * as P from '../player.js';
import { search } from '../search.js';
import * as store from '../store.js';
import { $, esc, fmtBytes, fmtLong, isMobile, norm } from '../util.js';
import { exportLibrary } from '../zip-export.js';
import { importLibrary } from '../zip-import.js';
import { ctxMenu, isCtxPlaying } from './actions.js';
import { acts, cardHtml, colorOf, coverHtml, ctxAttr, itemInfo, openDialog, openMenu, toast } from './common.js';
import { editPlaylist } from './dialogs.js';
import { ic } from './icons.js';
import { libraryHtml } from './library.js';
import { syncSectionHtml } from './sync.js';
import { mountLyrics } from './nowplaying.js';
import { TrackList } from './tracklist.js';
import { analyzePending } from '../loudness.js';

const L = store.lib;
const viewState = new Map(); // per page: { sort, dir, filter }
const totalTime = (ids) => ids.reduce((a, id) => a + (L.songs.get(id)?.duration || 0), 0);
const songCount = (n) => `${n} ${n === 1 ? 'song' : 'songs'}`;
const settingsBtn = () => `<span class="home-btns"><button class="icon-btn sync-btn" data-act="sync-now" data-bind="sync-btn" hidden></button><a class="icon-btn settings-link" href="#/settings" aria-label="Settings" title="Settings">${ic('settings')}</a></span>`;

function pageHead({ kind, title, desc = '', meta = '', cover, color, editAct = '' }) {
  return `<header class="ph" style="--c:${color}">
    <div class="ph-art"${editAct ? ` data-act="${editAct}" role="button" title="Edit details"` : ''}>${cover}</div>
    <div class="ph-info"><div class="ph-kind">${esc(kind)}</div>
      <h1 class="ph-title${title.length > 22 ? ' long' : ''}"${editAct ? ` data-act="${editAct}"` : ''}>${esc(title)}</h1>
      ${desc ? `<p class="ph-desc">${esc(desc)}</p>` : ''}<div class="ph-meta">${meta}</div></div></header>`;
}
function actionBar(c, { menu = true, tools = '' } = {}) {
  const playing = isCtxPlaying(c);
  return `<div class="ab"><button class="big-play" data-act="play-ctx" data-ctx="${ctxAttr(c)}" aria-label="${playing ? 'Pause' : 'Play'}">${ic(playing ? 'pause' : 'play')}</button>
    <button class="icon-btn lg${P.queue.shuffle ? ' on' : ''}" data-act="shuffle" aria-label="Shuffle" title="Shuffle">${ic('shuffle')}</button>
    ${menu ? `<button class="icon-btn lg" data-act="ctx-menu" data-ctx="${ctxAttr(c)}" aria-label="More options" title="More options">${ic('ellipsis')}</button>` : ''}
    <div class="ab-tools">${tools}</div></div>`;
}

const SORTS = { custom: 'Custom order', title: 'Title', artist: 'Artist', album: 'Album', added: 'Date added', duration: 'Duration' };
function sortIds(ids, { sort, dir }, dates) {
  if (sort === 'custom') return dir > 0 ? ids : [...ids].reverse();
  const key = { title: (s) => norm(store.title(s)), artist: (s) => norm(s.artist), album: (s) => norm(s.album), added: (s) => dates?.get(s.id) || s.addedAt, duration: (s) => s.duration || 0 }[sort];
  return [...ids].sort((a, b) => { const x = key(L.songs.get(a)), y = key(L.songs.get(b)); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
}
function filterIds(ids, q) {
  const n = norm(q);
  if (!n) return ids;
  return ids.filter((id) => { const s = L.songs.get(id); return norm(`${store.title(s)} ${s.artist} ${s.album}`).includes(n); });
}

/** Shared page for anything that is a list of songs. */
function trackPage({ key, c, head, ids, dates, dateLabel, playlistId, sorts, defaultSort, trackNumbers, showAlbum = true, deps, empty, extra = '' }) {
  const st = viewState.get(key) || { sort: defaultSort || 'custom', dir: defaultSort === 'added' ? -1 : 1, filter: '' };
  viewState.set(key, st);
  const tools = sorts ? `<label class="filter">${ic('search')}<input type="search" placeholder="Search in list" value="${esc(st.filter)}" aria-label="Search in list"></label>
    <button class="sort-btn" data-sort>${SORTS[st.sort]}${ic('arrow-up-down')}</button>` : '';
  let list;
  const shown = () => sortIds(filterIds(ids, st.filter), st, dates);
  const editing = !!(playlistId && st.editing);
  return {
    deps,
    html: `${head}<div class="page-body" style="--c:${/--c:([^"]+)"/.exec(head)?.[1] || '#333'}">${editing
      ? `<div class="ab editing-bar"><span>Drag ${ic('grip-vertical')} to reorder</span><button class="btn primary small" data-act="reorder-done" data-key="${key}">Done</button></div>`
      : actionBar(c, { tools })}${extra}
      ${ids.length ? '<div class="tl-host"></div>' : `<div class="empty-state">${empty}</div>`}</div>`,
    mount(root) {
      const host = root.querySelector('.tl-host');
      if (!host) return;
      const reorderable = () => !!playlistId && st.sort === 'custom' && st.dir > 0 && !st.filter;
      list = new TrackList(host, {
        ids: shown(), ctx: c, dates, dateLabel, trackNumbers, showAlbum, playlistId, reorderable: reorderable(), editing,
        onReorder: (moved, to) => store.reorderPlaylist(playlistId, moved, to),
      });
      const refresh = () => { list.o.reorderable = reorderable(); list.setIds(shown()); };
      root.querySelector('.filter input')?.addEventListener('input', (e) => { st.filter = e.target.value; refresh(); });
      root.querySelector('[data-sort]')?.addEventListener('click', (e) => openMenu(sorts.map((k) => ({
        label: SORTS[k], checked: st.sort === k,
        run: () => { if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === 'added' ? -1 : 1; } e.target.closest('[data-sort]').innerHTML = `${SORTS[st.sort]}${ic('arrow-up-down')}`; refresh(); },
      })), e.currentTarget));
    },
    destroy() { list?.destroy(); },
  };
}

export const views = {
  home() {
    const h = new Date().getHours();
    const greet = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const top = `<div class="home-top"><h1>${greet}</h1>${settingsBtn()}</div>`;
    if (!L.songs.size) {
      return { deps: ['songs'], html: `<div class="home">${top}<div class="welcome">
        <h2>Welcome to Lark</h2><p>Your own music, on this device. Add music files, or bring over a library you exported on another device.</p>
        <div class="welcome-btns"><button class="btn primary" data-act="add-files">${ic('music')}<span>Add music files</span></button>
        <button class="btn" data-act="add-folder">${ic('folder')}<span>Add a folder</span></button>
        <button class="btn" data-act="import-library">${ic('download')}<span>Import library</span></button></div>
        <p class="hint">On a computer you can also drag files or folders onto this window.</p></div></div>` };
    }
    const shortcuts = [];
    if (L.likes.size) shortcuts.push({ type: 'liked' });
    [...L.playlists.values()].sort((a, b) => Math.max(b.playedAt || 0, b.updatedAt) - Math.max(a.playedAt || 0, a.updatedAt))
      .forEach((p) => shortcuts.push({ type: 'playlist', id: p.id }));
    for (const r of store.recentContexts(12)) if (shortcuts.length < 8 && !shortcuts.some((s) => s.type === r.type && s.id === r.id)) shortcuts.push(r);
    const sc = shortcuts.slice(0, 8).map((c) => {
      const info = itemInfo(c);
      return info ? `<a class="shortcut" href="${store.contextHref(c)}" data-menu-ctx="${ctxAttr(c)}">${coverHtml(info.covers, { liked: info.liked, icon: info.icon, cls: 'sq' })}<span>${esc(info.name)}</span>
        <button class="card-play sm" data-act="play-ctx" data-ctx="${ctxAttr(c)}" aria-label="Play">${ic('play')}</button></a>` : '';
    }).join('');
    const jump = store.recentContexts(12).map(cardHtml).join('');
    const added = [...store.albums().values()].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12).map((a) => cardHtml({ type: 'album', id: a.key })).join('');
    return {
      deps: ['songs', 'playlists', 'likes', 'history'],
      html: `<div class="home" style="--c:${colorOf(L.playlists.size ? store.playlistCovers([...L.playlists.values()][0])[0] : null)}">${top}
        ${sc ? `<div class="shortcuts">${sc}</div>` : ''}
        ${jump ? `<section class="shelf"><h2>Jump back in</h2><div class="row-cards">${jump}</div></section>` : ''}
        ${added ? `<section class="shelf"><h2>Recently added</h2><div class="row-cards">${added}</div></section>` : ''}
        <section class="shelf"><h2>Your library</h2><div class="row-cards">${cardHtml({ type: 'songs' })}${L.likes.size ? cardHtml({ type: 'liked' }) : ''}</div></section></div>`,
    };
  },

  search() {
    let list, q = viewState.get('search')?.q || '';
    const results = (root) => {
      list?.destroy();
      list = null;
      const box = root.querySelector('.search-results');
      viewState.set('search', { q });
      if (!q.trim()) { box.innerHTML = `<p class="empty-note">Find songs, albums, artists and playlists in your library.</p>`; return; }
      const r = search(q);
      if (!r.top) { box.innerHTML = `<p class="empty-note">No results for "${esc(q)}". Check the spelling or try fewer words.</p>`; return; }
      const topCtx = r.top.kind === 'song' ? null : { type: r.top.kind, id: r.top.id };
      let topHtml;
      if (topCtx) topHtml = cardHtml(topCtx).replace('class="card"', 'class="card top-card"');
      else {
        const s = L.songs.get(r.top.id);
        topHtml = `<div class="card top-card" data-top-song>${coverHtml(s.coverId ? [s.coverId] : [], {})}<div class="card-t">${esc(store.title(s))}</div><div class="card-s">Song · ${esc(store.artistOf(s))}</div>
          <button class="card-play" data-top-play aria-label="Play">${ic('play')}</button></div>`;
      }
      const shelf = (title, items) => (items.length ? `<section class="shelf"><h2>${title}</h2><div class="row-cards">${items.map(cardHtml).join('')}</div></section>` : '');
      box.innerHTML = `<div class="search-top"><section><h2>Top result</h2>${topHtml}</section>
        ${r.songs.length ? `<section class="search-songs"><h2>Songs</h2><div class="tl-host"></div></section>` : ''}</div>
        ${shelf('Artists', r.artists.slice(0, 12).map((id) => ({ type: 'artist', id })))}
        ${shelf('Albums', r.albums.slice(0, 12).map((id) => ({ type: 'album', id })))}
        ${shelf('Playlists', r.playlists.slice(0, 12).map((id) => ({ type: 'playlist', id })))}`;
      const ids = r.songs.slice(0, 50);
      const host = box.querySelector('.tl-host');
      if (host) list = new TrackList(host, { ids, ctx: { type: 'search', id: q }, showAlbum: !isMobile() });
      box.querySelector('[data-top-play]')?.addEventListener('click', () => P.playContext({ type: 'search', id: q }, r.songs, 0));
    };
    return {
      deps: ['songs', 'playlists'],
      html: `<div class="search-page"><h1 class="search-title">Search</h1><div class="search-bar">${ic('search')}<input type="search" id="search-input" placeholder="What do you want to play?" value="${esc(q)}" aria-label="Search" autocomplete="off"></div><div class="search-results"></div></div>`,
      mount(root) {
        const input = root.querySelector('#search-input');
        let t;
        input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = input.value; results(root); }, 80); });
        results(root);
        if (!isMobile() || !q) input.focus({ preventScroll: true });
      },
      update(root) { results(root); },
      destroy() { list?.destroy(); },
    };
  },

  library() {
    return { deps: ['songs', 'playlists', 'likes', 'history'], html: `<div class="lib-page">${libraryHtml()}</div>` };
  },

  songs() {
    const ids = store.allSongIds();
    return trackPage({
      key: 'songs', c: { type: 'songs' }, ids, dates: new Map([...L.songs.values()].map((s) => [s.id, s.addedAt])),
      head: pageHead({ kind: 'Your library', title: 'All songs', meta: `${songCount(ids.length)}, ${fmtLong(totalTime(ids))}`, cover: coverHtml([], { icon: 'music' }), color: '#3d5a80' }),
      sorts: ['added', 'title', 'artist', 'album', 'duration'], defaultSort: 'added', deps: ['songs'],
      empty: '<p>No songs yet.</p><button class="btn primary" data-act="add-files">Add music files</button>',
    });
  },
  liked() {
    const ids = store.likedSongIds();
    return trackPage({
      key: 'liked', c: { type: 'liked' }, ids, dates: new Map(L.likes),
      head: pageHead({ kind: 'Playlist', title: 'Liked Songs', meta: `${songCount(ids.length)}, ${fmtLong(totalTime(ids))}`, cover: coverHtml([], { liked: true }), color: '#8c3f35' }),
      sorts: ['added', 'title', 'artist', 'album', 'duration'], defaultSort: 'added', deps: ['songs', 'likes'],
      empty: '<p>Songs you like will appear here. Save songs by tapping the heart.</p>',
    });
  },
  recent() {
    const ids = store.recentSongIds();
    const dates = new Map();
    for (const h of L.history) dates.set(h.songId, h.at);
    return trackPage({
      key: 'recent', c: { type: 'recent' }, ids, dates, dateLabel: 'Played',
      head: pageHead({ kind: 'Playlist', title: 'Recently played', meta: songCount(ids.length), cover: coverHtml([], { icon: 'clock-3' }), color: '#3a6b5b' }),
      deps: ['songs', 'history'], empty: '<p>Songs you play will appear here.</p>',
    });
  },
  playlist(id) {
    const p = L.playlists.get(id);
    if (!p) return views.missing();
    const ids = p.songs.map((e) => e.songId).filter((s) => L.songs.has(s));
    const covers = store.playlistCovers(p);
    return trackPage({
      key: `playlist:${id}`, c: { type: 'playlist', id }, ids, playlistId: id, dates: new Map(p.songs.map((e) => [e.songId, e.addedAt])),
      head: pageHead({ kind: 'Playlist', title: p.name, desc: p.description, meta: `${songCount(ids.length)}${ids.length ? `, ${fmtLong(totalTime(ids))}` : ''}`, cover: coverHtml(covers, { icon: 'list-music' }), color: colorOf(covers[0]), editAct: 'edit-playlist' }),
      sorts: ['custom', 'title', 'artist', 'album', 'added', 'duration'], defaultSort: 'custom', deps: ['songs', 'playlists'],
      empty: `<p>This playlist is empty.</p><p class="hint">Add songs from any song's ${ic('ellipsis')} menu, by selecting several songs, or by dragging songs onto the playlist in the sidebar.</p>`,
    });
  },
  album(key) {
    const a = store.albums().get(key);
    if (!a) return views.missing();
    return trackPage({
      key: `album:${key}`, c: { type: 'album', id: key }, ids: a.songIds, trackNumbers: true, showAlbum: false,
      head: pageHead({ kind: 'Album', title: a.name, meta: `<a href="#/artist/${encodeURIComponent(store.artistKey(a.artist))}">${esc(a.artist)}</a>${a.year ? ` · ${a.year}` : ''} · ${songCount(a.songIds.length)}, ${fmtLong(totalTime(a.songIds))}`, cover: coverHtml(a.coverId ? [a.coverId] : [], { icon: 'disc-3' }), color: colorOf(a.coverId) }),
      deps: ['songs'], empty: '',
    });
  },
  artist(key) {
    const a = store.artists().get(key);
    if (!a) return views.missing();
    const albumCards = a.albumKeys.map((k) => cardHtml({ type: 'album', id: k })).join('');
    return trackPage({
      key: `artist:${key}`, c: { type: 'artist', id: key }, ids: a.songIds,
      head: pageHead({ kind: 'Artist', title: a.name, meta: `${songCount(a.songIds.length)} · ${a.albumKeys.length} ${a.albumKeys.length === 1 ? 'album' : 'albums'}`, cover: coverHtml(a.coverId ? [a.coverId] : [], { icon: 'user-round', cls: 'round' }), color: colorOf(a.coverId) }),
      extra: `${albumCards ? `<section class="shelf"><h2>Albums</h2><div class="row-cards">${albumCards}</div></section>` : ''}<h2 class="list-title">Songs</h2>`,
      sorts: ['custom', 'title', 'album', 'added', 'duration'], defaultSort: 'custom', deps: ['songs'], empty: '',
    });
  },
  folder(id) {
    const f = L.folders.get(id);
    if (!f) return views.missing();
    const cards = [...L.playlists.values()].filter((p) => p.folderId === id).map((p) => cardHtml({ type: 'playlist', id: p.id })).join('');
    return {
      deps: ['playlists'],
      html: `${pageHead({ kind: 'Folder', title: f.name, cover: coverHtml([], { icon: 'folder' }), color: '#4a4a6a' })}
        <div class="page-body" style="--c:#4a4a6a"><div class="ab"><button class="icon-btn lg" data-act="ctx-menu" data-ctx="folder:${id}" aria-label="More options">${ic('ellipsis')}</button></div>
        ${cards ? `<div class="grid-cards">${cards}</div>` : '<div class="empty-state"><p>This folder is empty. Use "Move to folder" in a playlist\'s menu.</p></div>'}</div>`,
    };
  },
  lyrics() {
    let v;
    return {
      deps: [],
      html: `<div class="lyr-page lyr-scroll" style="--c:${colorOf(P.engine.song?.coverId)}"><div class="lyr-host"></div></div>`,
      mount(root) { v = mountLyrics(root.querySelector('.lyr-host')); },
      destroy() { v?.destroy(); },
    };
  },
  missing() {
    return { deps: [], html: `<div class="empty-state page-missing"><h2>Not found</h2><p>This page doesn't exist anymore.</p><a class="btn" href="#/">Go home</a></div>` };
  },

  settings() {
    const st = L.settings;
    const vol = P.engine.muted ? 0 : P.engine.volume;
    const presetOpts = Object.keys(EQ_PRESETS).map((k) => `<option value="${k}"${st.eq.preset === k ? ' selected' : ''}>${{ flat: 'Flat', bass: 'Bass booster', 'bass-down': 'Bass reducer', treble: 'Treble booster', vocal: 'Vocal', rock: 'Rock', pop: 'Pop', acoustic: 'Acoustic', electronic: 'Electronic' }[k]}</option>`).join('') + `<option value="custom"${st.eq.preset === 'custom' ? ' selected' : ''}>Custom</option>`;
    const bands = EQ_BANDS.map((f, i) => `<label class="eq-band"><input type="range" min="-12" max="12" step="1" value="${st.eq.gains[i]}" data-band="${i}" aria-label="${f} Hz" orient="vertical"><span>${f >= 1000 ? `${f / 1000}k` : f}</span></label>`).join('');
    return {
      deps: [],
      html: `<div class="settings"><h1>Settings</h1>
        <section><h2>Sync with Google Drive</h2><div id="sync-box">${syncSectionHtml()}</div></section>
        <section><h2>Library</h2>
          <div class="set-row"><div><b>Add music</b><p>MP3, M4A/AAC, FLAC, OGG, Opus, WAV. Matching .lrc files add synced lyrics.</p></div>
            <div class="set-btns"><button class="btn" data-act="add-files">Add files</button><button class="btn" data-act="add-folder">Add folder</button></div></div>
          <div class="set-row"><div><b>Export library</b><p>One .zip file with all songs, covers, edits, playlists, likes, history and settings. Move it to another device and import it there.</p></div>
            <button class="btn" data-act="export-library">${ic('upload')}<span>Export</span></button></div>
          <div class="set-row"><div><b>Import library</b><p>Restore a Lark export. You can replace this library or merge into it.</p></div>
            <button class="btn" data-act="import-library">${ic('download')}<span>Import</span></button></div>
          <div class="set-row"><div><b>Storage</b><p id="storage-info">Checking…</p></div></div>
        </section>
        <section><h2>Playback</h2>
          <div class="set-row"><div><b>Volume</b><p>Up to 150%. Above 100%, Lark boosts the sound (a limiter keeps loud songs from distorting). Your phone's volume buttons still work as usual.</p></div>
            <div class="slider-val"><input type="range" class="range" data-bind="vol" min="0" max="150" value="${Math.round(vol * 100)}" style="--p:${(vol / MAX_VOLUME) * 100}%" aria-label="Volume"><output data-bind="vol-pct">${Math.round(vol * 100)}%</output></div></div>
          <div class="set-row"><div><b>Crossfade</b><p>Fade songs into each other. At 0 s songs play back to back (gapless).</p></div>
            <div class="slider-val"><input type="range" class="range" id="set-xfade" min="0" max="12" step="1" value="${st.crossfade}" style="--p:${(st.crossfade / 12) * 100}%"><output>${st.crossfade} s</output></div></div>
          <div class="set-row"><div><b>Normalise volume</b><p>Play all songs at the same loudness, like Spotify's "Normalize volume". Lark reads ReplayGain tags or measures each song once.</p></div>
            <label class="switch"><input type="checkbox" id="set-norm"${st.normalize ? ' checked' : ''}><span></span></label></div>
          <div class="set-row norm-level${st.normalize ? '' : ' off'}"><div><b>Volume level</b><p>The same levels as Spotify: Loud (-11 LUFS, with a limiter), Normal (-14 LUFS) and Quiet (-19 LUFS). Pick the one you use in Spotify to sound the same.</p></div>
            <select class="input" id="set-norm-level" aria-label="Volume level">${['loud', 'normal', 'quiet'].map((k) => `<option value="${k}"${(st.normLevel || 'normal') === k ? ' selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select></div>
          <div class="set-row"><div><b>Equaliser</b><p>Shape the sound with a preset or your own settings.</p></div>
            <label class="switch"><input type="checkbox" id="set-eq"${st.eq.enabled ? ' checked' : ''}><span></span></label></div>
          <div class="eq${st.eq.enabled ? '' : ' off'}"><select class="input" id="set-preset" aria-label="Equaliser preset">${presetOpts}</select><div class="eq-bands">${bands}</div></div>
          <p class="hint">Crossfade, normalisation, the equaliser and volume above 100% use Web Audio. With all of them off, Lark plays through the plain audio player, which is the most reliable for playing with the screen off.</p>
        </section>
        ${isMobile() ? '' : `<section><h2>Keyboard shortcuts</h2><dl class="keys">
          <dt>Space</dt><dd>Play / pause</dd><dt>Shift + → / ←</dt><dd>Next / previous song</dd><dt>→ / ←</dt><dd>Seek 5 seconds</dd>
          <dt>↑ / ↓</dt><dd>Volume</dd><dt>M</dt><dd>Mute</dd><dt>S</dt><dd>Shuffle</dd><dt>R</dt><dd>Repeat</dd><dt>L</dt><dd>Like the current song</dd>
          <dt>Q</dt><dd>Queue</dd><dt>/</dt><dd>Search</dd></dl></section>`}
        <section><h2>About</h2><p class="hint">Lark plays music files you own. Everything stays on this device; nothing is uploaded.</p></section></div>`,
      mount(root) {
        storageInfo(root.querySelector('#storage-info'));
        const xf = root.querySelector('#set-xfade');
        xf.oninput = () => { xf.nextElementSibling.textContent = `${xf.value} s`; xf.style.setProperty('--p', `${(xf.value / 12) * 100}%`); };
        xf.onchange = () => saveAudio({ crossfade: +xf.value });
        root.querySelector('#set-norm').onchange = (e) => { root.querySelector('.norm-level').classList.toggle('off', !e.target.checked); saveAudio({ normalize: e.target.checked }).then(() => e.target.checked && analyzePending()); };
        root.querySelector('#set-norm-level').onchange = (e) => saveAudio({ normLevel: e.target.value });
        root.querySelector('#set-eq').onchange = (e) => { root.querySelector('.eq').classList.toggle('off', !e.target.checked); saveAudio({ eq: { ...L.settings.eq, enabled: e.target.checked } }); };
        root.querySelector('#set-preset').onchange = (e) => {
          const k = e.target.value;
          if (k === 'custom') return saveAudio({ eq: { ...L.settings.eq, preset: k } });
          const gains = EQ_PRESETS[k];
          root.querySelectorAll('[data-band]').forEach((b, i) => { b.value = gains[i]; });
          saveAudio({ eq: { ...L.settings.eq, preset: k, gains: [...gains] } });
        };
        root.querySelectorAll('[data-band]').forEach((b) => {
          b.oninput = () => {
            const gains = [...root.querySelectorAll('[data-band]')].map((x) => +x.value);
            root.querySelector('#set-preset').value = 'custom';
            saveAudio({ eq: { ...L.settings.eq, preset: 'custom', gains } });
          };
        });
      },
    };
  },
};

async function saveAudio(patch) {
  await store.setSettings(patch);
  await P.applySettings();
}
async function storageInfo(el) {
  if (!navigator.storage?.estimate) { el.textContent = 'Not available in this browser.'; return; }
  const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? false]);
  el.innerHTML = `${fmtBytes(usage)} used · ${fmtBytes(Math.max(0, quota - usage))} free · ${L.songs.size} songs<br>${persisted
    ? `${ic('check', 'ok')} Protected: the browser won't clear your library to free up space.`
    : 'Not yet protected from automatic clean-up. Installing Lark (Add to Home screen / Install app) usually fixes this.'}`;
}

// ---------- export / import ----------
Object.assign(acts, {
  'reorder-start': (id) => { viewState.set(`playlist:${id}`, { sort: 'custom', dir: 1, filter: '', editing: true }); acts.rerender(); },
  'reorder-done': (el) => { const st = viewState.get(el.dataset.key); if (st) st.editing = false; acts.rerender(); },
  'edit-playlist': () => { const id = location.hash.split('/')[2]; if (L.playlists.has(id)) editPlaylist(id); },
  'export-library': async () => {
    if (!L.songs.size) return toast('Your library is empty');
    const d = openDialog({ title: 'Export library', body: `<p class="xp-text">Preparing…</p><div class="progress"><div></div></div>
      <p class="hint">Keep Lark open until the download finishes. The file is saved to your Downloads folder.</p>`, actions: [{ label: 'Close' }] });
    const text = d.root.querySelector('.xp-text'), bar = d.root.querySelector('.progress div');
    try {
      const r = await exportLibrary((n, t) => { text.textContent = `Exporting… ${fmtBytes(n)} of ${fmtBytes(t)}`; bar.style.width = `${(n / t) * 100}%`; });
      text.textContent = `Done: ${r.name} (${fmtBytes(r.size)})`;
      bar.style.width = '100%';
    } catch (e) { text.textContent = e.message || String(e); bar.parentElement.classList.add('err'); }
  },
  'import-library': () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = () => input.files[0] && chooseImportMode(input.files[0]);
    input.click();
  },
});
function chooseImportMode(file) {
  const run = (mode) => () => runImport(file, mode);
  openDialog({
    title: 'Import library',
    body: `<p><b>${esc(file.name)}</b> (${fmtBytes(file.size)})</p>
      <p><b>Merge</b> adds the songs, playlists, likes and history from the file to this library. Songs you already have (same file content) are not duplicated.</p>
      <p><b>Replace</b> makes this library exactly like the exported one. Anything not in the file is removed from this device.</p>`,
    actions: [{ label: 'Cancel' }, { label: 'Replace', danger: true, after: run('replace') }, { label: 'Merge', primary: true, after: run('merge') }],
  });
}
async function runImport(file, mode) {
  const d = openDialog({ title: 'Importing library', body: `<p class="xp-text">Reading…</p><div class="progress"><div></div></div><p class="hint">Keep Lark open until this finishes.</p>`, actions: [] });
  const text = d.root.querySelector('.xp-text'), bar = d.root.querySelector('.progress div');
  try {
    const r = await importLibrary(file, mode, (n, t) => { text.textContent = `Copying music… ${fmtBytes(n)} of ${fmtBytes(t)}`; bar.style.width = `${t ? (n / t) * 100 : 100}%`; });
    sessionStorage.setItem('lark-toast', `Imported ${r.songs} songs${r.missing ? ` (${r.missing} missing from the file)` : ''}`);
    location.reload();
  } catch (e) {
    text.textContent = `Import failed: ${e.message || e}`;
    bar.parentElement.classList.add('err');
    d.root.querySelector('.dialog-actions').innerHTML = '<button class="btn" data-close>Close</button>';
  }
}
