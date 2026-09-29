// api/_shared/graph.js
// Microsoft Graph lookup of the signed-in person's directory profile
// (display name, first/last name, job title) — the Static Web Apps sign-in
// only hands us the email, so "acastro@…" would otherwise be the best name
// the app could show.
//
// App-only (client-credentials) access. Needs an Entra App registration with
// the APPLICATION permission `User.ReadBasic.All` (admin consent) and a client
// secret, then on the Static Web App:
//   GRAPH_TENANT_ID     directory (tenant) id
//   GRAPH_CLIENT_ID     application (client) id
//   GRAPH_CLIENT_SECRET client secret value
// Without these `isConfigured()` is false and callers fall back to the email
// prefix; nothing breaks. Tokens are cached per function instance.

const TOKEN_URL  = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const GRAPH_USER = (upn)    => `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=displayName,givenName,surname,jobTitle,mail,userPrincipalName,id`;
const TIMEOUT_MS = 6000;

let _token = null;      // { value, expiresAt }

function isConfigured() {
  return !!(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);
}

async function _fetchWithTimeout(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function _getToken() {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;
  const body = new URLSearchParams({
    client_id:     process.env.GRAPH_CLIENT_ID,
    client_secret: process.env.GRAPH_CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials'
  });
  const res = await _fetchWithTimeout(TOKEN_URL(process.env.GRAPH_TENANT_ID), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  _token = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
  return _token.value;
}

/**
 * Look a person up by email / UPN.
 * Returns { displayName, givenName, surname, jobTitle, mail, upn, oid } or
 * null when Graph is not configured, the user is not found, or the call fails
 * (callers must treat null as "use the fallback name", never as an error).
 */
async function lookupUser(context, email) {
  if (!isConfigured() || !email) return null;
  try {
    const token = await _getToken();
    const res = await _fetchWithTimeout(GRAPH_USER(email), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const u = await res.json();
    return {
      displayName: u.displayName || '',
      givenName:   u.givenName   || '',
      surname:     u.surname     || '',
      jobTitle:    u.jobTitle    || '',
      mail:        u.mail        || '',
      upn:         u.userPrincipalName || '',
      oid:         u.id          || ''
    };
  } catch (err) {
    if (context && context.log) context.log.warn(`[graph] lookup failed for ${email}: ${err.message}`);
    return null;
  }
}

module.exports = { isConfigured, lookupUser };
