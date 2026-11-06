// Phone layout: bottom tabs, mini-player (swipe left/right to skip, swipe up for the full player),
// swipe down to close, bottom-sheet menus.
import { test } from '@playwright/test';
import { tones } from './fixtures.mjs';
import { expect, importDir, openApp } from './helpers.mjs';

test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

async function swipe(page, x1, y1, x2, y2) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8 }] });
  await page.waitForTimeout(120); // like a real finger: stop before lifting (otherwise Chrome starts a fling)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
const title = (page) => page.evaluate(() => window.__lark.engine.song?.title);

test('phone layout: tabs, mini-player swipes, full player, sheets', async ({ page }) => {
  await openApp(page);
  await importDir(page, tones(6, 4));
  await expect(page.locator('.tabs')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('#pbar')).toBeHidden();

  // Your Library tab → album → tap a song to play it.
  await page.locator('.tabs a', { hasText: 'Your Library' }).tap();
  await page.locator('.lib-page .li', { hasText: 'Tones' }).tap();
  await expect(page.locator('.topbar [data-act="back"]')).toBeVisible();
  await page.locator('.tl-body .tr').first().tap();
  await page.waitForFunction(() => !window.__lark.engine.paused);
  const mini = page.locator('#mini');
  await expect(mini).toBeVisible();
  await expect(mini.locator('[data-bind="title"]')).toHaveText('Track 1');

  // Swipe the mini-player left → next song; right → previous song.
  const b = await mini.boundingBox();
  const y = b.y + b.height / 2;
  await swipe(page, b.x + b.width * 0.7, y, b.x + b.width * 0.1, y);
  await expect.poll(() => title(page)).toBe('Track 2');
  await swipe(page, b.x + b.width * 0.2, y, b.x + b.width * 0.9, y);
  await expect.poll(() => title(page)).toBe('Track 1');

  // Swipe up → full-screen player; swipe down → closed.
  await swipe(page, b.x + b.width * 0.4, y, b.x + b.width * 0.4, y - 200);
  await expect(page.locator('.np.open')).toBeVisible();
  await expect(page.locator('.np [data-bind="title"]')).toHaveText('Track 1');
  await page.waitForTimeout(400); // let the slide-in animation finish
  await swipe(page, 200, 300, 200, 650);
  await expect(page.locator('.np')).toHaveCount(0);

  // Song menu opens as a bottom sheet.
  await page.locator('.tl-body .tr').nth(2).locator('[data-more]').tap();
  await expect(page.locator('.menu.sheet')).toBeVisible();
  await expect(page.locator('.menu.sheet .mh-t')).toHaveText('Track 3');
  await page.locator('.menu.sheet .menu-item', { hasText: 'Add to queue' }).tap();

  // Full player → queue sheet shows the queued song; Back closes it.
  await mini.locator('.mini-meta').tap();
  await page.locator('.np [data-act="queue"]').tap();
  await expect(page.locator('.sheet-queue [data-sec="user"] .q-t')).toHaveText(['Track 3']);
  await page.goBack();
  await expect(page.locator('.sheet-queue')).toHaveCount(0);
  await expect(page.locator('.np.open')).toBeVisible();
});

test('phone: reorder Liked Songs with the drag handles (⋯ → Reorder songs)', async ({ page }) => {
  await openApp(page);
  await importDir(page, tones(6, 4));
  await page.evaluate(async () => { const { store } = window.__lark; for (const id of store.allSongIds().slice(0, 3).reverse()) await store.setLiked([id], true); });
  await page.goto('/#/liked');
  await expect(page.locator('.tl-body .tr')).toHaveCount(3);
  const before = await page.locator('.tl-body .t').allTextContents();
  await page.locator('.ab [data-act="ctx-menu"]').tap();
  await page.locator('.menu.sheet .menu-item', { hasText: 'Reorder songs' }).tap();
  await expect(page.locator('.editing-bar')).toBeVisible();
  const grip = page.locator('.tl-body .tr').nth(2).locator('[data-grip]');
  await expect(grip).toBeVisible();
  const g = await grip.boundingBox(), top = await page.locator('.tl-body .tr').first().boundingBox();
  await swipe(page, g.x + g.width / 2, g.y + g.height / 2, g.x + g.width / 2, top.y + 6);
  await expect(page.locator('.tl-body .t')).toHaveText([before[2], before[0], before[1]]);
  await page.locator('.editing-bar').getByRole('button', { name: 'Done' }).tap();
  await expect(page.locator('.editing-bar')).toHaveCount(0);
});
