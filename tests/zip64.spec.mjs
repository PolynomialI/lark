// ZIP64: the zip library (client-zip) writes archives over 4 GB, and Lark's reader reads them back.
// Runs in Node (no browser) with a ~4.3 GB generated file.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { closeSync, createWriteStream, mkdirSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadZip } from 'client-zip';
import { FIX } from './fixtures.mjs';
import { entryBlob, readZipEntries } from '../src/js/zip-import.js';

/** Minimal file-backed Blob (Node's fs.openAsBlob reports sizes over 4 GiB wrongly; browsers don't). */
class FileBlob {
  constructor(path, start = 0, end = statSync(path).size) { Object.assign(this, { path, start, end }); }
  get size() { return this.end - this.start; }
  slice(a = 0, b = this.size) { return new FileBlob(this.path, this.start + a, this.start + Math.min(b, this.size)); }
  async arrayBuffer() {
    const buf = Buffer.alloc(this.size), fd = openSync(this.path, 'r');
    try { readSync(fd, buf, 0, this.size, this.start); } finally { closeSync(fd); }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  }
}

test('a zip over 4 GB is written as ZIP64 and read back correctly', async () => {
  test.setTimeout(900000);
  const BIG = Math.round(4.3 * 1024 ** 3), CHUNK = 4 << 20;
  const chunk = new Uint8Array(CHUNK).map((_, i) => i & 255);
  let sent = 0;
  const big = new ReadableStream({ pull(c) { const n = Math.min(CHUNK, BIG - sent); if (n <= 0) return c.close(); c.enqueue(n === CHUNK ? chunk : chunk.slice(0, n)); sent += n; } });
  mkdirSync(join(FIX, 'out'), { recursive: true });
  const file = join(FIX, 'out', 'zip64-test.zip');
  try {
    const res = downloadZip([
      { name: 'library.json', input: '{"format":"lark-library"}', lastModified: new Date() },
      { name: 'audio/huge.wav', input: big, size: BIG, lastModified: new Date() },
      { name: 'covers/after.jpg', input: new Uint8Array([1, 2, 3, 4, 5]), lastModified: new Date() },
    ]);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
    const blob = new FileBlob(file);
    expect(blob.size).toBeGreaterThan(4 * 1024 ** 3);
    const entries = await readZipEntries(blob);
    expect([...entries.keys()]).toEqual(['library.json', 'audio/huge.wav', 'covers/after.jpg']);
    expect(entries.get('audio/huge.wav').size).toBe(BIG);
    expect(entries.get('covers/after.jpg').off).toBeGreaterThan(2 ** 32); // offset only expressible with ZIP64
    expect([...new Uint8Array(await (await entryBlob(blob, entries.get('covers/after.jpg'))).arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    const tail = new Uint8Array(await (await entryBlob(blob, entries.get('audio/huge.wav'))).slice(BIG - 4).arrayBuffer());
    expect([...tail]).toEqual([...chunk.slice((BIG - 4) % CHUNK, (BIG % CHUNK) || CHUNK)].slice(-4));
    // Independent check with Python's zipfile module.
    const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(",".join(f"{i.filename}={i.file_size}" for i in z.infolist()))', file]).toString().trim();
    expect(out).toBe(`library.json=25,audio/huge.wav=${BIG},covers/after.jpg=5`);
  } finally {
    rmSync(file, { force: true });
  }
});
