// Edit dialogs: song details, bulk edit, playlist details, cover upload/crop, reuse an existing cover.
import { dominantColor, makeCoverBlob } from '../color.js';
import * as store from '../store.js';
import { esc, isTouch } from '../util.js';
import { coverHtml, openDialog, toast } from './common.js';
import { ic } from './icons.js';

// ---------- cover field (preview + upload / choose existing / remove) ----------
function coverField(previewIds, { keep = false, removeLabel = 'Remove' } = {}) {
  const state = { value: undefined }; // undefined = unchanged, null = removed, string = cover id
  const html = `<div class="cover-field"><div class="cf-preview">${coverHtml(previewIds, { cls: 'lg' })}</div>
    <div class="cf-btns"><label class="btn small">${ic('upload')}<span>Upload image</span><input type="file" accept="image/*" hidden></label>
    <button type="button" class="btn small" data-cf="paste">${ic('clipboard-paste')}<span>Paste image</span></button>
    <button type="button" class="btn small" data-cf="pick">${ic('image')}<span>Use another cover</span></button>
    <button type="button" class="btn small" data-cf="remove">${ic('trash-2')}<span>${removeLabel}</span></button>
    ${isTouch() ? '' : '<div class="cf-note">Or copy an image and press Ctrl+V.</div>'}
    ${keep ? '<div class="cf-note">Leave unchanged to keep each song\'s cover.</div>' : ''}</div></div>`;
  const mount = (root, fallback = () => []) => {
    const prev = root.querySelector('.cf-preview');
    const show = () => { prev.innerHTML = coverHtml(state.value ? [state.value] : state.value === null ? fallback() : previewIds, { cls: 'lg' }); };
    root.querySelector('.cover-field input[type=file]').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const id = await cropImage(f);
      if (id) { state.value = id; show(); }
    };
    root.querySelector('[data-cf=pick]').onclick = async () => { const id = await pickCover(); if (id) { state.value = id; show(); } };
    // Paste: the image is square-cropped from the centre and used straight away.
    const useImage = (blob) => (state.pending = (async () => {
      try {
        const made = await makeCoverBlob(blob);
        const id = await store.addCover(made.blob);
        await store.setCoverColor(id, made.color);
        state.value = id;
        show();
      } catch { toast("That image can't be used"); }
    })());
    root.querySelector('[data-cf=paste]').onclick = async () => {
      if (!navigator.clipboard?.read) return toast('Copy an image, then press Ctrl+V here');
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) return useImage(await item.getType(type));
        }
        toast('No image on the clipboard. Copy an image first.');
      } catch { toast('Allow clipboard access to paste images'); }
    };
    const onPaste = (e) => {
      if (!root.isConnected) return document.removeEventListener('paste', onPaste);
      const open = document.querySelectorAll('.dialog-wrap');
      if (open[open.length - 1] !== root) return; // only the dialog on top
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (!file) return; // plain text pastes into the fields as usual
      e.preventDefault();
      useImage(file);
    };
    document.addEventListener('paste', onPaste);
    root.querySelector('[data-cf=remove]').onclick = () => { state.value = null; show(); };
  };
  return { html, mount, state };
}

export function editSong(id) {
  const s = store.lib.songs.get(id);
  if (!s) return;
  const cf = coverField(s.coverId ? [s.coverId] : []);
  openDialog({
    title: 'Edit details', cls: 'wide',
    body: `<div class="edit-grid">${cf.html}<div class="fields">
      <label>Title<input class="input" name="title" value="${esc(s.title)}"></label>
      <label>Artist<input class="input" name="artist" value="${esc(s.artist)}"></label>
      <label>Album<input class="input" name="album" value="${esc(s.album)}"></label></div></div>
      <label class="lyrics-field">Lyrics <span class="hint">Plain text, or synced lines like [01:23.45] …</span><textarea class="input" name="lyrics" rows="8">${esc(s.lyrics)}</textarea></label>`,
    onMount: (r) => cf.mount(r),
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, run: async (r) => {
      const v = (n) => r.querySelector(`[name=${n}]`).value.trim();
      const patch = { title: v('title') || s.name, artist: v('artist'), album: v('album'), lyrics: r.querySelector('[name=lyrics]').value };
      await cf.state.pending; // a pasted image still being processed
      if (cf.state.value !== undefined) patch.coverId = cf.state.value;
      await store.updateSongs([id], patch);
      toast('Saved');
    } }],
  });
}

export function bulkEdit(ids) {
  const songs = ids.map((id) => store.lib.songs.get(id)).filter(Boolean);
  const same = (k) => (songs.every((s) => s[k] === songs[0][k]) ? songs[0][k] : '');
  const covers = [...new Set(songs.map((s) => s.coverId).filter(Boolean))];
  const cf = coverField(covers.length === 1 ? [covers[0]] : [], { keep: true });
  openDialog({
    title: `Edit ${songs.length} songs`, cls: 'wide',
    body: `<div class="edit-grid">${cf.html}<div class="fields">
      <p class="hint">Fields you leave empty are not changed.</p>
      <label>Artist<input class="input" name="artist" value="${esc(same('artist'))}" placeholder="Keep existing"></label>
      <label>Album<input class="input" name="album" value="${esc(same('album'))}" placeholder="Keep existing"></label>
      <label>Album artist<input class="input" name="albumArtist" value="${esc(same('albumArtist'))}" placeholder="Keep existing"></label></div></div>`,
    onMount: (r) => cf.mount(r),
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, run: async (r) => {
      const patch = {};
      for (const k of ['artist', 'album', 'albumArtist']) { const v = r.querySelector(`[name=${k}]`).value.trim(); if (v) patch[k] = v; }
      await cf.state.pending; // a pasted image still being processed
      if (cf.state.value !== undefined) patch.coverId = cf.state.value;
      await store.updateSongs(songs.map((s) => s.id), patch);
      toast(`Updated ${songs.length} songs`);
    } }],
  });
}

