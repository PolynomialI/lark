// Test music, generated with ffmpeg plus hand-written ID3v2.4 tags (title, artist, album, track,
// year, genre, cover art, lyrics). Files are cached in tests/.fixtures.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIX = new URL('./.fixtures/', import.meta.url).pathname;
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

const syncsafe = (n) => Buffer.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
function frame(id, body) { return Buffer.concat([Buffer.from(id), syncsafe(body.length), Buffer.from([0, 0]), body]); }
const text = (id, s) => frame(id, Buffer.concat([Buffer.from([3]), Buffer.from(s, 'utf8')]));
/** Build an ID3v2.4 tag. */
export function id3({ title, artist, album, albumArtist, track, year, genre, lyrics, cover, txxx = {} }) {
  const frames = [];
  for (const [k, v] of Object.entries(txxx)) frames.push(frame('TXXX', Buffer.concat([Buffer.from([3]), Buffer.from(`${k}\0${v}`, 'utf8')])));
  if (title) frames.push(text('TIT2', title));
  if (artist) frames.push(text('TPE1', artist));
  if (album) frames.push(text('TALB', album));
  if (albumArtist) frames.push(text('TPE2', albumArtist));
  if (track) frames.push(text('TRCK', String(track)));
  if (year) frames.push(text('TDRC', String(year)));
  if (genre) frames.push(text('TCON', genre));
  if (lyrics) frames.push(frame('USLT', Buffer.concat([Buffer.from([3]), Buffer.from('eng'), Buffer.from([0]), Buffer.from(lyrics, 'utf8')])));
  if (cover) frames.push(frame('APIC', Buffer.concat([Buffer.from([3]), Buffer.from('image/jpeg\0'), Buffer.from([3, 0]), cover])));
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), syncsafe(body.length), body]);
}
function tone(file, freq, seconds) {
  if (!existsSync(file)) ff('-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}:sample_rate=44100`, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', file);
  return readFileSync(file);
}
function coverJpg(color) {
  const f = join(FIX, `cover-${color}.jpg`);
  if (!existsSync(f)) ff('-f', 'lavfi', '-i', `color=c=0x${color}:s=400x400`, '-frames:v', '1', f);
  return readFileSync(f);
}

/** A handful of songs: tagged with cover + lyrics, untagged with an .lrc, and a duplicate. */
export function basic() {
  const dir = join(FIX, 'basic');
  if (existsSync(join(dir, 'done'))) return dir;
  mkdirSync(dir, { recursive: true });
  const blue = coverJpg('3366cc'), red = coverJpg('cc3344');
  const a = tone(join(FIX, 'tone-440.raw.mp3'), 440, 6), b = tone(join(FIX, 'tone-550.raw.mp3'), 550, 6), c = tone(join(FIX, 'tone-660.raw.mp3'), 660, 6), d = tone(join(FIX, 'tone-330.raw.mp3'), 330, 6);
  const first = Buffer.concat([id3({ title: 'Morning Light', artist: 'The Testers', album: 'Blue Album', track: 1, year: 2021, genre: 'Pop', cover: blue, lyrics: 'First line of the song\nSecond line of the song' }), a]);
  writeFileSync(join(dir, '01 Morning Light.mp3'), first);
  writeFileSync(join(dir, '02 Evening Glow.mp3'), Buffer.concat([id3({ title: 'Evening Glow', artist: 'The Testers', album: 'Blue Album', track: 2, year: 2021, genre: 'Pop', cover: blue }), b]));
  writeFileSync(join(dir, 'Red Song.mp3'), Buffer.concat([id3({ title: 'Red Song', artist: 'Crimson Band', album: 'Red Album', track: 1, year: 2019, genre: 'Rock', cover: red }), c]));
  writeFileSync(join(dir, 'Untagged Artist - Untagged Title.mp3'), d);
  writeFileSync(join(dir, 'Untagged Artist - Untagged Title.lrc'), '[ar:Untagged Artist]\n[00:00.50]Synced line one\n[00:02.00]Synced line two\n[00:04.00]Synced line three\n');
  writeFileSync(join(dir, 'copy of morning light.mp3'), first);
  writeFileSync(join(dir, 'done'), '');
  return dir;
}

