// Adding music: tags, covers, lyrics (embedded + .lrc), file-name fallback, duplicates, big batches.
import { test } from '@playwright/test';
import { basic, bulk } from './fixtures.mjs';
import { expect, filesIn, importDir, openApp } from './helpers.mjs';

test('tagged and untagged MP3s import with tags, covers and lyrics; duplicates are skipped', async ({ page }) => {
  await openApp(page);
  const st = await importDir(page, basic());
  expect(st).toMatchObject({ total: 5, added: 4, duplicate: 1, failed: 0 });
  const songs = await page.evaluate(() => [...window.__lark.store.lib.songs.values()]);
  const by = Object.fromEntries(songs.map((s) => [s.title, s]));
  expect(by['Morning Light']).toMatchObject({ artist: 'The Testers', album: 'Blue Album', track: 1, year: 2021, genre: 'Pop' });
  expect(by['Morning Light'].duration).toBeGreaterThan(5.9);
  expect(by['Morning Light'].lyrics).toBe('First line of the song\nSecond line of the song');
  expect(by['Morning Light'].coverId).toBeTruthy();
  expect(by['Evening Glow'].coverId).toBe(by['Morning Light'].coverId); // same artwork stored once
  expect(by['Red Song'].coverId).not.toBe(by['Morning Light'].coverId);
  // No tags: artist and title come from "Artist - Title.mp3"; synced lyrics from the matching .lrc file.
  expect(by['Untagged Title']).toMatchObject({ artist: 'Untagged Artist', album: '', coverId: null });
  expect(by['Untagged Title'].lyrics).toContain('[00:02.00]Synced line two');

  // Adding the same files again adds nothing.
  expect(await importDir(page, basic())).toMatchObject({ added: 0, duplicate: 5 });

  // Album page built from tags, with the cover.
  await page.locator('#side-lib .li', { hasText: 'Blue Album' }).click();
  await expect(page.locator('.ph-title')).toHaveText('Blue Album');
  await expect(page.locator('.tl-body .tr')).toHaveCount(2);
  await expect(page.locator('.ph-art img')).toHaveCount(1);

  // Synced lyrics are highlighted in time; plain lyrics are shown as text.
  await page.evaluate(() => { const { store, player } = window.__lark; const s = [...store.lib.songs.values()].find((x) => x.title === 'Untagged Title'); player.playContext({ type: 'songs' }, [s.id], 0); });
  await page.goto('/#/lyrics');
  await expect(page.locator('.lyr.synced p.active')).toHaveText('Synced line two', { timeout: 8000 });
  await page.evaluate(() => { const { store, player } = window.__lark; const s = [...store.lib.songs.values()].find((x) => x.title === 'Morning Light'); player.playContext({ type: 'songs' }, [s.id], 0); });
  await expect(page.locator('.lyr.plain')).toContainText('Second line of the song');
});

test('1,000 files import in the background with progress, without freezing the app', async ({ page }) => {
  const dir = bulk(1000);
  await openApp(page);
  // Watch the main thread: record the longest gap between 20 ms timer ticks during the import.
  await page.evaluate(() => {
    window.__gaps = { max: 0, last: performance.now() };
    window.__tick = setInterval(() => { const n = performance.now(); window.__gaps.max = Math.max(window.__gaps.max, n - window.__gaps.last); window.__gaps.last = n; }, 20);
  });
  await page.setInputFiles('#file-input', filesIn(dir));
  // Progress is visible while it runs, and the app stays usable (navigation works).
  await expect(page.locator('#import-card .ic-count')).toHaveText(/^([1-9]\d{0,2}) of 1000$/, { timeout: 30000 });
  await page.click('.nav a[data-nav="search"]');
  await expect(page.locator('#search-input')).toBeVisible({ timeout: 1000 });
  await page.fill('#search-input', 'Song 5');
  await page.waitForFunction(() => !window.__lark.importer.state.active, null, { timeout: 170000 });
  const st = await page.evaluate(() => ({ ...window.__lark.importer.state, gap: window.__gaps.max, songs: window.__lark.store.lib.songs.size }));
  console.log(`1000-file import: longest main-thread pause ${Math.round(st.gap)} ms`);
  expect(st).toMatchObject({ total: 1000, added: 1000, failed: 0, songs: 1000 });
  expect(st.gap).toBeLessThan(300);
  await expect(page.locator('#import-card')).toContainText('1000 of 1000');
  // Long lists only draw the rows on screen.
  await page.goto('/#/songs');
  await expect(page.locator('.ph-meta')).toContainText('1000 songs');
  expect(await page.locator('.tl-body .tr').count()).toBeLessThan(60);
});
