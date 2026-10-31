import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';

export async function openApp(page, path = '/') {
  await page.goto(path);
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
}
export const filesIn = (dir) => readdirSync(dir).filter((f) => f !== 'done').map((f) => join(dir, f));
/** Add music through the hidden file input, then wait for the import to finish. */
export async function importDir(page, dir) {
  await page.setInputFiles('#file-input', filesIn(dir));
  await page.waitForFunction(() => !window.__lark.importer.state.active, null, { timeout: 170000 });
  return page.evaluate(() => ({ ...window.__lark.importer.state }));
}
export async function waitForServiceWorker(page) {
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready) && !!navigator.serviceWorker.controller, null, { timeout: 20000 });
}
/** A canonical dump of the whole library (metadata + covers + audio file hashes) for exact comparison. */
export function snapshot(page) {
  return page.evaluate(async () => {
    const { store } = window.__lark;
    await store.load();
    await store.collectGarbage(); // compare only what the library still uses
    const L = store.lib;
    const hex = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('audio', { create: true });
    const files = {};
    for await (const [name, h] of dir.entries()) files[name] = await hex(await h.getFile());
    const covers = {};
    for (const c of L.covers.values()) covers[c.id] = { bytes: await hex(c.blob), color: c.color || null };
    const byId = (a, b) => (a.id < b.id ? -1 : 1);
    return {
      songs: [...L.songs.values()].sort(byId),
      playlists: [...L.playlists.values()].sort(byId),
      folders: [...L.folders.values()].sort(byId),
      likes: [...L.likes.entries()].sort(),
      history: L.history.map(({ songId, at, ctx }) => ({ songId, at, ctx })),
      settings: L.settings,
      covers, files,
    };
  });
}
export async function clearAllStorage(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(page.url()).origin, storageTypes: 'all' });
  await cdp.detach();
}
export { expect };
