// Screenshots at desktop and phone sizes → docs/screenshots/.
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { showcase } from './fixtures.mjs';
import { importDir, openApp } from './helpers.mjs';

const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

async function setup(page) {
  await openApp(page);
  await importDir(page, showcase());
  await page.addStyleTag({ content: '#import-card { display: none !important; }' });
  return page.evaluate(async () => {
    const { store, player } = window.__lark;
    const albums = [...store.albums().values()];
    const pick = (k) => albums.map((a) => a.songIds[k % a.songIds.length]);
    const road = await store.createPlaylist({ name: 'Night Drive', description: 'Synths and city lights for the long way home.', songIds: [...pick(0), ...pick(2), ...pick(1)] });
    await store.createPlaylist({ name: 'Focus', songIds: [...pick(3), ...pick(1)] });
    await store.createPlaylist({ name: 'Sunday Morning', songIds: pick(2) });
    await store.setLiked([...pick(1), ...pick(3)].slice(0, 9), true);
    for (const a of albums.slice(0, 4)) await store.addHistory(a.songIds[0], { type: 'album', id: a.key });
    await store.addHistory(road.songs[0].songId, { type: 'playlist', id: road.id });
    await store.setSettings({ volume: 0.7 });
    const ids = store.contextSongIds({ type: 'playlist', id: road.id });
    await player.playContext({ type: 'playlist', id: road.id }, ids, ids.findIndex((id) => store.lib.songs.get(id).title === 'Harbor Lights'));
    player.addToQueue([pick(3)[2], pick(0)[5]]);
    player.seek(9);
    return { road: road.id, album: albums[0].key };
  });
}
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });

test('desktop screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { road, album } = await setup(page);
  await page.waitForTimeout(800);
  await page.goto('/#/'); await page.waitForTimeout(500); await shot(page, 'desktop-home');
  await page.goto(`/#/playlist/${road}`); await page.waitForTimeout(500); await shot(page, 'desktop-playlist'); // with the Now playing view
  await page.click('#pbar [data-act="queue"]'); await page.waitForTimeout(300); await shot(page, 'desktop-queue');
  await page.click('#pbar [data-act="queue"]');
  await page.goto(`/#/album/${encodeURIComponent(album)}`); await page.waitForTimeout(500); await shot(page, 'desktop-album');
  await page.goto('/#/search'); await page.fill('#search-input', 'nite'); await page.waitForTimeout(500); await shot(page, 'desktop-search');
  await page.goto('/#/lyrics'); await page.waitForTimeout(1500); await shot(page, 'desktop-lyrics');
  await page.goto('/#/settings'); await page.waitForTimeout(500); await shot(page, 'desktop-settings');
  await page.goto(`/#/playlist/${road}`);
  await page.click('#pbar [data-act="np-open"]'); await page.waitForTimeout(800); await shot(page, 'desktop-now-playing');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  test('phone screenshots', async ({ page }) => {
    const { road } = await setup(page);
    await page.waitForTimeout(800);
    await page.goto('/#/'); await page.waitForTimeout(500); await shot(page, 'phone-home');
    await page.goto(`/#/playlist/${road}`); await page.waitForTimeout(500); await shot(page, 'phone-playlist');
    await page.goto('/#/library'); await page.waitForTimeout(400); await shot(page, 'phone-library');
    await page.goto('/#/search'); await page.fill('#search-input', 'harbr'); await page.locator('#search-input').blur(); await page.waitForTimeout(500); await shot(page, 'phone-search');
    await page.goto(`/#/playlist/${road}`); await page.waitForTimeout(300);
    await page.locator('.tl-body .tr').nth(1).locator('[data-more]').tap(); await page.waitForTimeout(400); await shot(page, 'phone-song-menu');
    await page.goBack(); await page.waitForTimeout(300);
    await page.locator('#mini .mini-meta').tap(); await page.waitForTimeout(700); await shot(page, 'phone-now-playing');
    await page.locator('.np .np-lyrics').tap(); await page.waitForTimeout(1500); await shot(page, 'phone-lyrics');
    await page.goBack(); await page.waitForTimeout(400);
    await page.locator('.np [data-act="queue"]').tap(); await page.waitForTimeout(500); await shot(page, 'phone-queue');
  });
});
