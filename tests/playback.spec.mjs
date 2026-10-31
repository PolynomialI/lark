// Playback rules: repeat/shuffle, queue order, previous, near-gapless, crossfade, sleep timer, resume.
import { test } from '@playwright/test';
import { tones } from './fixtures.mjs';
import { expect, importDir, openApp } from './helpers.mjs';

const songIds = (page) => page.evaluate(() => window.__lark.store.albums().get([...window.__lark.store.albums().keys()].find((k) => k.endsWith('tones'))).songIds);
const now = (page) => page.evaluate(() => ({ id: window.__lark.engine.song?.id, title: window.__lark.engine.song?.title, t: window.__lark.engine.currentTime, paused: window.__lark.engine.paused }));
async function playAlbum(page, index = 0) {
  await page.evaluate((i) => { const { store, player } = window.__lark; const a = [...store.albums().values()].find((x) => x.name === 'Tones'); return player.playContext({ type: 'album', id: a.key }, a.songIds, i); }, index);
  await page.waitForFunction(() => !window.__lark.engine.paused && window.__lark.engine.currentTime > 0);
}
/** Record when each <audio> element starts playing and stops (ended/pause), with performance.now(). */
async function recordEvents(page) {
  await page.evaluate(() => {
    window.__ev = [];
    for (const s of window.__lark.engine.slots) for (const type of ['playing', 'ended', 'pause']) s.el.addEventListener(type, () => window.__ev.push({ type, slot: s.i, song: s.song?.title, at: performance.now() }));
  });
}

/** When a song stopped sounding: the first pause/ended on the slot it was playing in. */
const endOf = (ev, title) => { const k = ev.find((e) => e.type === 'playing' && e.song === title).slot; return ev.find((e) => e.slot === k && e.type !== 'playing').at; };

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await importDir(page, tones(6, 4));
});

test('repeat cycles off → repeat all → repeat one; shuffle toggles', async ({ page }) => {
  const repeat = page.locator('#pbar [data-bind="repeat"]');
  const state = () => page.evaluate(() => window.__lark.queue.repeat);
  expect(await state()).toBe('off');
  await repeat.click();
  expect(await state()).toBe('all');
  await expect(repeat).toHaveClass(/(^| )on( |$)/);
  await repeat.click();
  expect(await state()).toBe('one');
  await expect(repeat).toHaveAttribute('data-mode', 'one');
  await repeat.click();
  expect(await state()).toBe('off');
  await expect(repeat).not.toHaveClass(/(^| )on( |$)/);
  await page.locator('#pbar [data-bind="shuffle"]').click();
  expect(await page.evaluate(() => window.__lark.queue.shuffle)).toBe(true);
});

test('repeat one replays the song; repeat all wraps around; repeat off stops at the end', async ({ page }) => {
  const ids = await songIds(page);
  const auto = (repeat, start) => page.evaluate(({ repeat, start }) => {
    const q = new window.__lark.queue.constructor();
    q.repeat = repeat;
    q.setContext({ type: 'album' }, ['a', 'b', 'c'], start);
    return [q.next(true), q.next(true)];
  }, { repeat, start });
  expect(await auto('one', 1)).toEqual(['b', 'b']);
  expect(await auto('all', 1)).toEqual(['c', 'a']);
  expect(await auto('off', 1)).toEqual(['c', null]);
  expect(ids).toHaveLength(6);
});

test('shuffle plays every song once before any song repeats', async ({ page }) => {
  // Through the player: shuffle on, play the album, skip through it twice with repeat all.
  await page.locator('#pbar [data-bind="shuffle"]').click();
  await page.locator('#pbar [data-bind="repeat"]').click(); // repeat all
  await playAlbum(page, 0);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push((await now(page)).id);
    await page.evaluate(() => window.__lark.player.next());
  }
  expect(new Set(seen.slice(0, 6)).size).toBe(6);
  expect(new Set(seen.slice(6, 12)).size).toBe(6);
  // And directly on the queue with a bigger list.
  const ok = await page.evaluate(() => {
    const q = new window.__lark.queue.constructor();
    q.shuffle = true;
    q.repeat = 'all';
    const ids = Array.from({ length: 50 }, (_, i) => `s${i}`);
    q.setContext({ type: 'x' }, ids, 7);
    const order = [q.songId];
    for (let i = 0; i < 149; i++) order.push(q.next(true));
    const cycles = [0, 50, 100].map((k) => new Set(order.slice(k, k + 50)).size);
    return { first: order[0], cycles, natural: order.slice(0, 50).join() === ids.join() };
  });
  expect(ok).toEqual({ first: 's7', cycles: [50, 50, 50], natural: false });
});

