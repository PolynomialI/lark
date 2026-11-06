// Lark open in two windows at once (e.g. the installed app and a browser tab) on the same device.
import { test } from '@playwright/test';
import { basic } from './fixtures.mjs';
import { FakeDrive } from './fake-drive.mjs';
import { expect, importDir, openApp } from './helpers.mjs';

test('changes made in one window are kept, and show up in the other window', async ({ context }) => {
  const one = await context.newPage();
  await openApp(one);
  await importDir(one, basic());
  const pid = await one.evaluate(async () => {
    const { store } = window.__lark;
    const ids = store.allSongIds();
    for (const id of ids.slice(0, 3)) await store.setLiked([id], true);
    return (await store.createPlaylist({ name: 'P', songIds: ids })).id;
  });
  const two = await context.newPage();
  await openApp(two);
  const liked = (p) => p.evaluate(() => window.__lark.store.likedSongIds());
  const playlist = (p) => p.evaluate((id) => window.__lark.store.lib.playlists.get(id).songs.map((e) => e.songId), pid);

  // Window 1 reorders Liked Songs and the playlist; window 2 changes the volume and plays from the playlist.
  await one.evaluate(async (id) => {
    const { store } = window.__lark;
    await store.reorderList('liked', [store.likedSongIds()[2]], 0);
    await store.reorderPlaylist(id, [store.lib.playlists.get(id).songs[3].songId], 0);
  }, pid);
  const wantLiked = await liked(one), wantPlaylist = await playlist(one);
  await expect.poll(() => liked(two)).toEqual(wantLiked);           // window 2 picks it up by itself
  await expect.poll(() => playlist(two)).toEqual(wantPlaylist);
  await two.evaluate(async (id) => {
    const { store, player } = window.__lark;
    await store.setSettings({ volume: 0.5 });
    await player.playContext({ type: 'playlist', id }, store.contextSongIds({ type: 'playlist', id }), 0);
    player.pause();
  }, pid);
  await two.waitForTimeout(300);

  // Close both windows, open Lark again: everything is still there.
  await one.close();
  await two.close();
  const again = await context.newPage();
  await openApp(again);
  expect(await liked(again)).toEqual(wantLiked);
  expect(await playlist(again)).toEqual(wantPlaylist);
  expect(await again.evaluate(() => window.__lark.store.lib.settings.volume)).toBe(0.5);
});

test('syncing from two windows at once runs one sync at a time (nothing duplicated in Drive)', async ({ browser }) => {
  const drive = new FakeDrive();
  const context = await browser.newContext({ serviceWorkers: 'block', baseURL: 'http://localhost:5173' });
  await drive.install(context);
  await context.addInitScript(() => localStorage.setItem('lark-google-client-id', 'test.apps.googleusercontent.com'));
  try {
    const one = await context.newPage();
    await openApp(one);
    await importDir(one, basic());
    await one.goto('/#/settings');
    await one.getByRole('button', { name: 'Connect Google Drive' }).click();
    await expect.poll(() => one.evaluate(() => window.__lark.sync.status.state), { timeout: 30000 }).toBe('idle');
    const two = await context.newPage();
    await openApp(two);
    await one.evaluate(async () => { const { store } = window.__lark; await store.reorderList('songs', [store.allSongIds()[3]], 0); });
    await Promise.all([one.evaluate(() => window.__lark.sync.run()), two.evaluate(() => window.__lark.sync.run())]);
    expect(drive.inFolder('library.json')).toHaveLength(1);
    expect(drive.inFolder().filter((f) => f.name.startsWith('audio-'))).toHaveLength(4);
    const saved = JSON.parse(drive.content('library.json').toString());
    expect(saved.orders.songs.list[0]).toBe(await one.evaluate(() => window.__lark.store.allSongIds()[0]));
  } finally {
    await context.close();
  }
});