/** Short tones (seconds each) for playback tests. */
export function tones(n = 6, seconds = 4) {
  const dir = join(FIX, `tones-${n}-${seconds}`);
  if (existsSync(join(dir, 'done'))) return dir;
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const audio = tone(join(FIX, `tone-${300 + i * 60}-${seconds}.raw.mp3`), 300 + i * 60, seconds);
    writeFileSync(join(dir, `Track ${String(i + 1).padStart(2, '0')}.mp3`), Buffer.concat([id3({ title: `Track ${i + 1}`, artist: 'Tone Generator', album: 'Tones', track: i + 1 }), audio]));
  }
  writeFileSync(join(dir, 'done'), '');
  return dir;
}

/** `count` MP3s: 10 ffmpeg-encoded tones, each copy with its own tags (so every file is unique). */
export function bulk(count = 1000) {
  const dir = join(FIX, `bulk-${count}`);
  if (existsSync(join(dir, 'done'))) return dir;
  mkdirSync(dir, { recursive: true });
  const covers = ['aa5533', '3355aa', '55aa33', 'aa33aa', '33aaaa'].map(coverJpg);
  const audio = Array.from({ length: 10 }, (_, i) => tone(join(FIX, `tone-${200 + i * 37}-3.raw.mp3`), 200 + i * 37, 3));
  for (let i = 0; i < count; i++) {
    const album = `Album ${Math.floor(i / 10) + 1}`;
    const tag = i % 7 === 0 ? Buffer.alloc(0) : id3({ title: `Song ${i + 1}`, artist: `Artist ${(i % 40) + 1}`, album, track: (i % 10) + 1, year: 2000 + (i % 20), cover: i % 3 === 0 ? covers[i % 5] : null });
    // Untagged files still differ: a unique ID3v1 trailer-free padding byte pattern via a tiny comment frame.
    const unique = i % 7 === 0 ? id3({ genre: `g${i}` }) : Buffer.alloc(0);
    writeFileSync(join(dir, i % 7 === 0 ? `Artist ${i} - Untitled ${i}.mp3` : `${String(i + 1).padStart(4, '0')}.mp3`), Buffer.concat([tag, unique, audio[i % 10]]));
  }
  writeFileSync(join(dir, 'done'), '');
  return dir;
}

/** About `totalMB` of WAV audio in files of ~50 MB (each one unique). */
export function big(totalMB = 1100) {
  const dir = join(FIX, `big-${totalMB}`);
  if (existsSync(join(dir, 'done'))) return dir;
  mkdirSync(dir, { recursive: true });
  const base = join(FIX, 'big-base.wav');
  if (!existsSync(base)) ff('-f', 'lavfi', '-i', 'sine=frequency=500:duration=290:sample_rate=44100', '-ac', '2', '-c:a', 'pcm_s16le', base);
  const buf = readFileSync(base);
  const n = Math.ceil((totalMB * 1024 * 1024) / buf.length);
  for (let i = 0; i < n; i++) {
    buf.writeUInt32LE(0x10000 + i, 1000); // change a few samples so each file has unique content
    writeFileSync(join(dir, `Long Tone ${i + 1}.wav`), buf);
  }
  writeFileSync(join(dir, 'done'), '');
  return dir;
}

