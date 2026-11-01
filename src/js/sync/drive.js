// Minimal Google Drive v3 client (REST over fetch). Lark uses the "drive.file" permission:
// it can only see and change files it created itself — nothing else in your Drive.
import { sleep } from '../util.js';

const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
export class NeedAuth extends Error {}
const q = (s) => encodeURIComponent(s);

export function createDrive(getToken) {
  async function call(url, opts = {}, tries = 0) {
    const token = getToken();
    if (!token) throw new NeedAuth('Google sign-in needed');
    let res;
    try {
      res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
    } catch {
      if (tries < 3) { await sleep(1000 * 2 ** tries); return call(url, opts, tries + 1); }
      throw new Error("Couldn't reach Google Drive. Check your internet connection.");
    }
    if (res.status === 401) throw new NeedAuth('Google sign-in expired');
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let reason = '', message = '';
      try { const e = JSON.parse(text).error; reason = e?.errors?.[0]?.reason || e?.status || ''; message = e?.message || ''; } catch {}
      if (reason === 'storageQuotaExceeded') throw new Error('Your Google Drive is full.');
      if ((res.status === 429 || res.status >= 500 || /rateLimit/i.test(reason)) && tries < 4) { await sleep(1500 * 2 ** tries); return call(url, opts, tries + 1); }
      throw new Error(`Google Drive error ${res.status}${message ? `: ${message}` : ''}`);
    }
    return res;
  }
  const json = async (url, opts) => (await call(url, opts)).json();
  const jsonBody = (method, body) => ({ method, headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body) });

  return {
    hasToken: () => !!getToken(),
    about: () => json(`${API}/about?fields=${q('user(emailAddress,displayName),storageQuota(limit,usage)')}`),
    async findFolder(name) {
      const r = await json(`${API}/files?spaces=drive&orderBy=createdTime&fields=${q('files(id,name)')}&q=${q(`name='${name}' and mimeType='${FOLDER}' and trashed=false`)}`);
      return r.files?.[0] || null;
    },
    createFolder: (name) => json(`${API}/files?fields=id`, jsonBody('POST', { name, mimeType: FOLDER })),
    async meta(id, fields = 'id,trashed,md5Checksum') {
      try { return await json(`${API}/files/${id}?fields=${q(fields)}`); } catch (e) { if (/ 404/.test(e.message)) return null; throw e; }
    },
    /** All files in a folder, as Map(name → { id, size, md5Checksum }). */
    async list(folderId) {
      const out = new Map();
      let pageToken = '';
      do {
        const r = await json(`${API}/files?spaces=drive&pageSize=1000&fields=${q('nextPageToken,files(id,name,size,md5Checksum)')}&q=${q(`'${folderId}' in parents and trashed=false`)}${pageToken ? `&pageToken=${q(pageToken)}` : ''}`);
        for (const f of r.files || []) if (!out.has(f.name)) out.set(f.name, f);
        pageToken = r.nextPageToken || '';
      } while (pageToken);
      return out;
    },
    download: (id) => call(`${API}/files/${id}?alt=media`),
    /** Small file (metadata + content in one request). */
    createSmall(folderId, name, blob, type) {
      const b = `lark${Math.random().toString(36).slice(2)}`;
      const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId], mimeType: type })}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`, blob, `\r\n--${b}--`]);
      return json(`${UP}/files?uploadType=multipart&fields=${q('id,md5Checksum,size')}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
    },
    updateContent: (id, blob, type) => json(`${UP}/files/${id}?uploadType=media&fields=${q('id,md5Checksum,size')}`, { method: 'PATCH', headers: { 'Content-Type': type }, body: blob }),
    /** Large file: resumable upload session, then the content in one PUT (streamed from disk). */
    async uploadLarge(folderId, name, blob, type) {
      const start = await call(`${UP}/files?uploadType=resumable&fields=${q('id,md5Checksum,size')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(blob.size) },
        body: JSON.stringify({ name, parents: [folderId], mimeType: type }),
      });
      const session = start.headers.get('Location');
      if (!session) throw new Error('Google Drive did not start the upload.');
      return json(session, { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
    },
    trash: (id) => json(`${API}/files/${id}?fields=id`, jsonBody('PATCH', { trashed: true })),
  };
}
