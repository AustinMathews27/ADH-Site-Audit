// api/getProfile/index.js
// GET /api/getProfile
//
// Who is the signed-in person, as the app should show them?
//   { ok, email, userId, name, givenName, surname, jobTitle, source }
//
// `name` comes from Microsoft Graph (source: "graph") when
// api/_shared/graph.js is configured; otherwise it is the email prefix
// (source: "email") — the same fallback the client already used. The client
// caches the answer in IndexedDB, so a device keeps its name offline and the
// Graph call happens once per launch at most.

const { requireUser } = require('../_shared/auth');
const graph = require('../_shared/graph');

function fallbackName(email) {
  const e = String(email || '');
  return e.includes('@') ? e.slice(0, e.indexOf('@')) : e;
}

module.exports = async function (context, req) {
  if (!requireUser(context, req)) return;

  context.res = { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } };

  const user  = context.user;                       // parsed x-ms-client-principal, or null locally
  const email = (user && user.userDetails) || '';
  if (!email) {
    context.res.status = 200;
    context.res.body   = { ok: true, email: '', userId: '', name: '', source: 'none', graphConfigured: graph.isConfigured() };
    return;
  }

  const g = await graph.lookupUser(context, email);
  context.res.status = 200;
  context.res.body = {
    ok:        true,
    email,
    userId:    user.userId || '',
    name:      (g && g.displayName) || fallbackName(email),
    givenName: (g && g.givenName)   || '',
    surname:   (g && g.surname)     || '',
    jobTitle:  (g && g.jobTitle)    || '',
    source:    g ? 'graph' : 'email',
    graphConfigured: graph.isConfigured()
  };
};
