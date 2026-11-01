// Works with the network off after the first visit; passes Chrome's install (PWA) checks.
import { test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FIX, tones } from './fixtures.mjs';
import { expect, importDir, openApp, waitForServiceWorker } from './helpers.mjs';

test('works fully offline after the first visit', async ({ page, context }) => {
  await openApp(page);
  await waitForServiceWorker(page);
  await importDir(page, tones(6, 4));
  await context.setOffline(true);
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  const res = await page.reload();
  expect(res.fromServiceWorker()).toBe(true);
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  await page.goto('/#/songs');
  await expect(page.locator('.ph-meta')).toContainText('6 songs');
  await page.locator('.tl-body .tr').first().dblclick();
  await page.waitForFunction(() => window.__lark.engine.currentTime > 0.5);
  // The import worker (tag reader) also comes from the offline cache.
  await expect.poll(() => page.evaluate(async () => !!(await caches.match('import-worker.js')))).toBe(true);
  expect(failed).toEqual([]);
});

test('passes Chrome\'s installability checks', async ({ page }) => {
  await openApp(page);
  await waitForServiceWorker(page);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
  const m = JSON.parse(manifest.data);
  expect(m).toMatchObject({ name: 'Lark', display: 'standalone' });
  expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});

test('an app update (new service worker and cache) keeps the library', async ({ page }) => {
  await openApp(page);
  await waitForServiceWorker(page);
  await importDir(page, tones(6, 4));
  await page.evaluate(async () => { await window.__lark.store.createPlaylist({ name: 'Keep me' }); });
  // What an update does to the app's own files: the old worker and its cache go away.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  await waitForServiceWorker(page);
  expect(await page.evaluate(() => [window.__lark.store.lib.songs.size, [...window.__lark.store.lib.playlists.values()][0]?.name])).toEqual([6, 'Keep me']);
});

test('a new version switches over by itself when nothing is playing', async ({ page }) => {
  // Serve a private copy of the app so this test can "publish" a new version.
  const dir = join(FIX, 'out', 'dist-update');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync('dist', dir, { recursive: true });
  const server = spawn('node', ['scripts/serve.mjs'], { env: { ...process.env, PORT: '5181', ROOT: `${dir}/` }, stdio: 'ignore' });
  try {
    await expect.poll(() => fetch('http://localhost:5181/').then((r) => r.ok, () => false)).toBe(true);
    await openApp(page, 'http://localhost:5181/');
    await waitForServiceWorker(page);
    await importDir(page, tones(6, 4));
    appendFileSync(join(dir, 'sw.js'), '\n// next version\n');
    const reloaded = page.waitForEvent('load');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await reloaded;
    await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
    expect(await page.evaluate(() => window.__lark.store.lib.songs.size)).toBe(6);
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('privacy policy and terms pages are reachable (also once the app is installed)', async ({ page }) => {
  await openApp(page);
  await waitForServiceWorker(page);
  await page.goto('/privacy.html');
  await expect(page.locator('h1')).toHaveText('Privacy policy');
  await expect(page.locator('body')).toContainText('drive.file');
  await page.goto('/terms.html');
  await expect(page.locator('h1')).toHaveText('Terms of service');
  await page.goto('/');
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
});
