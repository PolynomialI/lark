// Track table (#, title + artist, album, date, length). Only the rows on screen are in the DOM,
// so lists of thousands of songs stay fast. Handles selection, menus, likes and drag & drop.
import * as player from '../player.js';
import * as store from '../store.js';
import { $, clamp, esc, fmtDate, fmtTime, isMobile } from '../util.js';
import { songMenu, selectionBar } from './actions.js';
import { toast } from './common.js';
import { ic } from './icons.js';

export const RH = 56;
const mounted = new Set();
const scroller = () => $('#main');
export function repaintLists() { for (const l of mounted) l.root.isConnected ? l.paint(true) : mounted.delete(l); }
player.player.on('track', repaintLists);
player.player.on('state', repaintLists);
store.events.on('change', (w) => (w === 'likes' || w === 'files') && repaintLists());

export class TrackList {
  /** o: { ids, ctx, dates?: Map, dateLabel?, trackNumbers?, showAlbum = true, reorderable?, onReorder?(ids, to), playlistId? } */
  constructor(host, o) {
    this.o = { showAlbum: true, ...o };
    this.ids = o.ids;
    this.sel = new Set();
    this.anchor = -1;
    this.selectMode = false;
    const cols = `${this.o.showAlbum ? '' : ' no-album'}${this.o.dates ? '' : ' no-date'}${this.o.editing ? ' editing' : ''}`;
    host.innerHTML = `<div class="tl${cols}">
      <div class="tl-head"><div class="c-num">#</div><div class="c-title">Title</div>${this.o.showAlbum ? '<div class="c-album">Album</div>' : ''}${this.o.dates ? `<div class="c-date">${esc(this.o.dateLabel || 'Date added')}</div>` : ''}<div class="c-end">${ic('clock-3')}</div></div>
      <div class="tl-body" style="height:${this.ids.length * RH}px"></div></div>`;
    this.root = host.firstElementChild;
    this.body = this.root.querySelector('.tl-body');
    this.onScroll = () => { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => this.paint()); };
    scroller().addEventListener('scroll', this.onScroll, { passive: true });
    addEventListener('resize', this.onScroll);
    this.bind();
    mounted.add(this);
    requestAnimationFrame(() => this.paint(true));
  }
  destroy() {
    scroller().removeEventListener('scroll', this.onScroll);
    removeEventListener('resize', this.onScroll);
    mounted.delete(this);
    if (selectionBar.list === this) selectionBar.hide();
  }
  setIds(ids, dates) {
    this.ids = ids;
    if (dates) this.o.dates = dates;
    this.sel = new Set([...this.sel].filter((id) => ids.includes(id)));
    this.body.style.height = `${ids.length * RH}px`;
    this.paint(true);
  }

  rowHtml(i) {
    const id = this.ids[i], s = store.lib.songs.get(id);
    if (!s) return '';
    const cur = player.engine.song?.id === id, playing = cur && !player.engine.paused, mobile = isMobile();
    const liked = store.isLiked(id);
    const num = this.o.trackNumbers ? s.track || '–' : i + 1;
    const artist = esc(store.artistOf(s));
    const pending = !store.isAvailable(s);
    return `<div class="tr${this.sel.has(id) ? ' sel' : ''}${cur ? ' cur' : ''}${pending ? ' pending' : ''}" data-i="${i}" style="top:${i * RH}px"${pending ? ' title="Downloading from Google Drive"' : ''}>
      <div class="c-num">${playing ? '<span class="eq-anim"><i></i><i></i><i></i></span>' : `<span class="n">${num}</span>`}<button class="row-play" data-playrow aria-label="${playing ? 'Pause' : 'Play'}">${ic(playing ? 'pause' : 'play')}</button></div>
      <div class="c-title">${s.coverId ? `<img class="thumb" src="${store.coverUrl(s.coverId)}" alt="" decoding="async">` : `<div class="thumb empty">${ic('music')}</div>`}
        <div class="tt"><div class="t">${esc(store.title(s))}</div><div class="s">${pending ? ic('cloud-download', 'pending-ic') : ''}${liked && mobile ? ic('heart', 'mini-like') : ''}${mobile ? artist : `<a href="#/artist/${encodeURIComponent(store.artistKey(s.artist))}">${artist}</a>`}</div></div></div>
      ${this.o.showAlbum ? `<div class="c-album">${s.album ? `<a href="#/album/${encodeURIComponent(store.albumKey(s))}">${esc(s.album)}</a>` : ''}</div>` : ''}
      ${this.o.dates ? `<div class="c-date">${fmtDate(this.o.dates.get(id))}</div>` : ''}
      <div class="c-end"><button class="like${liked ? ' on' : ''}" data-like aria-label="${liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}">${ic('heart')}</button><span class="dur">${fmtTime(s.duration)}</span><button class="more" data-more aria-label="More options">${ic('ellipsis')}</button>${this.o.reorderable ? `<span class="grip" data-grip aria-label="Drag to reorder">${ic('grip-vertical')}</span>` : ''}</div>
    </div>`;
  }
  paint(force) {
    const sc = scroller();
    if (!sc || !this.root.isConnected) return;
    const top = this.body.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    const first = Math.max(0, Math.floor(-top / RH) - 8);
    const last = Math.min(this.ids.length, Math.ceil((sc.clientHeight - top) / RH) + 8);
    if (!force && first === this.first && last === this.last) return;
    this.first = first;
    this.last = last;
    let html = '';
    for (let i = first; i < last; i++) html += this.rowHtml(i);
    this.body.innerHTML = html;
  }

  selectedIds(i) {
    if (i != null && !this.sel.has(this.ids[i])) return [this.ids[i]];
    return this.ids.filter((id) => this.sel.has(id));
  }
  clearSelection() { this.sel.clear(); this.selectMode = false; this.markSelection(); selectionBar.update(this); }
  markSelection() { for (const r of this.body.children) if (r.dataset.i) r.classList.toggle('sel', this.sel.has(this.ids[r.dataset.i])); }
  select(i, e) {
    const id = this.ids[i];
    if (e.shiftKey && this.anchor >= 0) {
      if (!e.ctrlKey && !e.metaKey) this.sel.clear();
      for (let k = Math.min(this.anchor, i); k <= Math.max(this.anchor, i); k++) this.sel.add(this.ids[k]);
    } else if (e.ctrlKey || e.metaKey || this.selectMode) {
      this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id);
      this.anchor = i;
    } else { this.sel.clear(); this.sel.add(id); this.anchor = i; }
    if (this.selectMode && !this.sel.size) this.selectMode = false;
    this.markSelection();
    selectionBar.update(this);
  }
  play(i) {
    const id = this.ids[i];
    if (player.engine.song?.id === id && sameCtx(player.queue.context, this.o.ctx)) return player.toggle();
    player.playContext(this.o.ctx, this.ids, i);
  }

  bind() {
    const b = this.body;
    let lastPointer = 'mouse';
    b.addEventListener('click', (e) => {
      const row = e.target.closest('.tr');
      if (!row || e.target.closest('a')) return;
      const i = +row.dataset.i, id = this.ids[i];
      if (e.target.closest('[data-like]')) return store.toggleLike(id);
      if (e.target.closest('[data-more]')) return songMenu(this.selectedIds(i), e.target.closest('[data-more]'), { playlistId: this.o.playlistId });
      if (e.target.closest('[data-grip]') || this.o.editing) return;
      if (e.target.closest('[data-playrow]')) return this.play(i);
      if (this.selectMode || e.ctrlKey || e.metaKey || e.shiftKey) return this.select(i, e);
      if (lastPointer !== 'mouse' || isMobile()) return this.play(i);
      this.select(i, e);
    });
    b.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.tr');
      if (row && lastPointer === 'mouse' && !e.target.closest('button,a')) this.play(+row.dataset.i);
    });
    b.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.tr');
      if (!row) return;
      e.preventDefault();
      const i = +row.dataset.i;
      if (lastPointer !== 'mouse') { // long-press on a touch screen: start multi-select
        this.selectMode = true;
        this.sel.add(this.ids[i]);
        this.anchor = i;
        navigator.vibrate?.(15);
        this.markSelection();
        return selectionBar.update(this);
      }
      if (!this.sel.has(this.ids[i])) { this.sel.clear(); this.sel.add(this.ids[i]); this.anchor = i; this.markSelection(); selectionBar.update(this); }
      songMenu(this.selectedIds(i), { x: e.clientX, y: e.clientY }, { playlistId: this.o.playlistId });
    });
    b.addEventListener('pointerdown', (e) => {
      lastPointer = e.pointerType;
      const row = e.target.closest('.tr');
      const grip = e.target.closest('[data-grip]');
      if (!row || e.button !== 0) return;
      if (!grip && (e.pointerType !== 'mouse' || e.target.closest('button,a'))) return;
      if (grip) e.preventDefault();
      const i = +row.dataset.i, sx = e.clientX, sy = e.clientY;
      const move = (ev) => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) { done(); this.drag(ev, i); } };
      const done = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', done); removeEventListener('pointercancel', done); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', done);
      addEventListener('pointercancel', done);
    });
  }

  /** Drag songs onto a playlist / Liked Songs in the sidebar, or to a new position (custom-order playlists). */
  drag(e, i) {
    const ids = this.selectedIds(i);
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = ids.length > 1 ? `${ids.length} songs` : store.title(store.lib.songs.get(ids[0]));
    const line = document.createElement('div');
    line.className = 'drop-line';
    line.hidden = true;
    this.body.append(line);
    document.body.append(ghost);
    document.body.classList.add('dragging');
    const sc = scroller();
    let target = null, v = 0, overSelf = false;
    const tick = setInterval(() => { if (v) { sc.scrollTop += v; this.paint(); this.body.append(line); } }, 16);
    const clearHi = () => document.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    const move = (ev) => {
      ghost.style.transform = `translate(${ev.clientX + 14}px,${ev.clientY + 10}px)`;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      clearHi();
      line.hidden = true;
      target = null;
      const pl = el?.closest('[data-drop-playlist]'), lk = el?.closest('[data-drop-liked]');
      overSelf = el?.closest('.tl-body') === this.body;
      if (pl) { target = { pl: pl.dataset.dropPlaylist }; pl.classList.add('drop'); }
      else if (lk) { target = { liked: true }; lk.classList.add('drop'); }
      else if (this.o.reorderable && el?.closest('.tl-body') === this.body) {
        const idx = clamp(Math.round((ev.clientY - this.body.getBoundingClientRect().top) / RH), 0, this.ids.length);
        target = { idx };
        line.style.top = `${idx * RH}px`;
        line.hidden = false;
        if (!line.isConnected) this.body.append(line);
      }
      const r = sc.getBoundingClientRect();
      v = ev.clientY < r.top + 60 ? -12 : ev.clientY > r.bottom - 60 ? 12 : 0;
    };
    const up = async () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      clearInterval(tick);
      clearHi();
      ghost.remove();
      line.remove();
      document.body.classList.remove('dragging');
      if (target?.pl) {
        const p = store.lib.playlists.get(target.pl);
        const n = await store.addToPlaylist(target.pl, ids);
        toast(n ? `Added to ${p.name}` : `Already in ${p.name}`);
      } else if (target?.liked) {
        await store.setLiked(ids, true);
        toast('Added to Liked Songs');
      } else if (target && 'idx' in target) {
        const before = this.ids.slice(0, target.idx).filter((id) => ids.includes(id)).length;
        this.o.onReorder?.(ids, target.idx - before);
      } else if (overSelf && !this.o.reorderable && this.o.reorderHint) toast(this.o.reorderHint);
    };
    move(e);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }
}
export const sameCtx = (a, b) => !!a && !!b && a.type === b.type && (a.id ?? null) === (b.id ?? null);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') for (const l of mounted) if (l.sel.size) l.clearSelection();
});
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.tl-body,.menu,.menu-backdrop,.dialog-wrap,#selbar')) return;
  for (const l of mounted) if (l.sel.size) l.clearSelection();
});