/** A small, nicer-looking library for screenshots: fictional albums with gradient covers. */
export function showcase() {
  const dir = join(FIX, 'showcase');
  if (existsSync(join(dir, 'done'))) return dir;
  mkdirSync(dir, { recursive: true });
  const albums = [
    ['Neon Harbor', 'Midnight Ferry', 2023, 'ff6b57', '3a1c71', ['Harbor Lights', 'Saltwater Static', 'Last Ferry Home', 'Lighthouse Code']],
    ['Velvet Static', 'Soft Machines', 2022, '12c2e9', 'c471ed', ['Paper Satellites', 'Soft Machines', 'Chrome Petals', 'Night Bus']],
    ['Paper Moons', 'Cardboard Sky', 2021, 'f7971e', 'ffd200', ['Cardboard Sky', 'Lemon Tide', 'Kites at Noon', 'Sunday Radio']],
    ['Atlas Drift', 'Continental', 2024, '11998e', '38ef7d', ['Tectonic', 'Green Line', 'Northbound', 'Atlas']],
    ['Golden Hour Club', 'Late Light', 2020, 'ee0979', 'ff6a00', ['Late Light', 'Copper Sun', 'Dusk Parade', 'Amber']],
    ['Lumen Fields', 'Quiet Signals', 2019, '4568dc', 'b06ab3', ['Quiet Signals', 'Fieldnotes', 'Blue Hour', 'Low Orbit']],
  ];
  let n = 0;
  for (const [artist, album, year, c0, c1, titles] of albums) {
    const coverFile = join(FIX, `grad-${c0}.jpg`);
    if (!existsSync(coverFile)) ff('-f', 'lavfi', '-i', `gradients=s=500x500:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=500:y1=500:n=2:d=1`, '-frames:v', '1', coverFile);
    const cover = readFileSync(coverFile);
    titles.forEach((title, i) => {
      const secs = 150 + ((n * 37) % 110);
      const raw = join(FIX, `show-${n}.raw.mp3`);
      if (!existsSync(raw)) ff('-f', 'lavfi', '-i', `sine=frequency=${220 + n * 11}:duration=${secs}:sample_rate=22050`, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', '-map_metadata', '-1', '-id3v2_version', '0', raw);
      writeFileSync(join(dir, `${artist} - ${title}.mp3`), Buffer.concat([id3({ title, artist, album, track: i + 1, year, genre: 'Indie', cover }), readFileSync(raw)]));
      n++;
    });
  }
  writeFileSync(join(dir, 'Neon Harbor - Harbor Lights.lrc'), ['[00:00.50]Harbor lights are calling', '[00:04.00]Over the water, over the wire', '[00:08.00]Every signal brings me home', '[00:12.00]Saltwater static in the air', '[00:16.00]We keep on drifting, drifting', '[00:20.00]Till the morning finds us there', '[00:24.00]Harbor lights, harbor lights'].join('\n'));
  writeFileSync(join(dir, 'done'), '');
  return dir;
}

/** Songs with different loudness for normalisation tests (measured with ffmpeg's EBU R128 meter). */
export function loudness() {
  const dir = join(FIX, 'loudness');
  if (existsSync(join(dir, 'done'))) return dir;
  mkdirSync(dir, { recursive: true });
  const enc = (src, name, meta) => {
    const raw = join(FIX, `ld-${name}.raw.mp3`);
    if (!existsSync(raw)) ff('-f', 'lavfi', '-i', src, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', '-map_metadata', '-1', '-id3v2_version', '0', raw);
    writeFileSync(join(dir, `${name}.mp3`), Buffer.concat([id3({ title: name, artist: 'Loudness', album: 'Loudness', ...meta }), readFileSync(raw)]));
  };
  enc('anoisesrc=color=pink:amplitude=0.5:duration=12:seed=1', 'Loud Pink', {});
  enc('anoisesrc=color=pink:amplitude=0.05:duration=12:seed=2', 'Quiet Pink', {});
  enc('sine=frequency=60:duration=12,volume=-6dB', 'Bass Sine', {});
  enc('sine=frequency=1000:duration=12,volume=-20dB', 'Tagged', { txxx: { REPLAYGAIN_TRACK_GAIN: '-3.50 dB', REPLAYGAIN_TRACK_PEAK: '0.500000' } });
  writeFileSync(join(dir, 'done'), '');
  return dir;
}
/** Integrated loudness of a file according to ffmpeg's EBU R128 meter. */
export function ffmpegLufs(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  return Number(r.stderr.match(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/)[1]);
}
