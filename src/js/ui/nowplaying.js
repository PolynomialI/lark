// Player UI: desktop player bar, phone mini-player (swipe to skip, swipe up to open),
// full-screen now-playing view, queue panel, lyrics view and sleep timer menu.
import { isSynced, parseLrc } from '../lrc.js';
import * as P from '../player.js';
import * as store from '../store.js';
import { $, $$, clamp, esc, fmtTime, isMobile } from '../util.js';
import { songMenu } from './actions.js';
import { acts, colorOf, coverHtml, go, openMenu, popOverlay, pushOverlay, toast } from './common.js';
import { editSong } from './dialogs.js';
import { ic } from './icons.js';

const { engine, queue } = P;
const btn = (act, icon, label, bind = '', cls = 'icon-btn') => `<button class="${cls}" data-act="${act}"${bind ? ` data-bind="${bind}"` : ''} aria-label="${label}" title="${label}">${ic(icon)}</button>`;
const seekHtml = () => `<div class="seek"><span class="t" data-bind="cur">0:00</span><input type="range" class="range" data-bind="seek" min="0" max="1000" step="1" value="0" aria-label="Seek"><span class="t" data-bind="dur">0:00</span></div>`;
const controlsHtml = () => `<div class="ctrls">${btn('shuffle', 'shuffle', 'Shuffle', 'shuffle')}${btn('prev', 'skip-back', 'Previous')}${btn('toggle', 'play', 'Play', 'play', 'play-btn')}${btn('next', 'skip-forward', 'Next')}${btn('repeat', 'repeat', 'Repeat', 'repeat')}</div>`;

export function playerBarHtml() {
  return `<footer class="pbar" id="pbar">
    <div class="pb-left"><button class="pb-art" data-act="np-open" data-bind="cover" aria-label="Open now playing"></button>
      <div class="pb-meta"><a class="pb-t" data-bind="title"></a><div class="pb-a" data-bind="artist"></div></div>${btn('like-current', 'heart', 'Save to Liked Songs', 'like', 'icon-btn like')}</div>
    <div class="pb-center">${controlsHtml()}${seekHtml()}</div>
    <div class="pb-right">${btn('sleep-menu', 'moon', 'Sleep timer', 'sleep')}${btn('lyrics', 'mic-vocal', 'Lyrics', 'lyrics-btn')}${btn('queue', 'list-music', 'Queue', 'queue-btn')}
      ${btn('mute', 'volume-2', 'Mute', 'mute')}<input type="range" class="range vol" data-bind="vol" min="0" max="100" aria-label="Volume">${btn('np-open', 'maximize-2', 'Full screen')}</div>
  </footer>
  <div class="mini" id="mini" hidden><div class="mini-in"><div class="mini-art" data-bind="cover"></div>
    <div class="mini-meta"><div class="mini-t" data-bind="title"></div><div class="mini-a" data-bind="artist"></div></div>
    ${btn('like-current', 'heart', 'Save to Liked Songs', 'like', 'icon-btn like')}${btn('toggle', 'play', 'Play', 'play')}</div>
    <div class="mini-prog"><div data-bind="prog"></div></div></div>`;
}

