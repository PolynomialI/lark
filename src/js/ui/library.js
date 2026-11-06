// "Your Library": sidebar on desktop, a tab on phones. Filters, sorting, list/grid view.
import * as player from '../player.js';
import * as store from '../store.js';
import { esc } from '../util.js';
import { acts, coverHtml, ctxAttr, hrefOf, itemInfo, openMenu } from './common.js';
import { ic } from './icons.js';

const SORTS = { recents: 'Recents', added: 'Recently added', alpha: 'Alphabetical' };
const FILTERS = { playlists: 'Playlists', albums: 'Albums', artists: 'Artists' };

function items() {
  const L = store.lib, f = L.settings.libFilter;
  const recent = new Map();
  for (const h of L.history) if (h.ctx) recent.set(`${h.ctx.type}:${h.ctx.id}`, h.at);
  const out = [];
  if (f === 'all' || f === 'playlists') {
    for (const fo of L.folders.values()) out.push({ c: { type: 'folder', id: fo.id }, name: fo.name, added: fo.createdAt, recent: fo.createdAt });
    for (const p of L.playlists.values()) {
      if (p.folderId && L.folders.has(p.folderId)) continue;
      out.push({ c: { type: 'playlist', id: p.id }, name: p.name, pinned: p.pinned, added: p.createdAt, recent: Math.max(p.playedAt || 0, p.createdAt) });
    }
  }
  if (f === 'all' || f === 'albums') for (const a of store.albums().values()) if (!store.isHiddenInLibrary({ type: 'album', id: a.key })) out.push({ c: { type: 'album', id: a.key }, name: a.name, added: a.addedAt, recent: Math.max(recent.get(`album:${a.key}`) || 0, a.addedAt) });
  if (f === 'all' || f === 'artists') for (const a of store.artists().values()) if (!store.isHiddenInLibrary({ type: 'artist', id: a.key })) out.push({ c: { type: 'artist', id: a.key }, name: a.name, added: a.addedAt, recent: Math.max(recent.get(`artist:${a.key}`) || 0, a.addedAt) });
  const s = L.settings.libSort;
  out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
    || (s === 'alpha' ? a.name.localeCompare(b.name) : s === 'added' ? b.added - a.added : b.recent - a.recent));
  const fixed = (f === 'all' || f === 'playlists' ? [{ c: { type: 'liked' }, pinned: true }, { c: { type: 'songs' }, pinned: true }] : []).filter((x) => !store.isHiddenInLibrary(x.c));
  return [...fixed, ...out];
}

/** sidebar: the desktop sidebar (its title collapses/expands it); otherwise the phone's Your Library page. */
export function libraryHtml({ sidebar = false } = {}) {
  const st = store.lib.settings, grid = st.libView === 'grid';
  const q = player.queue.context, here = location.hash;
  const rows = items().map(({ c, pinned }) => {
    const info = itemInfo(c);
    if (!info) return '';
    const href = hrefOf(c);
    const playing = q && q.type === c.type && (q.id ?? null) === (c.id ?? null);
    const drop = c.type === 'playlist' ? ` data-drop-playlist="${c.id}"` : c.type === 'liked' ? ' data-drop-liked' : '';
    return `<a class="li${href === here ? ' active' : ''}${playing ? ' playing' : ''}" href="${href}" data-menu-ctx="${ctxAttr(c)}"${drop} title="${esc(info.name)}">
      ${coverHtml(info.covers, { liked: info.liked, icon: info.icon, cls: `${grid ? '' : 'sm'} ${info.round ? 'round' : ''}` })}
      <div class="li-text"><div class="li-t">${esc(info.name)}</div><div class="li-s">${pinned && c.type === 'playlist' ? ic('pin', 'pinned') : ''}${esc(info.sub)}</div></div>
      ${playing && !player.engine.paused ? ic('volume-2', 'li-playing') : ''}</a>`;
  }).join('');
  return `<div class="lib">
    <div class="lib-head">${sidebar ? `<button class="lib-title" data-act="side-toggle" title="Collapse or expand Your Library" aria-label="Collapse or expand Your Library">${ic('library')}<span>Your Library</span></button>` : `<a class="lib-title" href="#/library">${ic('library')}<span>Your Library</span></a>`}
      <button class="icon-btn" data-act="lib-add" aria-label="Create playlist or add music" title="Create playlist or add music">${ic('plus')}</button></div>
    <div class="chips">${st.libFilter !== 'all' ? `<button class="chip x" data-act="lib-filter" data-v="all" aria-label="Clear filter">${ic('x')}</button>` : ''}${Object.entries(FILTERS).map(([k, v]) => (st.libFilter === 'all' || st.libFilter === k) ? `<button class="chip${st.libFilter === k ? ' on' : ''}" data-act="lib-filter" data-v="${k}">${v}</button>` : '').join('')}</div>
    <div class="lib-tools"><button class="sort-btn" data-act="lib-sort">${SORTS[st.libSort]}${ic('arrow-up-down')}</button>
      <button class="icon-btn" data-act="lib-view" aria-label="${grid ? 'List view' : 'Grid view'}" title="${grid ? 'List view' : 'Grid view'}">${ic(grid ? 'list' : 'layout-grid')}</button></div>
    <div class="lib-list${grid ? ' grid' : ''}">${rows || '<p class="empty-note">Nothing here yet.</p>'}</div></div>`;
}

Object.assign(acts, {
  'lib-filter': (el) => store.setSettings({ libFilter: el.dataset.v === store.lib.settings.libFilter ? 'all' : el.dataset.v }),
  'lib-view': () => store.setSettings({ libView: store.lib.settings.libView === 'grid' ? 'list' : 'grid' }),
  'lib-sort': (el) => openMenu(Object.entries(SORTS).map(([k, v]) => ({ label: v, checked: store.lib.settings.libSort === k, run: () => store.setSettings({ libSort: k }) })), el),
  'lib-add': (el) => openMenu([
    { label: 'Create playlist', icon: 'list-music', run: acts['new-playlist'] },
    { label: 'Create folder', icon: 'folder-plus', run: acts['new-folder'] },
    '-',
    { label: 'Add music files', icon: 'music', run: () => acts['add-files']() },
    { label: 'Add a folder of music', icon: 'folder', run: () => acts['add-folder']() },
  ], el),
});
