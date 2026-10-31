// Shared UI helpers: covers, cards, menus, dialogs, toasts, overlays (closable with the Back button).
import * as store from '../store.js';
import { $, esc, isMobile } from '../util.js';
import { ic } from './icons.js';

export const acts = {}; // click actions, dispatched from [data-act] elements

export function coverHtml(ids, { cls = '', icon = 'music', liked = false } = {}) {
  if (liked) return `<div class="cover liked ${cls}">${ic('heart')}</div>`;
  if (ids.length >= 4) return `<div class="cover mosaic ${cls}">${ids.slice(0, 4).map((id) => `<img src="${store.coverUrl(id)}" alt="" decoding="async">`).join('')}</div>`;
  if (ids[0]) return `<div class="cover ${cls}"><img src="${store.coverUrl(ids[0])}" alt="" decoding="async"></div>`;
  return `<div class="cover empty ${cls}">${ic(icon)}</div>`;
}
export const colorOf = (coverId) => store.lib.covers.get(coverId)?.color || '#535353';
export const ctxAttr = (c) => `${c.type}:${encodeURIComponent(c.id ?? '')}`;
export function parseCtx(s) {
  const i = s.indexOf(':');
  const id = decodeURIComponent(s.slice(i + 1));
  return { type: s.slice(0, i), id: id || null };
}

/** Everything that can appear in the library / cards: playlists, albums, artists, liked, all songs. */
export function itemInfo(c) {
  const L = store.lib;
  switch (c.type) {
    case 'playlist': { const p = L.playlists.get(c.id); return p && { name: p.name, sub: `Playlist · ${p.songs.length} songs`, covers: store.playlistCovers(p), icon: 'list-music' }; }
    case 'album': { const a = store.albums().get(c.id); return a && { name: a.name, sub: `Album · ${a.artist}`, covers: a.coverId ? [a.coverId] : [], icon: 'disc-3' }; }
    case 'artist': { const a = store.artists().get(c.id); return a && { name: a.name, sub: 'Artist', covers: a.coverId ? [a.coverId] : [], icon: 'user-round', round: true }; }
    case 'liked': return { name: 'Liked Songs', sub: `Playlist · ${store.likedSongIds().length} songs`, covers: [], liked: true };
    case 'songs': return { name: 'All songs', sub: `${L.songs.size} songs`, covers: [], icon: 'music' };
    case 'folder': { const f = L.folders.get(c.id); return f && { name: f.name, sub: `Folder · ${[...L.playlists.values()].filter((p) => p.folderId === f.id).length} playlists`, covers: [], icon: 'folder' }; }
    default: return null;
  }
}
export function cardHtml(c) {
  const info = itemInfo(c);
  if (!info) return '';
  const play = c.type === 'folder' ? '' : `<button class="card-play" data-act="play-ctx" data-ctx="${ctxAttr(c)}" aria-label="Play">${ic('play')}</button>`;
  return `<a class="card" href="${hrefOf(c)}" data-menu-ctx="${ctxAttr(c)}">
    <div class="card-art">${coverHtml(info.covers, { liked: info.liked, icon: info.icon, cls: info.round ? 'round' : '' })}${play}</div>
    <div class="card-t">${esc(info.name)}</div><div class="card-s">${esc(info.sub)}</div></a>`;
}
export const hrefOf = (c) => (c.type === 'folder' ? `#/folder/${c.id}` : store.contextHref(c));

// ---------- overlays & the Back button ----------
// Each open overlay (full player, sheet, menu, dialog) owns one history entry, so Android's Back closes it.
const stack = [];
let afterPop = null, navigating = false;
export function pushOverlay(close) {
  stack.push(close);
  history.pushState({ lark: stack.length }, '');
}
/** Close the top overlay (through history so Back and UI stay in sync), then run `then`. */
export function popOverlay(then) {
  if (!stack.length) return then?.();
  if (then) afterPop = then;
  if (navigating) return;
  navigating = true;
  history.back();
}
export function closeOverlaysThen(fn) {
  if (!stack.length) return fn?.();
  afterPop = fn;
  navigating = true;
  history.go(-stack.length);
}
/** Navigate to a hash route, closing overlays first. */
export const go = (href) => closeOverlaysThen(() => { location.hash = href; });
addEventListener('popstate', () => {
  navigating = false;
  const depth = history.state?.lark || 0;
  while (stack.length > depth) stack.pop()();
  if (afterPop && stack.length <= depth) { const f = afterPop; afterPop = null; f(); }
});
export const overlayOpen = () => stack.length > 0;

