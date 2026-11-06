// Menus and actions on songs, playlists, albums, artists and folders.
import * as player from '../player.js';
import * as store from '../store.js';
import { $, isTouch } from '../util.js';
import { acts, confirmDialog, coverHtml, ctxAttr, go, hrefOf, itemInfo, openMenu, parseCtx, promptDialog, toast } from './common.js';
import { bulkEdit, editPlaylist, editSong } from './dialogs.js';
import { ic } from './icons.js';

export const sortedPlaylists = () => [...store.lib.playlists.values()].sort((a, b) => a.name.localeCompare(b.name));

export function addToPlaylistItems(ids) {
  return [
    { label: 'New playlist', icon: 'plus', run: async () => { const p = await store.createPlaylist({ songIds: ids }); toast(`Added to ${p.name}`); } },
    '-',
    ...sortedPlaylists().map((p) => ({
      label: p.name, icon: 'list-music',
      run: async () => { const n = await store.addToPlaylist(p.id, ids); toast(n ? `Added to ${p.name}` : `Already in ${p.name}`); },
    })),
  ];
}
const tidy = (items) => items.filter(Boolean).filter((it, i, a) => it !== '-' || (i > 0 && a[i - 1] !== '-' && i < a.length - 1));

export function songMenu(ids, at, { playlistId, inQueue } = {}) {
  if (!ids.length) return;
  const one = ids.length === 1 ? store.lib.songs.get(ids[0]) : null;
  const allLiked = ids.every(store.isLiked);
  const items = tidy([
    { label: 'Add to playlist', icon: 'list-plus', sub: () => addToPlaylistItems(ids) },
    playlistId && { label: 'Remove from this playlist', icon: 'trash-2', run: () => store.removeFromPlaylist(playlistId, ids) },
    { label: allLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs', icon: 'heart', run: () => store.setLiked(ids, !allLiked) },
    '-',
    !inQueue && { label: 'Play next', icon: 'list-start', run: () => { player.playNext(ids); toast('Will play next'); } },
    !inQueue && { label: 'Add to queue', icon: 'list-music', run: () => { player.addToQueue(ids); toast(ids.length > 1 ? `Added ${ids.length} songs to queue` : 'Added to queue'); } },
    '-',
    one?.album && { label: 'Go to album', icon: 'disc-3', run: () => go(`#/album/${encodeURIComponent(store.albumKey(one))}`) },
    one && { label: 'Go to artist', icon: 'user-round', run: () => go(`#/artist/${encodeURIComponent(store.artistKey(one.artist))}`) },
    { label: ids.length > 1 ? `Edit ${ids.length} songs` : 'Edit details', icon: 'pencil', run: () => (ids.length > 1 ? bulkEdit(ids) : editSong(ids[0])) },
    '-',
    { label: 'Delete from library', icon: 'trash-2', danger: true, run: async () => {
      const what = one ? `"${store.title(one)}"` : `${ids.length} songs`;
      if (await confirmDialog('Delete from library?', `${what} will be removed from this device, including from all playlists.`)) {
        await store.deleteSongs(ids);
        toast(one ? 'Deleted from library' : `Deleted ${ids.length} songs`);
      }
    } },
  ]);
  const head = one ? { title: store.title(one), sub: store.artistOf(one), cover: coverHtml(one.coverId ? [one.coverId] : [], { cls: 'sm' }) } : { title: `${ids.length} songs selected` };
  openMenu(items, at, head);
}

export function folderItems(p) {
  return [
    { label: 'No folder', icon: 'list-music', checked: !p.folderId, run: () => store.updatePlaylist(p.id, { folderId: null }) },
    ...[...store.lib.folders.values()].map((f) => ({ label: f.name, icon: 'folder', checked: p.folderId === f.id, run: () => store.updatePlaylist(p.id, { folderId: f.id }) })),
    { label: 'New folder', icon: 'folder-plus', run: async () => { const n = await promptDialog('New folder', 'New Folder', 'Create'); if (n) { const f = await store.createFolder(n); await store.updatePlaylist(p.id, { folderId: f.id }); } } },
  ];
}

/** Menu for a playlist / album / artist / Liked Songs / folder. */
export function ctxMenu(c, at) {
  const L = store.lib;
  const ids = () => store.contextSongIds(c);
  const queueItems = [
    { label: 'Play next', icon: 'list-start', run: () => { player.playNext(ids()); toast('Will play next'); } },
    { label: 'Add to queue', icon: 'list-music', run: () => { player.addToQueue(ids()); toast('Added to queue'); } },
  ];
  let items = [];
  if (c.type === 'playlist') {
    const p = L.playlists.get(c.id);
    if (!p) return;
    items = [...queueItems, '-',
      { label: 'Edit details', icon: 'pencil', run: () => editPlaylist(p.id) },
      isTouch() && p.songs.length > 1 && { label: 'Reorder songs', icon: 'grip-vertical', run: () => { go(`#/playlist/${p.id}`); setTimeout(() => acts['reorder-start'](`playlist:${p.id}`), 50); } },
      { label: 'Duplicate', icon: 'copy', run: async () => { const d = await store.duplicatePlaylist(p.id); toast(`Created ${d.name}`); } },
      { label: p.pinned ? 'Unpin playlist' : 'Pin playlist', icon: 'pin', run: () => store.updatePlaylist(p.id, { pinned: !p.pinned }) },
      { label: 'Move to folder', icon: 'folder-input', sub: () => folderItems(p) },
      '-',
      { label: 'Delete', icon: 'trash-2', danger: true, run: async () => {
        if (await confirmDialog('Delete playlist?', `"${p.name}" will be deleted. The songs stay in your library.`)) {
          await store.deletePlaylist(p.id);
          if (location.hash === `#/playlist/${p.id}`) go('#/');
          toast('Playlist deleted');
        }
      } }];
    items = tidy(items);
  } else if (c.type === 'album' || c.type === 'artist') {
    items = [...queueItems, { label: 'Add to playlist', icon: 'list-plus', sub: () => addToPlaylistItems(ids()) }, libraryItem(c), '-',
      { label: c.type === 'album' ? 'Edit album' : `Edit all songs by this artist`, icon: 'pencil', run: () => bulkEdit(ids()) }];
    if (c.type === 'album') {
      const a = store.albums().get(c.id);
      if (a) items.push({ label: 'Go to artist', icon: 'user-round', run: () => go(`#/artist/${encodeURIComponent(store.artistKey(a.artist))}`) });
    }
  } else if (c.type === 'folder') {
    const f = L.folders.get(c.id);
    items = [
      { label: 'Rename', icon: 'pencil', run: async () => { const n = await promptDialog('Rename folder', f.name); if (n) store.renameFolder(f.id, n); } },
      { label: 'Delete folder', icon: 'trash-2', danger: true, run: async () => {
        if (await confirmDialog('Delete folder?', `"${f.name}" will be deleted. Its playlists are kept.`)) { await store.deleteFolder(f.id); if (location.hash === `#/folder/${f.id}`) go('#/'); }
      } },
    ];
  } else {
    const ownList = c.type === 'liked' || c.type === 'songs';
    items = tidy([...queueItems, { label: 'Add to playlist', icon: 'list-plus', sub: () => addToPlaylistItems(ids()) },
      ownList && isTouch() && ids().length > 1 && { label: 'Reorder songs', icon: 'grip-vertical', run: () => { go(store.contextHref(c)); setTimeout(() => acts['reorder-start'](c.type), 50); } },
      ownList && libraryItem(c)]);
  }
  const info = itemInfo(c);
  openMenu(items, at, info && { title: info.name, sub: info.sub, cover: coverHtml(info.covers, { liked: info.liked, icon: info.icon, cls: 'sm' }) });
}

/** "Remove from Your Library" (hides it from the list; nothing is deleted) / "Add to Your Library". */
function libraryItem(c) {
  const hidden = store.isHiddenInLibrary(c);
  if (hidden) return { label: 'Add to Your Library', icon: 'circle-plus', run: () => { store.setHiddenInLibrary(c, false); toast('Added to Your Library'); } };
  return { label: 'Remove from Your Library', icon: 'circle-minus', run: () => {
    store.setHiddenInLibrary(c, true);
    toast('Removed from Your Library', { label: 'Undo', run: () => store.setHiddenInLibrary(c, false) });
  } };
}

/** Play a whole context (big play buttons), or pause/resume if it is already playing. */
export function playCtx(c) {
  const q = player.queue;
  if (q.context && q.context.type === c.type && (q.context.id ?? null) === (c.id ?? null) && player.engine.song) return player.toggle();
  const ids = store.contextSongIds(c);
  if (!ids.length) return toast('Nothing to play here yet');
  player.playContext(c, ids, q.shuffle ? -1 : 0);
}
export const isCtxPlaying = (c) => {
  const q = player.queue.context;
  return !!q && q.type === c.type && (q.id ?? null) === (c.id ?? null) && !player.engine.paused;
};

// ---------- multi-select bar ----------
export const selectionBar = {
  list: null,
  update(list) {
    const el = $('#selbar');
    const show = list.sel.size > 0 && (list.selectMode || list.sel.size > 1);
    if (!show) { if (this.list === list) this.hide(); return; }
    this.list = list;
    el.hidden = false;
    el.innerHTML = `<button class="icon-btn" data-act="sel-clear" aria-label="Clear selection">${ic('x')}</button><span class="sel-n">${list.sel.size} selected</span>
      <button class="icon-btn" data-act="sel-add" aria-label="Add to playlist" title="Add to playlist">${ic('list-plus')}</button>
      <button class="icon-btn" data-act="sel-queue" aria-label="Add to queue" title="Add to queue">${ic('list-music')}</button>
      <button class="icon-btn" data-act="sel-like" aria-label="Save to Liked Songs" title="Save to Liked Songs">${ic('heart')}</button>
      <button class="icon-btn" data-act="sel-edit" aria-label="Edit" title="Edit">${ic('pencil')}</button>
      <button class="icon-btn" data-act="sel-more" aria-label="More" title="More">${ic('ellipsis')}</button>`;
  },
  hide() { $('#selbar').hidden = true; this.list = null; },
};
const selIds = () => selectionBar.list?.selectedIds() || [];
Object.assign(acts, {
  'sel-clear': () => selectionBar.list?.clearSelection(),
  'sel-add': (el) => openMenu(addToPlaylistItems(selIds()), el, { title: `${selIds().length} songs selected` }),
  'sel-queue': () => { player.addToQueue(selIds()); toast(`Added ${selIds().length} songs to queue`); selectionBar.list?.clearSelection(); },
  'sel-like': () => { store.setLiked(selIds(), true); toast('Added to Liked Songs'); selectionBar.list?.clearSelection(); },
  'sel-edit': () => { const ids = selIds(); ids.length > 1 ? bulkEdit(ids) : editSong(ids[0]); },
  'sel-more': (el) => songMenu(selIds(), el, { playlistId: selectionBar.list?.o.playlistId }),
  'play-ctx': (el, e) => { e.preventDefault(); playCtx(parseCtx(el.dataset.ctx)); },
  'ctx-menu': (el, e) => { e.preventDefault(); ctxMenu(parseCtx(el.dataset.ctx), el); },
  'shuffle': () => player.setShuffle(!player.queue.shuffle),
  'new-playlist': async () => { const p = await store.createPlaylist(); go(hrefOf({ type: 'playlist', id: p.id })); },
  'new-folder': async () => { const n = await promptDialog('New folder', 'New Folder', 'Create'); if (n) store.createFolder(n); },
});
// Right-click on cards and library rows opens their menu.
document.addEventListener('contextmenu', (e) => {
  const t = e.target.closest('[data-menu-ctx]');
  if (!t || e.target.closest('.tl-body')) return;
  e.preventDefault();
  ctxMenu(parseCtx(t.dataset.menuCtx), { x: e.clientX, y: e.clientY });
});
export { ctxAttr };
