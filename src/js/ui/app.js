// App shell: layout, router, global click/keyboard handling, drag & drop import, import progress.
import { fromDataTransfer, fromFileList, importFiles, progress, state as importState } from '../importer.js';
import * as P from '../player.js';
import * as store from '../store.js';
import { $, $$, esc, isMobile } from '../util.js';
import { isCtxPlaying } from './actions.js';
import { acts, go, openDialog, overlayOpen, parseCtx, toast } from './common.js';
import { ic } from './icons.js';
import { libraryHtml } from './library.js';
import { bindMini, bindRight, playerBarHtml, refreshAll, refreshPanels, rightPanelHtml } from './nowplaying.js';
import { views } from './views.js';

const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.wav,.webm,.lrc';

export function initUI() {
  $('#app').innerHTML = `<div class="shell">
    <aside class="sidebar">
      <nav class="panel nav"><div class="brand"><img src="icons/logo.svg" alt="" width="28" height="28"><span>Lark</span></div><a href="#/" data-nav="home">${ic('house')}<span>Home</span></a><a href="#/search" data-nav="search">${ic('search')}<span>Search</span></a></nav>
      <div class="panel side-lib" id="side-lib"></div>
    </aside>
    <main class="panel main" id="main">
      <div class="topbar"><button class="circle" data-act="back" aria-label="Go back">${ic('chevron-left')}</button><button class="circle fwd" data-act="fwd" aria-label="Go forward">${ic('chevron-right')}</button><span class="topbar-title"></span><span class="spacer"></span><a class="circle" href="#/settings" aria-label="Settings" title="Settings">${ic('settings')}</a></div>
      <div id="view"></div>
    </main>
    ${rightPanelHtml()}
    ${playerBarHtml()}
    <nav class="tabs"><a href="#/" data-nav="home">${ic('house')}<span>Home</span></a><a href="#/search" data-nav="search">${ic('search')}<span>Search</span></a><a href="#/library" data-nav="library">${ic('library')}<span>Your Library</span></a></nav>
  </div>
  <div id="selbar" class="selbar" hidden></div>
  <div id="import-card" class="import-card" hidden></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="drop-zone" class="drop-zone" hidden><div>${ic('music')}<p>Drop music files or folders to add them to Lark</p></div></div>
  <input type="file" id="file-input" multiple accept="${AUDIO_ACCEPT}" hidden>
  <input type="file" id="folder-input" webkitdirectory multiple hidden>`;

  bindMini();
  bindRight();
  const main = $('#main');
  main.addEventListener('scroll', () => main.classList.toggle('scrolled', main.scrollTop > (isMobile() ? 200 : 120)), { passive: true });
  refreshAll();
  renderSidebar();
  render();
  addEventListener('hashchange', () => render());
  matchMedia('(max-width: 767px)').addEventListener('change', () => { renderSidebar(); render(true); });

  const msg = sessionStorage.getItem('lark-toast');
  if (msg) { sessionStorage.removeItem('lark-toast'); setTimeout(() => toast(msg), 300); }
}

// ---------- router ----------
let current = null, renderTimer = 0, lastRender = 0;
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  return { name: name || 'home', arg: rest.length ? decodeURIComponent(rest.join('/')) : null, key: h };
}
function render(keepScroll = false) {
  const r = route();
  const make = Object.hasOwn(views, r.name) ? views[r.name] : views.missing;
  current?.view.destroy?.();
  const sc = $('#main'), top = keepScroll ? sc.scrollTop : 0;
  const view = make(r.arg);
  const el = $('#view');
  el.innerHTML = view.html;
  el.dataset.view = r.name;
  current = { r, view };
  view.mount?.(el);
  sc.scrollTop = top;
  sc.classList.toggle('scrolled', sc.scrollTop > (isMobile() ? 200 : 120));
  lastRender = Date.now();
  // Top bar: page title (shown once scrolled) and colour; tab pages have no back button on phones.
  $('.topbar-title').textContent = el.querySelector('.ph-title')?.textContent || '';
  sc.style.setProperty('--tc', el.querySelector('.ph')?.style.getPropertyValue('--c') || '#181818');
  document.body.classList.toggle('tab-page', ['home', 'search', 'library'].includes(r.name));
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.name || (r.name === 'home' && a.dataset.nav === 'home' && !r.key)));
  $$('#side-lib .li').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === location.hash));
  refreshPanels();
}
function scheduleRender() {
  if (renderTimer) return;
  const gap = progressActive ? 1500 : 150;
  renderTimer = setTimeout(() => {
    renderTimer = 0;
    if (current?.view.update) current.view.update($('#view'));
    else render(true);
  }, Math.max(0, gap - (Date.now() - lastRender)));
}
let sideTimer = 0;
function renderSidebar() {
  clearTimeout(sideTimer);
  sideTimer = 0;
  if (!isMobile()) $('#side-lib').innerHTML = libraryHtml();
}
const scheduleSidebar = () => { sideTimer ||= setTimeout(renderSidebar, progressActive ? 1500 : 100); };

