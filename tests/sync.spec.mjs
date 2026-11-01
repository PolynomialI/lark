// Sync between two devices through (a stand-in for) Google Drive.
import { test } from '@playwright/test';
import { basic } from './fixtures.mjs';
import { FakeDrive } from './fake-drive.mjs';
import { expect, importDir, openApp, snapshot } from './helpers.mjs';

async function device(browser, drive, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', baseURL: 'http://localhost:5173', ...opts });
  await drive.install(ctx);
  await ctx.addInitScript(() => localStorage.setItem('lark-google-client-id', 'test.apps.googleusercontent.com'));
  const page = await ctx.newPage();
  await openApp(page);
  return { ctx, page };
}
const syncState = (page) => page.evaluate(() => window.__lark.sync.status.state);
async function connect(page) {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(page.locator('#sync-box')).toContainText('Connected as me@example.com');
  await expect.poll(() => syncState(page), { timeout: 30000 }).toBe('idle');
}
const syncNow = async (page) => { await page.evaluate(() => window.__lark.sync.run()); expect(await syncState(page)).toBe('idle'); };
/** The parts of the library that sync (device-only settings like volume are left out). */
async function synced(page) {
  const s = await snapshot(page);
  return { songs: s.songs, playlists: s.playlists, folders: s.folders, likes: s.likes, files: s.files, covers: Object.keys(s.covers).sort(), hidden: s.settings.libHidden };
}
const titles = (snap) => snap.songs.map((s) => s.title).sort();

