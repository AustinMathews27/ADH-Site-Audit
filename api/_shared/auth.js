// api/_shared/auth.js
// Who is calling? Azure Static Web Apps enforces sign-in at the edge
// (staticwebapp.config.json → "/api/*" needs the `authenticated` role) and
// forwards the signed-in principal in the `x-ms-client-principal` header
// (base64 JSON: { identityProvider, userId, userDetails, userRoles }).
//
// requireUser(context, req):
//   - parses the principal into context.user (null when the header is absent —
//     local runs, or an environment that has not turned sign-in on)
//   - optional allow-list: ALLOWED_EMAIL_DOMAINS="alleghenymillwork.com,acd.com"
//     rejects any signed-in account outside those domains with 403. The
//     pre-configured Entra provider lets ANY Microsoft account sign in, so on
//     the Free plan this is what keeps strangers out of the workspace.
//   Returns true when the request may proceed.

function parsePrincipal(req) {
  const raw = req && req.headers && (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL']);
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return {
      identityProvider: p.identityProvider || '',
      userId:           p.userId || '',
      userDetails:      String(p.userDetails || '').trim(),
      userRoles:        Array.isArray(p.userRoles) ? p.userRoles : []
    };
  } catch (e) { return null; }
}

function allowedDomains() {
  return String(process.env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function requireUser(context, req) {
  const user = parsePrincipal(req);
  context.user = user;
  const domains = allowedDomains();
  if (!user || !domains.length) return true;
  const email  = user.userDetails.toLowerCase();
  const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : '';
  if (domains.includes(domain)) return true;
  context.log.warn(`[auth] rejected ${email || user.userId} — domain not allowed`);
  context.res = {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
    body: { ok: false, error: 'not_allowed', message: `${email || 'This account'} is not part of this workspace.` }
  };
  return false;
}

module.exports = { requireUser, parsePrincipal };
