// Sync UI: the Settings section, the cloud button (top bar / phone home) and the "tap to sync" prompt.
import * as sync from '../sync/sync.js';
import { $$, esc, fmtDate } from '../util.js';
import { acts, confirmDialog, toast } from './common.js';
import { ic } from './icons.js';

const S = sync.status;
const ICON = { idle: 'cloud-check', syncing: 'refresh-cw', auth: 'cloud-alert', error: 'cloud-off', offline: 'cloud-off' };
const when = (t) => (!t ? 'never' : Date.now() - t < 60000 ? 'just now' : Date.now() - t < 3600000 ? `${Math.round((Date.now() - t) / 60000)} min ago` : fmtDate(t).toLowerCase());

export function syncSectionHtml() {
  if (!S.configured) {
    return `<p class="hint">Sync isn't switched on for this copy of Lark yet: it needs a Google client ID. The steps are in the README ("Sync with Google Drive").</p>`;
  }
  if (!S.connected) {
    return `<div class="set-row"><div><b>Keep your library the same on all your devices</b>
      <p>Lark saves your songs, edits, playlists and likes in a "Lark" folder in your own Google Drive, and your other devices pick them up from there. Lark can only see the files it puts in that folder.</p></div>
      <button class="btn primary" data-act="sync-connect">${ic('cloud')}<span>Connect Google Drive</span></button></div>`;
  }
  const p = S.progress;
  return `<div class="set-row"><div><b>Connected as ${esc(S.email || 'your Google account')}</b>
      <p class="sync-msg">${esc(S.message || '')}${S.state !== 'syncing' ? ` Last synced ${when(S.lastSync)}.` : ''}</p>
      ${p ? `<div class="progress"><div style="width:${(p.done / Math.max(1, p.total)) * 100}%"></div></div>` : ''}
      ${S.waitingWifi ? `<p>You're on mobile data, so ${S.waitingWifi} songs are waiting for Wi-Fi. <button class="link-btn" data-act="sync-cellular">Transfer them now</button></p>` : ''}</div>
    <div class="set-btns"><button class="btn" data-act="sync-now"${S.state === 'syncing' ? ' disabled' : ''}>${ic('refresh-cw')}<span>Sync now</span></button>
      <button class="btn" data-act="sync-disconnect">Disconnect</button></div></div>
    <p class="hint">Lark syncs by itself while it's open. Google sign-ins last an hour, so after a while you'll be asked to tap Sync once.</p>`;
}

function render() {
  const box = document.getElementById('sync-box');
  if (box) box.innerHTML = syncSectionHtml();
  $$('[data-bind="sync-btn"]').forEach((b) => {
    b.hidden = !S.connected;
    b.innerHTML = ic(ICON[S.state] || 'cloud', S.state === 'syncing' ? 'spin' : '');
    b.classList.toggle('attention', S.state === 'auth' || S.state === 'error');
    const label = S.state === 'auth' ? 'Tap to sync with Google Drive' : S.message || 'Sync with Google Drive';
    b.title = label;
    b.setAttribute('aria-label', label);
  });
}
sync.events.on('status', render);
export const refreshSyncUI = render;

let prompted = false;
sync.events.on('need-auth', () => {
  if (prompted) return;
  prompted = true;
  toast('Sync with Google Drive', { label: 'Sync', run: () => { prompted = false; acts['sync-now'](); } }, { sticky: true });
});

const fail = (e) => toast(e?.message || 'Sync failed');
Object.assign(acts, {
  'sync-connect': () => sync.connect().catch(fail),
  'sync-now': () => (S.connected ? sync.syncNow().catch(fail) : (location.hash = '#/settings')),
  'sync-cellular': () => sync.downloadOnMobileData().catch(fail),
  'sync-disconnect': async () => {
    if (await confirmDialog('Disconnect Google Drive?', 'This device stops syncing. Your music stays on this device and in your Google Drive.', 'Disconnect')) await sync.disconnect();
  },
});