store.events.on('change', (what) => {
  scheduleSidebar();
  if (current && (what === 'all' || current.view.deps?.includes(what))) scheduleRender();
});
store.events.on('settings', (patch) => {
  if ('libFilter' in patch || 'libSort' in patch || 'libView' in patch || 'libHidden' in patch) { renderSidebar(); if (current?.r.name === 'library') render(true); }
});
function refreshPlayButtons() {
  $$('.big-play[data-ctx]').forEach((b) => {
    const playing = isCtxPlaying(parseCtx(b.dataset.ctx));
    b.innerHTML = ic(playing ? 'pause' : 'play');
    b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  });
}
P.player.on('state', () => { refreshPlayButtons(); scheduleSidebar(); });
P.player.on('track', () => { refreshPlayButtons(); scheduleSidebar(); if (current?.r.name === 'lyrics') $('.lyr-page')?.style.setProperty('--c', store.lib.covers.get(P.engine.song?.coverId)?.color || '#333'); });
P.player.on('queue', refreshPlayButtons);

// ---------- global clicks ----------
Object.assign(acts, {
  rerender: () => render(true),
  back: () => history.back(),
  fwd: () => history.forward(),
  'add-files': () => $('#file-input').click(),
  'add-folder': () => $('#folder-input').click(),
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (a && acts[a.dataset.act]) { acts[a.dataset.act](a, e); return; }
  const link = e.target.closest('a[href^="#"]');
  if (link && overlayOpen()) { e.preventDefault(); go(link.getAttribute('href')); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'file-input' || e.target.id === 'folder-input') {
    startImport(fromFileList(e.target.files));
    e.target.value = '';
  }
});

// ---------- keyboard shortcuts (desktop) ----------
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const t = e.target;
  if (t.closest?.('textarea,select,[contenteditable]') || (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox')) return;
  if (t.type === 'range' && e.key.startsWith('Arrow')) return;
  if (document.querySelector('.dialog-wrap') && e.key !== ' ') return;
  const E = P.engine;
  const keys = {
    ' ': () => P.toggle(),
    ArrowRight: () => (e.shiftKey ? P.next() : P.seek(E.currentTime + 5)),
    ArrowLeft: () => (e.shiftKey ? P.prev() : P.seek(E.currentTime - 5)),
    ArrowUp: () => { E.setMuted(false); E.setVolume(E.volume + 0.1); store.setSettings({ volume: E.volume, muted: false }); },
    ArrowDown: () => { E.setVolume(Math.max(0, E.volume - 0.1)); store.setSettings({ volume: E.volume }); },
    m: () => { E.setMuted(!E.muted); store.setSettings({ muted: E.muted }); },
    s: () => P.setShuffle(!P.queue.shuffle),
    r: () => P.cycleRepeat(),
    l: () => E.song && store.toggleLike(E.song.id),
    q: () => acts.queue(),
    '/': () => { go('#/search'); setTimeout(() => $('#search-input')?.focus(), 50); },
  };
  const fn = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!fn) return;
  e.preventDefault();
  fn();
});

// ---------- importing music ----------
let progressActive = false, hideTimer = 0;
function startImport(items) {
  const n = importFiles(items);
  if (!n) toast('No music files found there');
}
const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; $('#drop-zone').hidden = false; } });
addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#drop-zone').hidden = true; } });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop-zone').hidden = true;
  startImport(await fromDataTransfer(e.dataTransfer));
});
progress.on('progress', (st) => {
  progressActive = st.active;
  const card = $('#import-card');
  clearTimeout(hideTimer);
  card.hidden = false;
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  card.innerHTML = `<div class="ic-head"><b>${st.active ? 'Adding music…' : 'Music added'}</b><button class="icon-btn sm" data-act="import-hide" aria-label="Hide">${ic('x')}</button></div>
    <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
    <p><span class="ic-count">${st.done} of ${st.total}</span> · ${st.added} added${st.duplicate ? ` · ${st.duplicate} already in library` : ''}${st.failed ? ` · <button class="link-btn" data-act="import-errors">${st.failed} failed</button>` : ''}</p>`;
  if (!st.active) {
    if (!st.failed) hideTimer = setTimeout(() => { card.hidden = true; }, 6000);
    scheduleRender();
    scheduleSidebar();
  }
});
Object.assign(acts, {
  'import-hide': () => { $('#import-card').hidden = true; },
  'import-errors': async () => {
    const { state } = await import('../importer.js');
    openDialog({ title: 'Files that could not be added', body: `<ul class="err-list">${state.errors.slice(0, 200).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, actions: [{ label: 'Close', primary: true }] });
  },
});

// ---------- offline service worker & updates ----------
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const apply = (w) => { updating = true; P.saveNow(); w.postMessage({ type: 'skipWaiting' }); };
    // A new version switches over by itself when nothing is playing or being imported/edited;
    // otherwise a "Restart" prompt stays on screen until it's tapped.
    const busy = () => !P.engine.paused || importState.active || !!document.querySelector('.dialog-wrap');
    const offer = (w) => (busy() ? toast('A new version of Lark is ready', { label: 'Restart', run: () => apply(w) }, { sticky: true }) : apply(w));
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => {});
}
