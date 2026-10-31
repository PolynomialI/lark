// Edits (names, covers, lyrics, bulk edits, playlists, folders, likes) are saved and survive a reload.
import { test } from '@playwright/test';
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