test('two devices stay in sync through Google Drive', async ({ browser }) => {
  test.setTimeout(240000);
  const drive = new FakeDrive();
  const pc = await device(browser, drive);
  const phone = await device(browser, drive, { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  try {
    // Computer: add music, edit, make a playlist, like songs, tidy Your Library; then connect.
    await importDir(pc.page, basic());
    await pc.page.evaluate(async () => {
      const { store } = window.__lark;
      const ids = store.allSongIds();
      const red = [...store.lib.songs.values()].find((s) => s.title === 'Red Song');
      await store.updateSongs([red.id], { title: 'Red Song (Remastered)' });
      const f = await store.createFolder('Mixes');
      await store.createPlaylist({ name: 'Road Trip', songIds: ids.slice(0, 3), folderId: f.id });
      const byTitle = (t) => [...store.lib.songs.values()].find((x) => x.title === t).id;
      await store.setLiked([byTitle('Morning Light'), red.id], true);
      await store.setHiddenInLibrary({ type: 'artist', id: 'crimson band' }, true);
    });
    await connect(pc.page);
    expect(drive.inFolder('library.json')).toHaveLength(1);
    expect(drive.inFolder().filter((f) => f.name.startsWith('audio-'))).toHaveLength(4);
    expect(drive.inFolder().filter((f) => f.name.startsWith('cover-')).length).toBeGreaterThan(0);

    // Phone: empty, connects, and gets everything (including the audio, for offline play).
    await connect(phone.page);
    const a = await synced(pc.page), b = await synced(phone.page);
    expect(b.songs).toEqual(a.songs);
    expect(b.playlists).toEqual(a.playlists);
    expect(b.folders).toEqual(a.folders);
    expect(b.likes).toEqual(a.likes);
    expect(b.files).toEqual(a.files);
    expect(b.covers).toEqual(a.covers);
    expect(b.hidden).toEqual(['artist:crimson band']);
    await phone.page.goto('/#/songs');
    await expect(phone.page.locator('.tl-body .tr.pending')).toHaveCount(0);
    await phone.page.locator('.tl-body .tr').first().tap();
    await phone.page.waitForFunction(() => window.__lark.engine.currentTime > 0.3);

    // Phone: rename the playlist, unlike a song, delete a song → computer picks it all up.
    const gone = await phone.page.evaluate(async () => {
      const { store } = window.__lark;
      const p = [...store.lib.playlists.values()][0];
      await store.updatePlaylist(p.id, { name: 'Road Trip 2026' });
      await store.setLiked([[...store.lib.songs.values()].find((x) => x.title === 'Red Song (Remastered)').id], false);
      const s = [...store.lib.songs.values()].find((x) => x.title === 'Evening Glow');
      await store.deleteSongs([s.id]);
      return s.id;
    });
    await syncNow(phone.page);
    await syncNow(pc.page);
    const a2 = await synced(pc.page);
    expect(a2.playlists[0].name).toBe('Road Trip 2026');
    expect(a2.likes).toHaveLength(1);
    expect(titles(a2)).not.toContain('Evening Glow');
    expect(Object.keys(a2.files).some((n) => n.startsWith(gone))).toBe(false); // the audio is gone from the computer too
    expect(drive.inFolder().some((f) => f.name.startsWith(`audio-${gone}`))).toBe(false); // and moved to the bin in Drive

    // Changes on both devices at once are both kept.
    await pc.page.evaluate(async () => { const { store } = window.__lark; const s = [...store.lib.songs.values()].find((x) => x.title === 'Morning Light'); await store.updateSongs([s.id], { artist: 'The Testers (Live)' }); });
    await phone.page.evaluate(async () => { const { store } = window.__lark; const s = [...store.lib.songs.values()].find((x) => x.title === 'Untagged Title'); await store.setLiked([s.id], true); });
    await syncNow(pc.page);
    await syncNow(phone.page);
    await syncNow(pc.page);
    const a3 = await synced(pc.page), b3 = await synced(phone.page);
    expect(a3.songs).toEqual(b3.songs);
    expect(a3.likes).toEqual(b3.likes);
    expect(a3.songs.find((s) => s.title === 'Morning Light').artist).toBe('The Testers (Live)');
    expect(a3.likes).toHaveLength(2);

    // When the one-hour Google sign-in has run out, Lark asks for one tap, then carries on.
    await pc.page.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('lark'); q.onsuccess = () => r(q.result); }); await new Promise((r) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put({ key: 'syncToken', value: { token: 'fake-old', expiresAt: Date.now() - 1000 } }); t.oncomplete = r; }); });
    await pc.page.reload();
    await pc.page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
    await expect(pc.page.locator('#toast .toast-act', { hasText: 'Sync' })).toBeVisible({ timeout: 10000 });
    await pc.page.locator('#toast .toast-act', { hasText: 'Sync' }).click();
    await expect.poll(() => syncState(pc.page), { timeout: 20000 }).toBe('idle');
  } finally {
    await pc.ctx.close();
    await phone.ctx.close();
  }
});

test('on mobile data, new songs wait for Wi-Fi (shown as downloading) unless you choose to transfer them now', async ({ browser }) => {
  const drive = new FakeDrive();
  const pc = await device(browser, drive);
  const phone = await device(browser, drive, { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  try {
    await importDir(pc.page, basic());
    await connect(pc.page);
    await phone.page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { type: 'cellular' }, configurable: true }));
    await phone.page.reload();
    await phone.page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
    await connect(phone.page);
    await expect(phone.page.locator('#sync-box')).toContainText('4 songs are waiting for Wi-Fi');
    await phone.page.goto('/#/songs');
    await expect(phone.page.locator('.tl-body .tr.pending')).toHaveCount(4);
    await phone.page.locator('.tl-body .tr').first().tap();
    await expect(phone.page.locator('#toast')).toContainText('still downloading from Google Drive');
    await phone.page.goto('/#/settings');
    await phone.page.getByRole('button', { name: 'Transfer them now' }).click();
    await expect.poll(() => phone.page.evaluate(() => [...window.__lark.store.lib.songs.values()].filter((s) => window.__lark.store.isAvailable(s)).length), { timeout: 20000 }).toBe(4);
    await phone.page.goto('/#/songs');
    await expect(phone.page.locator('.tl-body .tr.pending')).toHaveCount(0);
  } finally {
    await pc.ctx.close();
    await phone.ctx.close();
  }
});