// ---------- binding player state to every copy of the controls ----------
const each = (name, fn) => $$(`[data-bind="${name}"]`).forEach(fn);
let seeking = false;
function updateTrack() {
  const s = engine.song;
  const color = s ? colorOf(s.coverId) : '#333';
  each('cover', (el) => { el.innerHTML = s ? coverHtml(s.coverId ? [s.coverId] : [], { cls: el.classList.contains('np-art') ? 'xl' : 'sm' }) : ''; });
  each('title', (el) => {
    el.textContent = s ? store.title(s) : '';
    if (el.tagName === 'A') el.href = s?.album ? `#/album/${encodeURIComponent(store.albumKey(s))}` : '#/';
  });
  each('artist', (el) => {
    el.innerHTML = !s ? '' : el.closest('.mini') ? esc(store.artistOf(s)) : `<a href="#/artist/${encodeURIComponent(store.artistKey(s.artist))}">${esc(store.artistOf(s))}</a>`;
  });
  const mini = $('#mini');
  if (mini) mini.hidden = !s;
  document.body.classList.toggle('has-song', !!s);
  $$('.mini,.np,.lyr-page,.sheet-lyrics').forEach((el) => el.style.setProperty('--c', color));
  document.title = s ? `${store.title(s)} · ${store.artistOf(s)}` : 'Lark';
  updateLike();
  updatePlay();
  updateTime();
}
export function updateLike() {
  const on = !!engine.song && store.isLiked(engine.song.id);
  each('like', (el) => { el.classList.toggle('on', on); el.setAttribute('aria-label', on ? 'Remove from Liked Songs' : 'Save to Liked Songs'); });
}
function updatePlay() {
  const playing = !!engine.song && !engine.paused;
  each('play', (el) => { el.innerHTML = ic(playing ? 'pause' : 'play'); el.setAttribute('aria-label', playing ? 'Pause' : 'Play'); el.title = playing ? 'Pause' : 'Play'; });
}
function updateTime() {
  const t = engine.currentTime, d = engine.duration;
  each('cur', (el) => { if (!seeking) el.textContent = fmtTime(t); });
  each('dur', (el) => { el.textContent = fmtTime(d); });
  const p = d ? clamp(t / d, 0, 1) : 0;
  each('seek', (el) => { if (!seeking) { el.value = Math.round(p * 1000); el.style.setProperty('--p', `${p * 100}%`); } });
  each('prog', (el) => { el.style.width = `${p * 100}%`; });
  for (const l of lyricViews) l.time(t);
}
function updateModes() {
  each('shuffle', (el) => { el.classList.toggle('on', queue.shuffle); el.setAttribute('aria-pressed', queue.shuffle); });
  $$('[data-act=shuffle]').forEach((el) => el.classList.toggle('on', queue.shuffle));
  each('repeat', (el) => {
    el.innerHTML = ic(queue.repeat === 'one' ? 'repeat-1' : 'repeat');
    el.classList.toggle('on', queue.repeat !== 'off');
    const label = { off: 'Enable repeat', all: 'Enable repeat one', one: 'Disable repeat' }[queue.repeat];
    el.setAttribute('aria-label', label);
    el.title = label;
    el.dataset.mode = queue.repeat;
  });
}
function updateVolume() {
  const v = engine.muted ? 0 : engine.volume;
  each('vol', (el) => { el.value = Math.round(v * 100); el.style.setProperty('--p', `${v * 100}%`); });
  each('mute', (el) => { el.innerHTML = ic(v === 0 ? 'volume-x' : v < 0.5 ? 'volume-1' : 'volume-2'); el.setAttribute('aria-label', engine.muted ? 'Unmute' : 'Mute'); });
}
function updateSleep() {
  const s = P.sleep;
  each('sleep', (el) => {
    el.classList.toggle('on', !!s);
    el.title = !s ? 'Sleep timer' : s.end ? 'Sleep timer: end of song' : `Sleep timer: ${Math.ceil((s.until - Date.now()) / 60000)} min left`;
    el.setAttribute('aria-label', el.title);
  });
}
export function refreshAll() { updateTrack(); updateModes(); updateVolume(); updateSleep(); }

P.player.on('track', () => { updateTrack(); refreshPanels(); });
P.player.on('state', updatePlay);
P.player.on('time', updateTime);
P.player.on('queue', () => { updateModes(); refreshPanels(); });
P.player.on('sleep', updateSleep);
P.player.on('error', (s) => toast(`Can't play "${store.title(s)}"`));
engine.on('volume', updateVolume);
store.events.on('change', (w) => { if (w === 'likes') updateLike(); if (w === 'songs' || w === 'all') { updateTrack(); refreshPanels(); } });
setInterval(() => P.sleep?.until && updateSleep(), 30000);

document.addEventListener('input', (e) => {
  const b = e.target.dataset?.bind;
  if (b === 'seek') {
    seeking = true;
    const p = e.target.value / 1000;
    e.target.style.setProperty('--p', `${p * 100}%`);
    each('cur', (el) => { el.textContent = fmtTime(p * engine.duration); });
  } else if (b === 'vol') {
    const v = e.target.value / 100;
    e.target.style.setProperty('--p', `${v * 100}%`);
    if (engine.muted) engine.setMuted(false);
    engine.setVolume(v);
    saveVolume();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.dataset?.bind === 'seek') { seeking = false; P.seek((e.target.value / 1000) * engine.duration); }
});
let volTimer;
function saveVolume() { clearTimeout(volTimer); volTimer = setTimeout(() => store.setSettings({ volume: engine.volume, muted: engine.muted }), 400); }

