// Desktop sidebar: drag the gap to resize it; drag far left (or click the library icon) to collapse it into a rail.
import { test } from '@playwright/test';
import { basic } from './fixtures.mjs';
import { expect, importDir, openApp } from './helpers.mjs';

test('the Your Library sidebar can be resized, collapsed into a rail and expanded again', async ({ page }) => {
  await openApp(page);
  await importDir(page, basic());
  const width = () => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width);
  const handle = page.locator('.side-resizer');
  const drag = async (dx) => {
    const b = await handle.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + 200, { steps: 5 });
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + 200, { steps: 5 });
    await page.mouse.up();
  };
  expect(await width()).toBe(300);
  await drag(100);
  expect(await width()).toBe(400);
  await drag(500);
  expect(await width()).toBe(480);                       // widest
  await drag(-400);                                       // far left → collapses into the rail
  await expect(page.locator('body')).toHaveClass(/side-collapsed/);
  expect(await width()).toBe(72);
  await expect(page.locator('#side-lib .li-text').first()).toBeHidden();
  await expect(page.locator('#side-lib .li .cover').first()).toBeVisible();
  await page.reload();                                    // remembered
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  expect(await width()).toBe(72);
  await page.click('#side-lib .lib-title');               // the library icon expands it again
  await expect(page.locator('body')).not.toHaveClass(/side-collapsed/);
  expect(await width()).toBe(480);
  await handle.dblclick();                                // double-click the handle collapses it
  expect(await width()).toBe(72);
});
