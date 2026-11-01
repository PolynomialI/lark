// A small in-memory stand-in for the Google Drive v3 REST API and Google sign-in, so the sync
// tests can run two "devices" (browser contexts) against one shared Drive.
import { createHash } from 'node:crypto';

const FAKE_GIS = `window.google = { accounts: { oauth2: {
  initTokenClient: (cfg) => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'fake-' + Math.random().toString(36).slice(2), expires_in: 3599, scope: cfg.scope, token_type: 'Bearer' }), 20) }),
  hasGrantedAllScopes: () => true, revoke: (t, cb) => cb && cb() } } };`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };

export class FakeDrive {
  files = new Map();
  sessions = new Map();
  n = 0;
  log = [];
  async install(context) {
    await context.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GIS, headers: CORS }));
    await context.route('https://www.googleapis.com/**', (r) => this.handle(r).catch((e) => r.fulfill({ status: 500, body: String(e), headers: CORS })));
  }
  inFolder(name) { return [...this.files.values()].filter((f) => !f.trashed && f.mimeType !== 'application/vnd.google-apps.folder' && (!name || f.name === name)); }
  content(name) { return this.inFolder(name)[0]?.content; }
  meta(f) { return { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, trashed: f.trashed, size: String(f.content?.length ?? 0), md5Checksum: f.content ? createHash('md5').update(f.content).digest('hex') : undefined, createdTime: f.createdTime }; }
  create(meta, content) {
    const f = { id: `f${++this.n}`, name: meta.name, mimeType: meta.mimeType || 'application/octet-stream', parents: meta.parents || [], trashed: false, content, createdTime: new Date(Date.now() + this.n).toISOString() };
    this.files.set(f.id, f);
    return f;
  }
  async handle(route) {
    const req = route.request(), url = new URL(req.url()), method = req.method(), p = url.pathname;
    const json = (status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { ...CORS, ...headers } });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (!(req.headers().authorization || '').startsWith('Bearer fake-')) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
    this.log.push(`${method} ${p}${url.search}`);
    const body = () => req.postDataBuffer() || Buffer.alloc(0);
    if (p === '/drive/v3/about') return json(200, { user: { emailAddress: 'me@example.com', displayName: 'Me' } });
    if (p === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      let list = [...this.files.values()].filter((f) => !(/trashed=false/.test(q) && f.trashed));
      const name = q.match(/name='([^']*)'/)?.[1], parent = q.match(/'([^']+)' in parents/)?.[1], mime = q.match(/mimeType='([^']*)'/)?.[1];
      if (name) list = list.filter((f) => f.name === name);
      if (mime) list = list.filter((f) => f.mimeType === mime);
      if (parent) list = list.filter((f) => f.parents.includes(parent));
      return json(200, { files: list.map((f) => this.meta(f)) });
    }
    if (p === '/drive/v3/files' && method === 'POST') return json(200, this.meta(this.create(JSON.parse(body().toString()), null)));
    let m = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m) {
      const f = this.files.get(m[1]);
      if (!f) return json(404, { error: { code: 404, message: 'File not found' } });
      if (method === 'GET' && url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, body: f.content || Buffer.alloc(0), headers: { ...CORS, 'Content-Type': f.mimeType } });
      if (method === 'GET') return json(200, this.meta(f));
      if (method === 'PATCH') { Object.assign(f, JSON.parse(body().toString())); return json(200, this.meta(f)); }
    }
    if (p === '/upload/drive/v3/files' && method === 'POST' && url.searchParams.get('uploadType') === 'multipart') {
      const boundary = req.headers()['content-type'].match(/boundary=(.+)$/)[1];
      const raw = body(), sep = Buffer.from(`--${boundary}`);
      const parts = [];
      for (let i = raw.indexOf(sep); i >= 0;) { const j = raw.indexOf(sep, i + sep.length); if (j < 0) break; parts.push(raw.subarray(i + sep.length + 2, j - 2)); i = j; }
      const split = (b) => { const k = b.indexOf('\r\n\r\n'); return b.subarray(k + 4); };
      return json(200, this.meta(this.create(JSON.parse(split(parts[0]).toString()), Buffer.from(split(parts[1])))));
    }
    if (p === '/upload/drive/v3/files' && method === 'POST' && url.searchParams.get('uploadType') === 'resumable') {
      const id = `s${++this.n}`;
      this.sessions.set(id, JSON.parse(body().toString()));
      return json(200, {}, { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` });
    }
    if (p === '/upload/drive/v3/files' && method === 'PUT') {
      const meta = this.sessions.get(url.searchParams.get('upload_id'));
      return json(200, this.meta(this.create(meta, Buffer.from(body()))));
    }
    m = p.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (m && method === 'PATCH') { const f = this.files.get(m[1]); f.content = Buffer.from(body()); return json(200, this.meta(f)); }
    return json(400, { error: { code: 400, message: `Fake Drive: unsupported ${method} ${p}` } });
  }
}
