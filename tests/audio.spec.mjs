// Volume boost limiter and Spotify-style loudness normalisation.
import { test } from '@playwright/test';
import { join } from 'node:path';
import { ffmpegLufs, loudness } from './fixtures.mjs';
import { expect, importDir, openApp } from './helpers.mjs';

test('the limiter never goes over the ceiling, settles at once (no pumping at the start) and leaves normal levels alone', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(async () => {
    async function render(gain, amp) {
      const sr = 44100, secs = 8, ctx = new OfflineAudioContext(2, sr * secs, sr);
      await ctx.audioWorklet.addModule('limiter-worklet.js');
      const buf = ctx.createBuffer(2, sr * secs, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) { const t = i / sr, beat = (t * 2) % 1 < 0.15 ? 1 : 0.55; d[i] = amp * beat * (0.6 * Math.sin(2 * Math.PI * 55 * t) + 0.3 * Math.sin(2 * Math.PI * 440 * t) + 0.1 * Math.sin(2 * Math.PI * 3000 * t)); }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lim = new AudioWorkletNode(ctx, 'lark-limiter', { outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      src.connect(g).connect(lim).connect(ctx.destination);
      src.start();
      const out = (await ctx.startRendering()).getChannelData(0);
      const step = sr / 2, rms = [];
      let peak = 0;
      for (let k = 0; k < secs * 2; k++) { let s = 0; for (let i = k * step; i < (k + 1) * step; i++) { s += out[i] * out[i]; peak = Math.max(peak, Math.abs(out[i])); } rms.push(10 * Math.log10(s / step)); }
      return { peak, rms, input: buf.getChannelData(0), out };
    }
    const boosted = await render(1.5, 0.97);
    const quiet = await render(1, 0.4);
    const look = Math.round(44100 * 0.005);
    let maxDiff = 0;
    for (let i = look; i < 44100; i++) maxDiff = Math.max(maxDiff, Math.abs(quiet.out[i] - quiet.input[i - look]));
    return { peak: boosted.peak, first: boosted.rms[0], rest: boosted.rms.slice(1), quietDiff: maxDiff };
  });
  expect(r.peak).toBeLessThanOrEqual(0.945);                                           // below -0.5 dBFS, never clips
  for (const v of r.rest) expect(Math.abs(v - r.rest[0])).toBeLessThan(0.1);           // steady from second to second
  expect(Math.abs(r.first - r.rest[0])).toBeLessThan(0.3);                             // no slow ramp at the start
  expect(r.quietDiff).toBeLessThan(1e-6);                                              // untouched below the ceiling
});

test('loudness is measured like Spotify / EBU R128, and Normal and Loud levels set the right gain', async ({ page }) => {
  test.setTimeout(120000);
  const dir = loudness();
  const ref = Object.fromEntries(['Loud Pink', 'Quiet Pink', 'Bass Sine'].map((n) => [n, ffmpegLufs(join(dir, `${n}.mp3`))]));
  await openApp(page);
  await importDir(page, dir);
  await page.goto('/#/settings');
  await page.locator('label.switch:has(#set-norm)').click();
  await expect.poll(() => page.evaluate(() => [...window.__lark.store.lib.songs.values()].every((s) => s.lufs != null)), { timeout: 60000 }).toBe(true);
  const songs = await page.evaluate(() => Object.fromEntries([...window.__lark.store.lib.songs.values()].map((s) => [s.title, { lufs: s.lufs, peak: s.peak }])));
  console.log('Lark vs ffmpeg (LUFS):', Object.entries(ref).map(([n, v]) => `${n}: ${songs[n].lufs} vs ${v}`).join(', '));
  for (const [n, v] of Object.entries(ref)) expect(Math.abs(songs[n].lufs - v)).toBeLessThan(0.5);
  expect(songs.Tagged).toEqual({ lufs: -14.5, peak: 0.5 });                              // from ReplayGain tags (-18 - (-3.5))

  const gainFor = async (title) => {
    await page.evaluate((t) => { const { store, player } = window.__lark; const s = [...store.lib.songs.values()].find((x) => x.title === t); return player.playContext({ type: 'songs' }, [s.id], 0); }, title);
    return page.evaluate(() => 20 * Math.log10(window.__lark.engine.slot.norm.gain.value));
  };
  // Normal (-14 LUFS): a loud song is turned down to -14; a quiet one is raised only until its peak reaches -1 dB.
  let db = await gainFor('Loud Pink');
  expect(db).toBeCloseTo(-14 - songs['Loud Pink'].lufs, 1);
  db = await gainFor('Quiet Pink');
  expect(db).toBeCloseTo(Math.min(20, -14 - songs['Quiet Pink'].lufs, -1 - 20 * Math.log10(songs['Quiet Pink'].peak)), 1); // (+20 dB at most)
  // Loud (-11 LUFS): no peak cap (the limiter handles peaks).
  await page.selectOption('#set-norm-level', 'loud');
  await page.waitForFunction(() => window.__lark.engine.opts.normLevel === 'loud');
  db = await gainFor('Quiet Pink');
  expect(db).toBeCloseTo(Math.min(20, -11 - songs['Quiet Pink'].lufs), 1);
});

test('equaliser boosts go through the limiter too (no clipping)', async ({ page }) => {
  await openApp(page);
  // Same audio graph as Lark's: EQ filters all at +12 dB → master → limiter; render a loud signal offline.
  const peak = await page.evaluate(async () => {
    const sr = 44100, ctx = new OfflineAudioContext(2, sr * 3, sr);
    await ctx.audioWorklet.addModule('limiter-worklet.js');
    const buf = ctx.createBuffer(2, sr * 3, sr);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = 0.9 * Math.sin(2 * Math.PI * 220 * i / sr); }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filters = [60, 150, 400, 1000, 2400, 15000].map((f, i, a) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === a.length - 1 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1; b.gain.value = 12; return b; });
    const lim = new AudioWorkletNode(ctx, 'lark-limiter', { outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    src.connect(filters[0]);
    filters.reduce((a, b) => (a.connect(b), b)).connect(lim).connect(ctx.destination);
    src.start();
    const out = (await ctx.startRendering()).getChannelData(0);
    return out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  });
  expect(peak).toBeLessThanOrEqual(0.945);
});