export function editPlaylist(id) {
  const p = store.lib.playlists.get(id);
  if (!p) return;
  const auto = () => store.mosaic(p.songs.map((e) => e.songId));
  const cf = coverField(store.playlistCovers(p), { removeLabel: 'Use song covers' });
  openDialog({
    title: 'Edit details', cls: 'wide',
    body: `<div class="edit-grid">${cf.html}<div class="fields">
      <label>Name<input class="input" name="name" value="${esc(p.name)}" maxlength="100"></label>
      <label>Description<textarea class="input" name="description" rows="4" placeholder="Add an optional description">${esc(p.description)}</textarea></label></div></div>`,
    onMount: (r) => cf.mount(r, auto),
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, run: async (r) => {
      const patch = { name: r.querySelector('[name=name]').value.trim() || p.name, description: r.querySelector('[name=description]').value.trim() };
      await cf.state.pending; // a pasted image still being processed
      if (cf.state.value !== undefined) patch.coverId = cf.state.value;
      await store.updatePlaylist(id, patch);
    } }],
  });
}

/** Square-crop an image: drag to move, slider/wheel to zoom. Resolves to a stored cover id (or null). */
export function cropImage(file) {
  return new Promise((resolve) => {
    let result = null;
    const url = URL.createObjectURL(file);
    const d = openDialog({
      title: 'Crop cover', cls: 'crop-dialog',
      body: `<div class="crop-view"><img src="${url}" alt="" draggable="false"></div><label class="crop-zoom">${ic('search')}<input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Use image', primary: true, run: async () => { result = await crop(); } }],
    });
    const view = d.root.querySelector('.crop-view'), img = view.querySelector('img'), zoom = d.root.querySelector('input[type=range]');
    let base = 1, z = 1, ox = 0, oy = 0;
    const V = () => view.clientWidth;
    const clampPos = () => {
      const w = img.naturalWidth * base * z, h = img.naturalHeight * base * z;
      ox = Math.min(0, Math.max(V() - w, ox));
      oy = Math.min(0, Math.max(V() - h, oy));
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      img.style.transform = `translate(${ox}px,${oy}px)`;
    };
    const setZoom = (nz, cx = V() / 2, cy = V() / 2) => {
      const k = nz / z;
      ox = cx - (cx - ox) * k;
      oy = cy - (cy - oy) * k;
      z = nz;
      zoom.value = z;
      clampPos();
    };
    img.onload = () => {
      base = Math.max(V() / img.naturalWidth, V() / img.naturalHeight);
      ox = (V() - img.naturalWidth * base) / 2;
      oy = (V() - img.naturalHeight * base) / 2;
      clampPos();
    };
    zoom.oninput = () => setZoom(+zoom.value);
    view.addEventListener('wheel', (e) => { e.preventDefault(); const r = view.getBoundingClientRect(); setZoom(Math.min(4, Math.max(1, z * (e.deltaY < 0 ? 1.1 : 0.9))), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    view.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      view.setPointerCapture(e.pointerId);
      const sx = e.clientX - ox, sy = e.clientY - oy;
      const mv = (ev) => { ox = ev.clientX - sx; oy = ev.clientY - sy; clampPos(); };
      view.addEventListener('pointermove', mv);
      view.addEventListener('pointerup', () => view.removeEventListener('pointermove', mv), { once: true });
    });
    async function crop() {
      const k = base * z, side = V() / k;
      const c = document.createElement('canvas');
      c.width = c.height = Math.round(Math.min(640, side));
      c.getContext('2d').drawImage(img, -ox / k, -oy / k, side, side, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
      const id = await store.addCover(blob);
      await store.setCoverColor(id, dominantColor(c));
      return id;
    }
    const obs = new MutationObserver(() => { if (!d.root.isConnected) { obs.disconnect(); URL.revokeObjectURL(url); resolve(result); } });
    obs.observe(document.body, { childList: true });
  });
}

/** Pick one of the covers already in the library. */
export function pickCover() {
  return new Promise((resolve) => {
    let result = null;
    const ids = [...store.lib.covers.keys()];
    const d = openDialog({
      title: 'Use another cover', cls: 'wide',
      body: ids.length ? `<div class="cover-grid">${ids.map((id) => `<button type="button" class="cover-pick" data-id="${id}"><img src="${store.coverUrl(id)}" alt="" loading="lazy"></button>`).join('')}</div>` : '<p>No covers in your library yet.</p>',
      actions: [{ label: 'Cancel' }],
    });
    d.root.querySelector('.cover-grid')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (b) { result = b.dataset.id; d.close(); }
    });
    const obs = new MutationObserver(() => { if (!d.root.isConnected) { obs.disconnect(); resolve(result); } });
    obs.observe(document.body, { childList: true });
  });
}