Object.assign(acts, {
  toggle: () => P.toggle(),
  prev: () => P.prev(),
  next: () => P.next(),
  repeat: () => P.cycleRepeat(),
  'like-current': () => engine.song && store.toggleLike(engine.song.id),
  mute: () => { engine.setMuted(!engine.muted); saveVolume(); },
  'np-open': () => engine.song && openNowPlaying(),
  'np-close': () => popOverlay(),
  queue: () => (isMobile() || $('.np') ? openSheet('queue') : toggleRight()),
  lyrics: () => (isMobile() || $('.np') ? openSheet('lyrics') : go(location.hash === '#/lyrics' ? '#/' : '#/lyrics')),
  'sleep-menu': (el) => openMenu([
    ...(P.sleep ? [{ label: 'Turn off timer', icon: 'x', run: () => { P.setSleep(null); toast('Sleep timer off'); } }, '-'] : []),
    ...[5, 15, 30, 45, 60].map((m) => ({ label: `${m} minutes`, run: () => { P.setSleep(m); toast(`Music will stop in ${m} minutes`); } })),
    { label: 'End of song', checked: !!P.sleep?.end, run: () => { P.setSleep('end'); toast('Music will stop at the end of this song'); } },
  ], el, { title: 'Sleep timer' }),
  'np-menu': (el) => engine.song && songMenu([engine.song.id], el),
  'np-ctx': () => { const c = queue.context; if (c && store.contextHref(c) !== '#/') go(store.contextHref(c)); },
  'q-clear': () => P.clearQueue(),
  'add-lyrics': () => engine.song && editSong(engine.song.id),
});

// ---------- full-screen now playing ----------
function openNowPlaying() {
  const el = document.createElement('div');
  el.className = 'np';
  const c = queue.context, from = c && store.contextName(c);
  el.innerHTML = `<div class="np-bg"></div><div class="np-in">
    <div class="np-head">${btn('np-close', isMobile() ? 'chevron-down' : 'minimize-2', 'Close')}
      <button class="np-from" data-act="np-ctx">${from ? `<small>Playing from ${esc(c.type === 'search' ? 'search' : c.type === 'liked' || c.type === 'songs' ? 'your library' : c.type)}</small><b>${esc(from)}</b>` : ''}</button>${btn('np-menu', 'ellipsis', 'More options')}</div>
    <div class="np-art" data-bind="cover"></div>
    <div class="np-info"><div class="np-meta"><div class="np-t" data-bind="title"></div><div class="np-a" data-bind="artist"></div></div>${btn('like-current', 'heart', 'Save to Liked Songs', 'like', 'icon-btn like lg')}</div>
    ${seekHtml()}${controlsHtml()}
    <div class="np-extra">${btn('sleep-menu', 'moon', 'Sleep timer', 'sleep')}${btn('lyrics', 'mic-vocal', 'Lyrics')}${btn('queue', 'list-music', 'Queue')}</div></div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('open'));
  refreshAll();
  if (!isMobile() && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  const onFs = () => { if (!document.fullscreenElement && el.isConnected) popOverlay(); };
  document.addEventListener('fullscreenchange', onFs);
  pushOverlay(() => {
    document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    el.classList.remove('open');
    setTimeout(() => el.remove(), 250);
  });
  swipeDown(el.querySelector('.np-in'), el);
}
function swipeDown(handle, el) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('button,input,a')) return;
    const sy = e.clientY, sx = e.clientX;
    let dy = 0, vertical = null;
    const mv = (ev) => {
      const ddx = ev.clientX - sx;
      dy = ev.clientY - sy;
      if (vertical === null && Math.hypot(ddx, dy) > 8) vertical = Math.abs(dy) > Math.abs(ddx);
      if (vertical && dy > 0) { el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`; }
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      el.style.transition = '';
      el.style.transform = '';
      if (vertical && dy > 120) popOverlay();
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  });
}

