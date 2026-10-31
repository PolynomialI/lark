// One-off: renders src/icons/logo.svg into the PNG app icons (run: node scripts/make-icons.mjs).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('src/icons/logo.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, maskable, out) {
  const inner = maskable ? Math.round(size * 0.72) : size;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${maskable ? '#FF6B57' : 'transparent'}">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${inner}" height="${inner}"></body>`);
  writeFileSync(out, await page.screenshot({ omitBackground: !maskable }));
}
await render(192, false, 'src/icons/icon-192.png');
await render(512, false, 'src/icons/icon-512.png');
await render(512, true, 'src/icons/maskable-512.png');
await browser.close();
