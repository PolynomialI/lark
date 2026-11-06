// Google sign-in (Google Identity Services, token model). Browser apps get a one-hour access token;
// renewing it needs a tap (Google shows a small window that closes by itself once you've agreed).
const CLIENT_ID = __GOOGLE_CLIENT_ID__ || (() => { try { return localStorage.getItem('lark-google-client-id') || ''; } catch { return ''; } })();
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let gis = null;

export const configured = () => !!CLIENT_ID;
export function loadGoogle() {
  return (gis ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => { gis = null; s.remove(); reject(new Error("Couldn't reach Google. Check your internet connection.")); };
    document.head.append(s);
  }));
}
/** Ask Google for an access token (must start from a tap or click). Resolves to { token, expiresAt }. */
export async function requestToken(email) {
  const google = await loadGoogle();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE, login_hint: email || undefined,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return reject(new Error('Lark needs permission to use its own files in your Google Drive. Please tick the box and allow it.'));
        resolve({ token: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed.' : e?.type === 'popup_failed_to_open' ? 'Your browser blocked the Google sign-in window.' : e?.message || 'Google sign-in failed.')),
    });
    // First connect: always let the person pick the account. Later sign-ins: the same account, no questions.
    client.requestAccessToken({ prompt: email ? '' : 'select_account consent' });
  });
}
export function revoke(token) { try { window.google?.accounts.oauth2.revoke(token, () => {}); } catch {} }