test('queue: "Next in queue" plays before "Next from"; play next, add, reorder, remove, clear', async ({ page }) => {
  const ids = await songIds(page);
  await playAlbum(page, 0);
  await page.evaluate((ids) => { const { player } = window.__lark; player.addToQueue([ids[4]]); player.playNext([ids[5]]); player.addToQueue([ids[2], ids[3]]); }, ids);
  await page.click('#pbar [data-act="queue"]');
  const userRows = page.locator('#right [data-sec="user"] .q-t');
  await expect(userRows).toHaveText(['Track 6', 'Track 5', 'Track 3', 'Track 4']);
  await expect(page.locator('#right [data-sec="ctx"] h3')).toHaveText('Next from: Tones');
  await expect(page.locator('#right [data-sec="ctx"] .q-t').first()).toHaveText('Track 2');

  // Reorder by dragging the handle of "Track 4" above "Track 3".
  const grip = page.locator('#right [data-sec="user"] .q-row').nth(3).locator('[data-qgrip]');
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 20, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y - 52, { steps: 5 });
  await page.mouse.up();
  await expect(userRows).toHaveText(['Track 6', 'Track 5', 'Track 4', 'Track 3']);
  // Remove "Track 5".
  await page.locator('#right [data-sec="user"] .q-row').nth(1).locator('[data-q-remove]').click();
  await expect(userRows).toHaveText(['Track 6', 'Track 4', 'Track 3']);

  // Order of play: queued songs first, then the album continues where it was.
  const order = [];
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__lark.player.next()); order.push((await now(page)).title); }
  expect(order).toEqual(['Track 6', 'Track 4', 'Track 3', 'Track 2']);
  // Clear queue.
  await page.evaluate((ids) => window.__lark.player.addToQueue([ids[0], ids[1]]), ids);
  await page.locator('#right [data-act="q-clear"]').click();
  await expect(page.locator('#right [data-sec="user"]')).toHaveCount(0);
});

test('previous restarts the song after 3 seconds, otherwise goes to the previous song', async ({ page }) => {
  await playAlbum(page, 1);
  await page.evaluate(() => window.__lark.player.seek(3.5));
  await page.click('#pbar [data-act="prev"]');
  let s = await now(page);
  expect(s.title).toBe('Track 2');
  expect(s.t).toBeLessThan(1);
  await page.click('#pbar [data-act="prev"]');
  await page.waitForFunction(() => window.__lark.engine.song?.title === 'Track 1');
});

test('near-gapless: the next song starts as the previous one ends', async ({ page }) => {
  await playAlbum(page, 0);
  await recordEvents(page);
  await page.evaluate(() => window.__lark.player.seek(window.__lark.engine.duration - 1.2));
  await page.waitForFunction(() => window.__lark.engine.song?.title === 'Track 2' && window.__ev.filter((e) => e.type !== 'playing').length > 0, null, { timeout: 8000 })
    .catch(async (e) => { console.log(JSON.stringify(await page.evaluate(() => ({ ev: window.__ev, song: window.__lark.engine.song?.title, t: window.__lark.engine.currentTime, slots: window.__lark.engine.slots.map((s) => [s.song?.title, s.el.paused, s.el.currentTime, s.el.duration, s.ready]) })))); throw e; });
  const ev = await page.evaluate(() => window.__ev);
  const ended = endOf(ev, 'Track 1');
  const started = ev.find((e) => e.type === 'playing' && e.song === 'Track 2').at;
  console.log(`gapless handover: next song started ${Math.round(ended - started)} ms before the previous one ended`);
  expect(started - ended).toBeLessThan(50);    // no audible gap
  expect(ended - started).toBeLessThan(150);   // and only a tiny overlap
});

