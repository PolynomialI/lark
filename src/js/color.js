// Pick a background colour from a cover (works on the main thread and in workers).
export function dominantColor(img) {
  const c = new OffscreenCanvas(24, 24);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 24, 24);
  const d = g.getImageData(0, 0, 24, 24).data;
  let r = 0, gr = 0, b = 0, w = 0;
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const sat = max ? (max - min) / max : 0, lum = max / 255;
    const wt = 0.05 + sat * sat * (lum > 0.2 && lum < 0.95 ? 1 : 0.15);
    r += R * wt; gr += G * wt; b += B * wt; w += wt;
  }
  [r, gr, b] = [r / w, gr / w, b / w];
  const m = Math.max(r, gr, b, 1), target = Math.min(Math.max(m, 90), 170) / m;
  return `rgb(${Math.round(r * target)},${Math.round(gr * target)},${Math.round(b * target)})`;
}
/** Square-crop and downscale an image blob to a JPEG cover; returns { blob, color }. */
export async function makeCoverBlob(blob, size = 512) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(bmp.width, bmp.height), out = Math.min(size, s);
  const c = new OffscreenCanvas(out, out);
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, out, out);
  const color = dominantColor(bmp);
  bmp.close();
  return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 }), color };
}
