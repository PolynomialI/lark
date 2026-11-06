// Edits (names, covers, lyrics, bulk edits, playlists, folders, likes) are saved and survive a reload.
import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { basic, FIX } from './fixtures.mjs';
import { expect, importDir, openApp, snapshot } from './helpers.mjs';

const row = (page, title) => page.locator('.tl-body .tr', { has: page.locator('.t', { hasText: title }) });
async function dragTo(page, from, to, dy = 0) {
  const a = await from.boundingBox(), b = await to.boundingBox();
  await page.mouse.move(a.x + 60, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 80, a.y + a.height / 2 + 10, { steps: 4 });
  await page.mouse.move(b.x + 60, b.y + dy, { steps: 12 });
  await page.mouse.up();
}

test('edits to songs, covers, playlists, folders and likes survive a reload', async ({ page }) => {
  await openApp(page);
  await importDir(page, basic());
  await page.goto('/#/songs');

  // Edit a song: title, artist, lyrics and a new cover (uploaded and cropped).
  await row(page, 'Red Song').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Edit details' }).click();
  await page.fill('.dialog [name=title]', 'Red Song (Live)');
  await page.fill('.dialog [name=artist]', 'Crimson Band');
  await page.fill('.dialog [name=lyrics]', '[00:01.00]Hello\n[00:02.00]World');
  await page.setInputFiles('.dialog .cover-field input[type=file]', join(FIX, 'cover-3366cc.jpg'));
  await page.locator('.crop-dialog').getByRole('button', { name: 'Use image' }).click();
  await expect(page.locator('.crop-dialog')).toHaveCount(0);
  await page.locator('.dialog').getByRole('button', { name: 'Save' }).click();
  await expect(row(page, 'Red Song (Live)')).toHaveCount(1);

  // Like a song with the heart.
  await row(page, 'Evening Glow').hover();
  await row(page, 'Evening Glow').locator('[data-like]').click();

  // Bulk edit: select two songs (click + Ctrl-click), set their album.
  await row(page, 'Morning Light').click();
  await row(page, 'Untagged Title').click({ modifiers: ['Control'] });
  await row(page, 'Untagged Title').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Edit 2 songs' }).click();
  await page.fill('.dialog [name=album]', 'Compilation');
  await page.locator('.dialog').getByRole('button', { name: 'Save' }).click();

  // New playlist from the library "+" menu; rename it and add a description.
  await page.click('#side-lib [data-act="lib-add"]');
  await page.locator('.menu-item', { hasText: 'Create playlist' }).click();
  await expect(page.locator('.ph-title')).toHaveText('My Playlist #1');
  await page.click('.ph-title');
  await page.fill('.dialog [name=name]', 'Gym');
  await page.fill('.dialog [name=description]', 'Heavy lifting');
  await page.locator('.dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.ph-title')).toHaveText('Gym');

  // Add songs: from a song's menu, and by dragging onto the playlist in the sidebar.
  await page.goto('/#/songs');
  await row(page, 'Red Song (Live)').locator('[data-more]').click({ force: true });
  await page.locator('.menu-item', { hasText: 'Add to playlist' }).click();
  await page.locator('.menu-item', { hasText: 'Gym' }).click();
  await dragTo(page, row(page, 'Morning Light'), page.locator('#side-lib .li', { hasText: 'Gym' }), 20);
  await dragTo(page, row(page, 'Evening Glow'), page.locator('#side-lib .li', { hasText: 'Gym' }), 20);
  await page.locator('#side-lib .li', { hasText: 'Gym' }).click();
  await expect(page.locator('.tl-body .t')).toHaveText(['Red Song (Live)', 'Morning Light', 'Evening Glow']);

  // Reorder by dragging "Evening Glow" to the top (custom order).
  await dragTo(page, row(page, 'Evening Glow'), row(page, 'Red Song (Live)'), 4);
  await expect(page.locator('.tl-body .t')).toHaveText(['Evening Glow', 'Red Song (Live)', 'Morning Light']);

  // Playlist cover, folder, pin, duplicate.
  await page.click('.ph-title');
  await page.setInputFiles('.dialog .cover-field input[type=file]', join(FIX, 'cover-cc3344.jpg'));
  await page.locator('.crop-dialog').getByRole('button', { name: 'Use image' }).click();
  await page.locator('.dialog').getByRole('button', { name: 'Save' }).click();
  await page.click('.ab [data-act="ctx-menu"]');
  await page.locator('.menu-item', { hasText: 'Move to folder' }).click();
  await page.locator('.menu-item', { hasText: 'New folder' }).click();
  await page.fill('.dialog input', 'Workout');
  await page.locator('.dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('#side-lib .li', { hasText: 'Workout' })).toHaveCount(1);
  await page.click('.ab [data-act="ctx-menu"]');
  await page.locator('.menu-item', { hasText: 'Duplicate' }).click();
  await page.locator('#side-lib .li', { hasText: 'Workout' }).click(); // the copy sits in the same folder
  await page.locator('.grid-cards .card', { hasText: 'Gym (copy)' }).click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Pin playlist' }).click();

  const before = await snapshot(page);
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  const after = await snapshot(page);
  expect(after).toEqual(before);

  // Spot-check what was saved.
  const songs = Object.fromEntries(after.songs.map((s) => [s.title, s]));
  expect(songs['Red Song (Live)'].lyrics).toContain('[00:02.00]World');
  expect(songs['Morning Light'].album).toBe('Compilation');
  expect(songs['Untagged Title'].album).toBe('Compilation');
  expect(after.likes.map(([id]) => id)).toContain(songs['Evening Glow'].id);
  const gym = after.playlists.find((p) => p.name === 'Gym');
  expect(gym).toMatchObject({ description: 'Heavy lifting' });
  expect(gym.coverId).toBeTruthy();
  expect(gym.folderId).toBe(after.folders[0].id);
  expect(gym.songs.map((e) => after.songs.find((s) => s.id === e.songId).title)).toEqual(['Evening Glow', 'Red Song (Live)', 'Morning Light']);
  expect(after.playlists.find((p) => p.name === 'Gym (copy)').pinned).toBe(true);
  expect(Object.keys(after.covers)).toContain(songs['Red Song (Live)'].coverId);
  // And in the UI after reload.
  await page.goto(`/#/playlist/${gym.id}`);
  await expect(page.locator('.tl-body .t')).toHaveText(['Evening Glow', 'Red Song (Live)', 'Morning Light']);
  await expect(page.locator('.ph-desc')).toHaveText('Heavy lifting');
});