// ---------- toast ----------
let toastTimer, sticky = null;
/** A short message at the bottom. { sticky: true } keeps it until its button is tapped (it comes back after other messages). */
export function toast(text, action, { sticky: keep = false } = {}) {
  if (keep) sticky = { text, action };
  const t = $('#toast');
  t.innerHTML = `<span>${esc(text)}</span>${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { if (sticky?.action === action) sticky = null; t.classList.remove('show'); action.run(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  if (keep) return;
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    if (sticky) toastTimer = setTimeout(() => toast(sticky.text, sticky.action, { sticky: true }), 300);
  }, action ? 6000 : 3000);
}

// ---------- menus ----------
let menuEl = null, menuCleanup = null;
export function closeMenu() { if (menuEl) popOverlay(); }
/**
 * items: [{ label, icon, run, sub: () => items, danger, checked }] or '-' for a separator.
 * at: { x, y } (mouse position) or an element to anchor to. head: { title, sub, cover } shown on phones.
 */
export function openMenu(items, at, head) {
  const reuse = !!menuEl; // replacing an open menu keeps its Back-button history entry
  if (menuEl) { menuCleanup(); }
  const sheet = isMobile();
  const el = document.createElement('div');
  el.className = sheet ? 'menu sheet' : 'menu';
  el.setAttribute('role', 'menu');
  const backdrop = document.createElement('div');
  backdrop.className = `menu-backdrop${sheet ? ' dim' : ''}`;
  const render = (list, title) => {
    el.innerHTML = (sheet && head && !title ? `<div class="menu-head">${head.cover || ''}<div><div class="mh-t">${esc(head.title)}</div><div class="mh-s">${esc(head.sub || '')}</div></div></div>` : '')
      + (title ? `<button class="menu-item back" data-i="back">${ic('chevron-left')}<span>${esc(title)}</span></button>` : '')
      + list.map((it, i) => (it === '-' ? '<div class="menu-sep"></div>'
        : `<button class="menu-item${it.danger ? ' danger' : ''}" data-i="${i}" role="menuitem">${it.icon ? ic(it.icon) : '<span class="ic"></span>'}<span>${esc(it.label)}</span>${it.sub ? ic('chevron-right', 'sub') : it.checked ? ic('check', 'sub') : ''}</button>`)).join('');
    el.onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      if (b.dataset.i === 'back') return render(items);
      const it = list[b.dataset.i];
      if (it.sub) return render(it.sub(), it.label);
      popOverlay(() => it.run?.());
    };
    if (!sheet) place();
  };
  const place = () => {
    const r = el.getBoundingClientRect();
    let x, y;
    if (at instanceof Element) { const a = at.getBoundingClientRect(); x = a.right - r.width; y = a.bottom + 4; if (x < 8) x = a.left; }
    else ({ x, y } = at);
    x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
    if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  document.body.append(backdrop, el);
  render(items);
  menuEl = el;
  backdrop.onclick = backdrop.oncontextmenu = (e) => { e.preventDefault(); popOverlay(); };
  const cleanup = () => { el.remove(); backdrop.remove(); if (menuEl === el) menuEl = null; };
  menuCleanup = cleanup;
  if (reuse) stack[stack.length - 1] = cleanup; else pushOverlay(cleanup);
  el.querySelector('button')?.focus({ preventScroll: true });
}

// ---------- dialogs ----------
/** actions: [{ label, primary, danger, run(root) -> false keeps the dialog open, after() runs once closed }] */
export function openDialog({ title, body, actions = [], onMount, cls = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'dialog-wrap';
  wrap.innerHTML = `<div class="dialog ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="dialog-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="dialog-body">${body}</div>
    <div class="dialog-actions">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  let closed = false;
  const close = (then) => { if (!closed) { closed = true; popOverlay(then); } else then?.(); };
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) return close();
    const b = e.target.closest('[data-a]');
    if (!b) return;
    b.disabled = true;
    const a = actions[b.dataset.a];
    try { if ((await a.run?.(wrap)) !== false) close(a.after); } finally { b.disabled = false; }
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'file') { e.preventDefault(); wrap.querySelector('.btn.primary')?.click(); }
  });
  document.body.append(wrap);
  pushOverlay(() => { closed = true; wrap.remove(); });
  onMount?.(wrap);
  wrap.querySelector('input:not([type=file]),textarea')?.focus();
  return { root: wrap, close };
}
export function confirmDialog(title, text, label = 'Delete') {
  return new Promise((res) => {
    let answer = false;
    const d = openDialog({ title, body: `<p>${esc(text)}</p>`, actions: [{ label: 'Cancel' }, { label, primary: true, danger: true, run: () => { answer = true; } }] });
    const obs = new MutationObserver(() => { if (!d.root.isConnected) { obs.disconnect(); res(answer); } });
    obs.observe(document.body, { childList: true });
  });
}
export function promptDialog(title, value = '', label = 'Save') {
  return new Promise((res) => {
    let answer = null;
    const d = openDialog({ title, body: `<input class="input" value="${esc(value)}" maxlength="200">`, actions: [{ label: 'Cancel' }, { label, primary: true, run: (r) => { answer = r.querySelector('input').value.trim(); } }] });
    d.root.querySelector('input').select();
    const obs = new MutationObserver(() => { if (!d.root.isConnected) { obs.disconnect(); res(answer); } });
    obs.observe(document.body, { childList: true });
  });
}