test('crossfade overlaps the two songs for the crossfade length', async ({ page }) => {
  await page.goto('/#/settings');
  await page.locator('#set-xfade').evaluate((el) => { el.value = 2; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => window.__lark.engine.web && window.__lark.engine.opts.crossfade === 2);
  await playAlbum(page, 0);
  await recordEvents(page);
  await page.evaluate(() => window.__lark.player.seek(window.__lark.engine.duration - 3));
  await page.waitForFunction(() => window.__lark.engine.song?.title === 'Track 2', null, { timeout: 8000 });
  await page.waitForTimeout(900);
  const mid = await page.evaluate(() => window.__lark.engine.slots.map((s) => ({ song: s.song?.title, playing: !s.el.paused, fade: s.fade.gain.value })));
  const fromTrack = mid.find((m) => m.song === 'Track 1'), toTrack = mid.find((m) => m.song === 'Track 2');
  expect(fromTrack.playing && toTrack.playing).toBe(true);           // both audible at once
  expect(fromTrack.fade).toBeLessThan(0.95);                         // fading out
  expect(toTrack.fade).toBeGreaterThan(0.05);                        // fading in
  await page.waitForFunction(() => window.__ev.some((e) => e.song === 'Track 1' && (e.type === 'ended' || e.type === 'pause')), null, { timeout: 5000 });
  const ev = await page.evaluate(() => window.__ev);
  const start = ev.find((e) => e.type === 'playing' && e.song === 'Track 2').at;
  const stop = endOf(ev, 'Track 1');
  console.log(`crossfade overlap: ${Math.round(stop - start)} ms`);
  expect(stop - start).toBeGreaterThan(1600);
  expect(stop - start).toBeLessThan(2600);
});

test('sleep timer: stops after the chosen minutes, or at the end of the song', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await playAlbum(page, 0);
  await page.click('#pbar [data-act="sleep-menu"]');
  await page.locator('.menu-item', { hasText: '15 minutes' }).click();
  await expect(page.locator('#pbar [data-bind="sleep"]')).toHaveClass(/(^| )on( |$)/);
  await page.clock.fastForward('14:00');
  expect((await now(page)).paused).toBe(false);
  await page.clock.fastForward('01:05');
  await page.waitForFunction(() => window.__lark.engine.paused);
  await expect(page.locator('#pbar [data-bind="sleep"]')).not.toHaveClass(/(^| )on( |$)/);

  // End of song: playback stops when the current song ends; the next one is ready but paused.
  await playAlbum(page, 0);
  await page.click('#pbar [data-act="sleep-menu"]');
  await page.locator('.menu-item', { hasText: 'End of song' }).click();
  await page.evaluate(() => window.__lark.player.seek(window.__lark.engine.duration - 1));
  await page.waitForFunction(() => window.__lark.engine.song?.title === 'Track 2', null, { timeout: 8000 });
  await page.waitForTimeout(500);
  const s = await now(page);
  expect(s.paused).toBe(true);
  expect(s.t).toBeLessThan(0.5);
});

test('resumes the same song, position and queue after the app is closed and reopened', async ({ page }) => {
  const ids = await songIds(page);
  await playAlbum(page, 2);
  await page.evaluate((ids) => { const { player } = window.__lark; player.addToQueue([ids[5]]); player.cycleRepeat(); player.seek(2.25); }, ids);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__lark.player.pause());
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  const s = await now(page);
  expect(s.title).toBe('Track 3');
  expect(s.paused).toBe(true);
  expect(Math.abs(s.t - 2.25)).toBeLessThan(0.35);
  expect(await page.evaluate(() => ({ user: window.__lark.queue.user.length, repeat: window.__lark.queue.repeat, ctx: window.__lark.queue.context.type }))).toEqual({ user: 1, repeat: 'all', ctx: 'album' });
  await expect(page.locator('#pbar [data-bind="title"]')).toHaveText('Track 3');
  await page.click('#pbar [data-bind="play"]');
  await page.waitForFunction(() => window.__lark.engine.currentTime > 2.5);
});