test('pasting an image sets the cover straight away (no file picker)', async ({ page }) => {
  await openApp(page);
  await importDir(page, basic());
  await page.goto('/#/songs');
  const before = await page.evaluate(() => [...window.__lark.store.lib.songs.values()].find((s) => s.title === 'Red Song').coverId);
  await row(page, 'Red Song').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Edit details' }).click();
  await expect(page.locator('.dialog [name=title]')).toHaveValue('Red Song');
  // Same as Ctrl+V with an image on the clipboard.
  const jpg = readFileSync(join(FIX, 'cover-3366cc.jpg')).toString('base64');
  await page.evaluate((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'pasted.jpg', { type: 'image/jpeg' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, jpg);
  await expect(page.locator('.crop-dialog')).toHaveCount(0);
  await page.locator('.dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.dialog')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  const after = await page.evaluate(() => { const L = window.__lark.store.lib; const s = [...L.songs.values()].find((x) => x.title === 'Red Song'); return { id: s.coverId, exists: L.covers.has(s.coverId), color: L.covers.get(s.coverId)?.color }; });
  expect(after.id).not.toBe(before);
  expect(after.exists).toBe(true);
  expect(after.color).toBe('rgb(42,85,170)'); // the pasted blue image
});

test('albums, artists and All songs can be removed from Your Library, and added back', async ({ page }) => {
  await openApp(page);
  await importDir(page, basic());
  const side = (name) => page.locator('#side-lib .li').filter({ has: page.locator('.li-t', { hasText: new RegExp(`^${name}$`) }) });
  await expect(side('Crimson Band')).toHaveCount(1);
  await side('Crimson Band').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Remove from Your Library' }).click();
  await expect(side('Crimson Band')).toHaveCount(0);
  await side('All songs').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Remove from Your Library' }).click();
  await expect(side('All songs')).toHaveCount(0);
  // Undo brings the last one back.
  await page.locator('#toast .toast-act', { hasText: 'Undo' }).click();
  await expect(side('All songs')).toHaveCount(1);
  // Still removed after a reload; nothing was deleted.
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  await expect(side('Crimson Band')).toHaveCount(0);
  expect(await page.evaluate(() => window.__lark.store.lib.songs.size)).toBe(4);
  // Its page is still there; the ⋯ menu adds it back.
  await page.goto(`/#/artist/${encodeURIComponent('crimson band')}`);
  await expect(page.locator('.ph-title')).toHaveText('Crimson Band');
  await page.click('.ab [data-act="ctx-menu"]');
  await page.locator('.menu-item', { hasText: 'Add to Your Library' }).click();
  await expect(side('Crimson Band')).toHaveCount(1);
});

test('Liked Songs and All songs can be reordered by dragging; the order is kept and used for playback', async ({ page }) => {
  await openApp(page);
  await importDir(page, basic());
  await page.evaluate(async () => {
    const { store } = window.__lark;
    const id = (t) => [...store.lib.songs.values()].find((s) => s.title === t).id;
    for (const t of ['Morning Light', 'Evening Glow', 'Red Song']) await store.setLiked([id(t)], true);
  });
  await page.goto('/#/liked');
  const titles = () => page.locator('.tl-body .t').allTextContents();
  await expect(page.locator('.tl-body .t')).toHaveText(['Red Song', 'Evening Glow', 'Morning Light']); // newest liked first
  await dragTo(page, row(page, 'Morning Light'), row(page, 'Red Song'), 4);
  await expect(page.locator('.tl-body .t')).toHaveText(['Morning Light', 'Red Song', 'Evening Glow']);
  await page.goto('/#/songs');
  await expect(page.locator('.tl-body .tr')).toHaveCount(4);
  const first = (await titles())[0];
  await dragTo(page, row(page, 'Untagged Title'), row(page, first), 4);
  await expect(page.locator('.tl-body .t').first()).toHaveText('Untagged Title');
  const songsOrder = await titles();
  expect(songsOrder[0]).toBe('Untagged Title');

  await page.reload();
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  await page.goto('/#/liked');
  await expect(page.locator('.tl-body .t')).toHaveText(['Morning Light', 'Red Song', 'Evening Glow']);
  // The big play button plays in that order.
  await page.click('.ab .big-play');
  await page.waitForFunction(() => window.__lark.engine.song?.title === 'Morning Light');
  expect(await page.evaluate(() => window.__lark.queue.upcoming().map((id) => window.__lark.store.lib.songs.get(id).title))).toEqual(['Red Song', 'Evening Glow']);
  await page.evaluate(() => window.__lark.player.pause());
  await page.goto('/#/songs');
  await expect(page.locator('.tl-body .t')).toHaveText(songsOrder);

  // Sorted by title: dragging explains how to reorder instead of doing nothing.
  await page.goto('/#/liked');
  await page.click('[data-sort]');
  await page.locator('.menu-item', { hasText: 'Title' }).click();
  await dragTo(page, row(page, 'Red Song'), row(page, 'Evening Glow'), 4);
  await expect(page.locator('#toast')).toContainText('sort by Custom order');
});