// ---------- mini-player gestures (phones) ----------
export function bindMini() {
  const mini = $('#mini'), inner = mini.querySelector('.mini-in');
  mini.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const sx = e.clientX, sy = e.clientY, w = mini.clientWidth;
    let dx = 0, dy = 0, dir = null;
    const mv = (ev) => {
      dx = ev.clientX - sx; dy = ev.clientY - sy;
      if (!dir && Math.hypot(dx, dy) > 8) dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (dir === 'h') { inner.style.transition = 'none'; inner.style.transform = `translateX(${dx}px)`; inner.style.opacity = 1 - Math.min(0.6, Math.abs(dx) / w); }
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      inner.style.transition = '';
      if (dir === 'h' && Math.abs(dx) > w * 0.25) {
        inner.style.transform = `translateX(${dx < 0 ? -w : w}px)`;
        inner.style.opacity = 0;
        setTimeout(() => {
          (dx < 0 ? P.next() : P.prev());
          inner.style.transition = 'none';
          inner.style.transform = `translateX(${dx < 0 ? w * 0.3 : -w * 0.3}px)`;
          requestAnimationFrame(() => { inner.style.transition = ''; inner.style.transform = ''; inner.style.opacity = ''; });
        }, 180);
        return;
      }
      inner.style.transform = '';
      inner.style.opacity = '';
      if (!dir || (dir === 'v' && dy < -30)) openNowPlaying();
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

// ---------- queue ----------
function qRow(id, k, sec) {
  const s = store.lib.songs.get(id);
  if (!s) return '';
  const tail = sec ? `<button class="icon-btn sm" data-q-remove aria-label="Remove from queue">${ic('x')}</button><span class="grip" data-qgrip aria-label="Drag to reorder">${ic('grip-vertical')}</span>` : '';
  return `<div class="q-row${sec ? '' : ' cur'}" data-k="${k}">${coverHtml(s.coverId ? [s.coverId] : [], { cls: 'sm' })}
    <div class="q-meta"><div class="q-t">${esc(store.title(s))}</div><div class="q-a">${esc(store.artistOf(s))}</div></div>${tail}</div>`;
}
function queueHtml() {
  if (!queue.current) return '<p class="empty-note">Play something to see your queue.</p>';
  const up = queue.upcoming();
  return `<section class="q-sec"><h3>Now playing</h3>${qRow(queue.songId, 0, null)}</section>
    ${queue.user.length ? `<section class="q-sec" data-sec="user"><div class="q-h"><h3>Next in queue</h3><button class="link-btn" data-act="q-clear">Clear queue</button></div>${queue.user.map((q, k) => qRow(q.songId, k, 'user')).join('')}</section>` : ''}
    ${up.length ? `<section class="q-sec" data-sec="ctx"><h3>Next from: ${esc(queue.context?.name || store.contextName(queue.context) || 'Queue')}</h3>${up.slice(0, 100).map((id, k) => qRow(id, k, 'ctx')).join('')}${up.length > 100 ? `<p class="empty-note">and ${up.length - 100} more</p>` : ''}</section>` : ''}`;
}
function bindQueue(root) {
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.q-row');
    const sec = row?.closest('[data-sec]')?.dataset.sec;
    if (!row || !sec || e.target.closest('[data-qgrip]')) return;
    const k = +row.dataset.k;
    if (e.target.closest('[data-q-remove]')) return sec === 'user' ? P.removeQueued([queue.user[k].uid]) : P.removeUpcoming(k);
    sec === 'user' ? P.jumpToQueued(k) : P.jumpToUpcoming(k);
  });
  root.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.q-row');
    if (!row) return;
    e.preventDefault();
    const sec = row.closest('[data-sec]')?.dataset.sec, k = +row.dataset.k;
    const id = sec === 'user' ? queue.user[k].songId : sec === 'ctx' ? queue.upcoming()[k] : queue.songId;
    songMenu([id], { x: e.clientX, y: e.clientY }, { inQueue: !!sec });
  });
  root.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-qgrip]');
    if (!g) return;
    e.preventDefault();
    const row = g.closest('.q-row'), sec = row.closest('[data-sec]'), from = +row.dataset.k;
    const n = sec.querySelectorAll('.q-row').length, h = row.offsetHeight, sy = e.clientY;
    let to = from;
    row.classList.add('lifted');
    const mv = (ev) => {
      const dy = ev.clientY - sy;
      to = clamp(from + Math.round(dy / h), 0, n - 1);
      row.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      row.classList.remove('lifted');
      row.style.transform = '';
      if (to !== from) sec.dataset.sec === 'user' ? P.moveQueued(from, to) : P.moveUpcoming(from, to);
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  });
}
function toggleRight() {
  const r = $('#right');
  r.hidden = !r.hidden;
  document.body.classList.toggle('right-open', !r.hidden);
  refreshPanels();
}

