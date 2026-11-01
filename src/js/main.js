import * as importer from './importer.js';
import * as player from './player.js';
import { search } from './search.js';
import * as store from './store.js';
import * as sync from './sync/sync.js';
import { initUI, registerSW } from './ui/app.js';

(async () => {
  await store.load();
  initUI();
  await player.applySettings();
  await player.restore();
  registerSW();
  sync.init();
  store.collectGarbage().catch(() => {});
  if (store.lib.songs.size) navigator.storage?.persist?.();
  // Handle for automated tests and debugging.
  window.__lark = { store, player, engine: player.engine, queue: player.queue, importer, search, sync };
  document.documentElement.dataset.ready = '1';
})();
