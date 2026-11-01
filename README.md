# Lark

A music player for music files you own, in the style of a premium streaming app: every song on demand, unlimited skips, shuffle, repeat, a queue, crossfade, lyrics, and no ads. It plays only the files you add. Nothing is streamed or uploaded: your music stays on each device.

Lark is an installable web app (PWA). It installs on Android and on computers like a normal app and works fully offline after the first visit.

**Live:** https://lark-music.onrender.com

| Desktop | Phone |
| --- | --- |
| ![Home](docs/screenshots/desktop-home.png) | ![Home](docs/screenshots/phone-home.png) |
| ![Playlist](docs/screenshots/desktop-playlist.png) | ![Now playing](docs/screenshots/phone-now-playing.png) |

More in [docs/screenshots](docs/screenshots).

## Features

- **Add music** by file picker, drag and drop, or a whole folder (computer). MP3 plus whatever the browser plays: M4A/AAC, FLAC, OGG, Opus, WAV. Tags are read: title, artist, album, album artist, track, year, genre, cover art, lyrics. A matching `.lrc` file gives synced lyrics. Files without tags use the name (`Artist - Title.mp3`). Duplicates (same file content) are skipped. Imports run in the background with a progress bar.
- **Library**: Liked Songs, All songs, Recently played, automatic Albums and Artists pages from the tags, playlists with folders and pinning, "Your Library" with filters, sorting and list/grid view (right-click or long-press an album or artist to remove it from the list), and typo-tolerant search.
- **Editing**: song title, artist, album, cover (paste an image with Ctrl+V or "Paste image", upload and crop, or reuse another cover) and lyrics; bulk edit of several songs; playlist name, description and cover (default: a 4-cover mosaic). Your original files are never changed.
- **Playback**: shuffle (every song once before repeats), repeat off/all/one, queue ("Next in queue" before "Next from: …"; play next, add, reorder, remove, clear), previous restarts the song after 3 s, volume up to 150% (boosted above 100%, with a limiter), crossfade 0–12 s, near-gapless playback, volume normalisation (ReplayGain tags, otherwise measured), a 6-band equaliser with presets, a sleep timer (minutes or end of song), and synced lyrics. Lark remembers the song, position and queue after closing.
- **Controls**: lock screen, notification, Bluetooth/headphone buttons and keyboard media keys (Media Session), plus keyboard shortcuts on computers (listed in Settings).
- **Export / import**: one `.zip` with everything (songs as-is, covers, edits, playlists, likes, history, settings). It is written as a stream, so it needs no extra memory or disk space, and it supports libraries over 4 GB (ZIP64). Import replaces or merges.

## Install on your Samsung phone

1. Open the Lark address in **Chrome** (Samsung Internet works too).
2. Tap the **⋮** menu → **Add to Home screen** → **Install**. Lark now opens like an app, without the browser bar.
3. Open Lark → **Add music files** (or **Import library** if you exported one on another device).
4. Lark asks the browser to protect its storage. Installing the app is what normally grants this; Settings → Storage shows whether it is protected.

On a computer, open the address in Chrome or Edge and click the install icon in the address bar.

## Move your library to another device

1. On the old device: **Settings → Export library**. A file `lark-library-YYYY-MM-DD.zip` is saved to Downloads. Keep Lark open until it finishes.
2. Move the file with a USB cable, Quick Share or Google Drive.
3. On the new device: **Settings → Import library**, pick the file, then choose:
   - **Merge**: adds songs, playlists, likes and history. Songs you already have (same file content) are not duplicated.
   - **Replace**: makes the library exactly like the export.

## Deploy (Render, free static site)

The app is static files built into `dist/`. Render builds it from this repository.

1. Sign in at [dashboard.render.com](https://dashboard.render.com) (free account). If GitHub isn't connected yet: **Account settings → Git providers → Connect GitHub**, and allow access to the `lark` repository.
2. Click **New → Static Site** and pick **PolynomialI/lark**.
3. Fill in:
   - **Branch**: `main`
   - **Build command**: `npm ci && npm run build`
   - **Publish directory**: `dist`
4. Click **Deploy Static Site**. After a minute or two the site is live at `https://<name>.onrender.com`.
5. Open that address on your phone and install it (see above).

Render static sites are free and don't sleep. Every push to `main` deploys automatically.

**Updates never touch your library.** Your music and library data live in the browser's private storage (IndexedDB and OPFS) on each device. A new version only replaces the app's own cached files. It switches over by itself the next time you open Lark (or within a few seconds, if nothing is playing); while music is playing, Lark instead shows "A new version of Lark is ready → Restart" until you tap it.

## Development

```bash
npm install
```

```bash
npm run dev      # build and serve on http://localhost:5173
```

```bash
npm test         # build, then run the Playwright tests (Chromium)
```

The tests need `ffmpeg` and `python3`. They generate their own music, including a 1,000-file library and a library over 1 GB; the ZIP64 test temporarily writes a 4.3 GB file. Screenshots are regenerated into `docs/screenshots` by `tests/screenshots.spec.mjs`.

What the tests check:

| Test file | What it checks |
| --- | --- |
| `import.spec.mjs` | Tagged and untagged MP3s, covers, embedded and `.lrc` lyrics, duplicate skipping; 1,000 files import with progress while the app stays responsive |
| `playback.spec.mjs` | Repeat cycle, shuffle (no repeats until all played), queue order and editing, previous, near-gapless hand-over, crossfade overlap, sleep timer, resume after reload |
| `edits.spec.mjs` | Song edits, cover upload and crop, cover paste, bulk edit, likes, playlist create/rename/cover/add/reorder, folders, pin, duplicate, all surviving a reload |
| `export-import.spec.mjs` | Export → clear all storage → import gives back the exact same library (including a library over 1 GB); merge doesn't duplicate |
| `zip64.spec.mjs` | A zip over 4 GB is written as ZIP64 by client-zip and read back by Lark's importer |
| `offline.spec.mjs` | Works with the network off after the first visit; passes Chrome's installability checks; an app update keeps the library and switches over by itself |
| `playback.spec.mjs` (panel) | The desktop "Now playing view" panel follows the current song and switches with the queue |
| `phone.spec.mjs` | Phone layout: tabs, mini-player swipe to skip, swipe up/down for the full player, bottom-sheet menus, Back closes sheets |

## How it's built

- Plain JavaScript, bundled with esbuild. Main app ≈ 43 KB gzipped. The tag reader is loaded only when you add music.
- Libraries, at exact versions: [client-zip](https://github.com/Touffy/client-zip) 2.5.1 (streaming ZIP64 writer, ≈ 3 KB) and [music-metadata](https://github.com/Borewit/music-metadata) 12.3.3 (tag reader, ≈ 86 KB gzipped, in a worker). The import side of `.zip` files is a small reader in `src/js/zip-import.js`.
- Audio files are stored in the Origin Private File System, and library data in IndexedDB.
- Playback uses two `<audio>` elements, so the next song is already loaded. Web Audio (crossfade, EQ, normalisation) is only switched on while one of those features is on. With all three off, Lark plays through the plain audio element, which is the most reliable for playing with the screen off.
- Near-gapless: the next song starts about 10 ms before the current one ends. In tests the hand-over overlaps by about 40 ms and never leaves a gap. Truly sample-accurate gapless would need whole songs decoded into memory.
- Font: [Figtree](https://github.com/erikdkennedy/figtree) (SIL Open Font License). Icons: [Lucide](https://lucide.dev) (ISC).