// ---------- lyrics ----------
const lyricViews = new Set();
class LyricsView {
  constructor(el) { this.el = el; this.render(); lyricViews.add(this); }
  render() {
    const s = engine.song;
    this.song = s;
    this.lyricsText = s?.lyrics;
    this.lines = null;
    this.active = -1;
    if (!s) { this.el.innerHTML = '<p class="lyr-empty">Play a song to see its lyrics.</p>'; return; }
    if (!s.lyrics?.trim()) { this.el.innerHTML = `<div class="lyr-empty"><p>No lyrics for this song yet.</p><button class="btn" data-act="add-lyrics">Add lyrics</button></div>`; return; }
    if (isSynced(s.lyrics)) {
      this.lines = parseLrc(s.lyrics);
      this.el.innerHTML = `<div class="lyr synced">${this.lines.map((l, i) => `<p data-i="${i}">${esc(l.text) || '♪'}</p>`).join('')}</div>`;
      this.el.querySelector('.lyr').onclick = (e) => { const p = e.target.closest('[data-i]'); if (p) P.seek(this.lines[p.dataset.i].t); };
      this.time(engine.currentTime);
    } else this.el.innerHTML = `<div class="lyr plain">${s.lyrics.split(/\r?\n/).map((l) => `<p>${esc(l) || '&nbsp;'}</p>`).join('')}</div>`;
  }
  time(t) {
    if (!this.lines) return;
    let i = -1;
    for (let lo = 0, hi = this.lines.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (this.lines[m].t <= t + 0.15) { i = m; lo = m + 1; } else hi = m - 1; }
    if (i === this.active) return;
    this.active = i;
    const ps = this.el.querySelectorAll('.lyr p');
    ps.forEach((p, k) => { p.classList.toggle('active', k === i); p.classList.toggle('past', k < i); });
    const p = ps[i];
    if (p && Date.now() - (this.userScroll || 0) > 3000) {
      const box = this.el.closest('.lyr-scroll') || this.el;
      box.scrollTo({ top: p.offsetTop - box.clientHeight / 3, behavior: 'smooth' });
    }
  }
  destroy() { lyricViews.delete(this); }
}
export function mountLyrics(el) {
  const v = new LyricsView(el);
  const box = el.closest('.lyr-scroll') || el;
  box.addEventListener('wheel', () => { v.userScroll = Date.now(); }, { passive: true });
  box.addEventListener('touchmove', () => { v.userScroll = Date.now(); }, { passive: true });
  return v;
}

// ---------- panels & sheets ----------
let sheet = null;
function openSheet(kind) {
  const el = document.createElement('div');
  el.className = `sheet-full sheet-${kind}`;
  el.innerHTML = `<div class="sheet-head">${btn('np-close', 'chevron-down', 'Close')}<h2>${kind === 'queue' ? 'Queue' : 'Lyrics'}</h2><span></span></div><div class="sheet-body ${kind === 'lyrics' ? 'lyr-scroll' : ''}"></div>`;
  document.body.append(el);
  el.style.setProperty('--c', colorOf(engine.song?.coverId));
  const body = el.querySelector('.sheet-body');
  let view = null;
  if (kind === 'queue') { body.innerHTML = queueHtml(); bindQueue(body); } else view = mountLyrics(body);
  sheet = { kind, body, view };
  requestAnimationFrame(() => el.classList.add('open'));
  pushOverlay(() => { view?.destroy(); sheet = null; el.classList.remove('open'); setTimeout(() => el.remove(), 250); });
}
export function refreshPanels() {
  const r = $('#right');
  if (r && !r.hidden) r.querySelector('.right-body').innerHTML = queueHtml();
  if (sheet?.kind === 'queue') sheet.body.innerHTML = queueHtml();
  for (const v of lyricViews) if (!v.el.isConnected) lyricViews.delete(v); else if (v.song !== engine.song || v.song?.lyrics !== v.lyricsText) v.render();
  each('lyrics-btn', (el) => el.classList.toggle('on', location.hash === '#/lyrics'));
  each('queue-btn', (el) => el.classList.toggle('on', !r?.hidden));
}
export function rightPanelHtml() {
  return `<aside class="right panel" id="right" hidden><div class="right-head"><h2>Queue</h2>${btn('queue', 'x', 'Close queue')}</div><div class="right-body"></div></aside>`;
}
export function bindRight() { bindQueue($('#right .right-body')); }
