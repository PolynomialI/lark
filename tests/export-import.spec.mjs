// Export → clear all storage → import gives back exactly the same library.
import { test } from '@playwright/test';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { basic, big, FIX } from './fixtures.mjs';
import { clearAllStorage, expect, importDir, openApp, snapshot, waitForServiceWorker } from './helpers.mjs';

async function exportZip(page, out) {
  await page.goto('/#/settings');
  const dl = page.waitForEvent('download', { timeout: 600000 });
  await page.click('[data-act="export-library"]');
  const d = await dl;
  await d.saveAs(out);
  await expect(page.locator('.xp-text')).toContainText('Done', { timeout: 600000 });
  return out;
}
async function importZip(page, file, mode) {
  await page.goto('/#/settings');
  const chooser = page.waitForEvent('filechooser');
  await page.click('[data-act="import-library"]');
  await (await chooser).setFiles(file);
  await page.getByRole('button', { name: mode === 'replace' ? 'Replace' : 'Merge' }).click();
  await page.waitForEvent('load', { timeout: 600000 });
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
}

test('export, wipe, import (replace) restores the exact library; merge adds no duplicates', async ({ page }) => {
  await openApp(page);
  await waitForServiceWorker(page);
  await importDir(page, basic());
  // Make edits, playlists, likes, a custom cover and history so all of them must survive.
  await page.evaluate(async () => {
    const { store, player } = window.__lark;
    const ids = store.allSongIds();
    await store.updateSongs([ids[0]], { title: 'Renamed Song', artist: 'Renamed Artist' });
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    c.getContext('2d').fillRect(0, 0, 32, 32);
    const cover = await store.addCover(await new Promise((r) => c.toBlob(r, 'image/jpeg')));
    const f = await store.createFolder('Mixes');
    const p = await store.createPlaylist({ name: 'Road Trip', songIds: [ids[2], ids[0], ids[1]], description: 'Long drives', coverId: cover, folderId: f.id });
    await store.updatePlaylist(p.id, { pinned: true });
    await store.createPlaylist({ name: 'Second', songIds: [ids[3]] });
    await store.setLiked([ids[1], ids[3]], true);
    await store.setSettings({ crossfade: 3 });
    await player.playContext({ type: 'playlist', id: p.id }, store.contextSongIds({ type: 'playlist', id: p.id }), 0);
    player.pause();
  });
  const before = await snapshot(page);
  expect(before.songs).toHaveLength(4);

  mkdirSync(join(FIX, 'out'), { recursive: true });
  const zip = await exportZip(page, join(FIX, 'out', 'basic-export.zip'));
  expect(statSync(zip).size).toBeGreaterThan(20000);

  await clearAllStorage(page);
  await openApp(page);
  const empty = await snapshot(page);
  expect(empty.songs).toHaveLength(0);
  expect(Object.keys(empty.files)).toHaveLength(0);

  await importZip(page, zip, 'replace');
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('#side-lib')).toContainText('Mixes');

  // Merge the same export again: nothing is duplicated.
  await importZip(page, zip, 'merge');
  const merged = await snapshot(page);
  expect(merged.songs).toEqual(before.songs);
  expect(merged.playlists.map((p) => p.id)).toEqual(before.playlists.map((p) => p.id));
});

test('a library over 1 GB exports and imports back exactly', async ({ browser }, testInfo) => {
  testInfo.setTimeout(1500000);
  // Real on-disk storage (a persistent profile), so the test doesn't run out of in-memory quota.
  const { chromium } = await import('@playwright/test');
  const profile = join(FIX, 'profile-big');
  const ctx = await chromium.launchPersistentContext(profile, { baseURL: 'http://localhost:5173', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    await openApp(page);
    await clearAllStorage(page);
    await openApp(page);
    await waitForServiceWorker(page);
    const st = await importDir(page, big(1100));
    expect(st.failed).toBe(0);
    await page.evaluate(async () => {
      const { store } = window.__lark;
      await store.createPlaylist({ name: 'Big One', songIds: store.allSongIds().slice(0, 5) });
      await store.setLiked(store.allSongIds().slice(0, 2), true);
    });
    const before = await snapshot(page);
    const bytes = before.songs.reduce((a, s) => a + s.size, 0);
    expect(bytes).toBeGreaterThan(1024 ** 3);
    mkdirSync(join(FIX, 'out'), { recursive: true });
    const zip = await exportZip(page, join(FIX, 'out', 'big-export.zip'));
    expect(statSync(zip).size).toBeGreaterThan(1024 ** 3);
    await clearAllStorage(page);
    await openApp(page);
    expect((await snapshot(page)).songs).toHaveLength(0);
    await importZip(page, zip, 'replace');
    expect(await snapshot(page)).toEqual(before);
  } finally {
    await clearAllStorage(page).catch(() => {});
    await ctx.close();
  }
});
