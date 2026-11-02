// api/projectBook/index.js
// GET|POST /api/projectBook?action=…
//
// Master Project Book — the superintendent/job snapshot that used to be the
// hand-typed Master_Millwork_Project_Book.xlsm, fed straight from Innergy.
//
//   GET  ?action=state                      book + health + summary (default)
//   GET  ?action=history&jobId=<innergyId>  milestone history from daily snapshots
//   GET  ?action=discover                   raw Innergy shapes (field mapping aid)
//   POST ?action=sync          {trigger}    pull Innergy, diff, snapshot, alert
//   POST ?action=assign        {jobId, names:[…]}       manual superintendent
//   POST ?action=baseline      {jobId, fromCurrent|firstFieldCheck,firstDelivery,substantialCompletion}
//   POST ?action=acknowledge   {jobId}      dismiss the "new job" alert
//   POST ?action=archive       {jobId}      hide (never deletes)
//   POST ?action=restore       {jobId}      un-archive
//   POST ?action=settings      {settings?, roster?}
//   POST ?action=restoreBackup              roll the book back one write
//
// Storage (Cosmos "Auditdata"/"Audits", id = partition key, same as the rest
// of the app):
//   adh-pbook-state             the book (jobs, roster, settings, log, lastSync)
//   adh-pbook-state-backup      previous state, written before every change
//   adh-pbook-snap-YYYY-MM-DD   one snapshot per sync day (history for variance)
//
// Scheduling: none. project-book.js calls ?action=sync when the book is
// opened and the last sync is more than a few hours old, and "⚡ Sync
// Innergy" calls it on demand; both are throttled to once per 5 minutes.
// (Optional: a caller sending the PROJECT_BOOK_SYNC_SECRET app setting in an
// x-sync-secret header skips the throttle — nothing in the app needs it.)

const { CosmosClient } = require('@azure/cosmos');
const innergy = require('./innergy');
const M = require('./milestones');

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const container = client.database('Auditdata').container('Audits');

const STATE_ID  = 'adh-pbook-state';
const BACKUP_ID = 'adh-pbook-state-backup';
const SNAP_PREFIX = 'adh-pbook-snap-';
const LOG_CAP = 300;
const UI_SYNC_THROTTLE_MS = 5 * 60 * 1000;
// Static Web Apps managed functions are cut off at 45 s. Stop starting new
// work-order reads after this long; jobs not reached keep yesterday's dates
// and are listed in lastSync.errors (the next sync picks them up).
const SYNC_TIME_BUDGET_MS = 25 * 1000;
const SYNC_SECRET = process.env.PROJECT_BOOK_SYNC_SECRET || '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, x-sync-secret',
  'Content-Type': 'application/json',
};

// Seeded from the Supt Helper roster in the boss's workbook. Editable via
// ?action=settings; "Super Needed" is a marker, not a person.
const DEFAULT_ROSTER = [
  'Austin Castro', 'Jay Pineda', 'Bruce Hopper', 'Chris Dupree', 'Danny Sanders',
  'Gabriel McNew', 'Javier Morales', 'Phinehas Campbell', 'Gordon Ward', 'Anthony Garcia',
];

// ── State I/O ──────────────────────────────────────────────────────────────
function freshState() {
  return {
    id: STATE_ID, type: 'projectBook', v: 1,
    settings: {}, roster: DEFAULT_ROSTER.slice(),
    jobs: {}, log: [],
    lastSync: null, createdAt: new Date().toISOString(),
  };
}

async function readDoc(id) {
  try {
    const { resource } = await container.item(id, id).read();
    return resource || null;
  } catch (e) {
    if (e.code === 404) return null;
    throw e;
  }
}

async function loadState() {
  const s = await readDoc(STATE_ID);
  if (s && s.jobs) return s;
  // Self-healing: a missing or mangled state doc falls back to the backup,
  // then to a fresh book. Never throws the UI into a blank screen.
  const b = await readDoc(BACKUP_ID);
  if (b && b.jobs) { const r = Object.assign({}, b, { id: STATE_ID }); delete r._etag; delete r._rid; delete r._self; delete r._ts; return r; }
  return freshState();
}

async function saveState(state, context) {
  const prev = await readDoc(STATE_ID);
  if (prev) {
    const backup = Object.assign({}, prev, { id: BACKUP_ID, backedUpAt: new Date().toISOString() });
    delete backup._etag; delete backup._rid; delete backup._self; delete backup._ts; delete backup._attachments;
    await container.items.upsert(backup);
  }
  state.updatedAt = new Date().toISOString();
  const { resource } = await container.items.upsert(state);
  if (context) context.log(`[projectBook] state saved (${JSON.stringify(state).length} bytes)`);
  return resource;
}

function logLine(state, kind, msg, jobId) {
  state.log.unshift({ at: new Date().toISOString(), kind, msg, jobId: jobId || null });
  if (state.log.length > LOG_CAP) state.log.length = LOG_CAP;
}

// ── Superintendent name resolution (mirrors the sheet's matching matrix) ───
// "Danny/Phinehas", "Rodney / Phinehas", "Austin Castro" → roster names +
// any token we could not place (so the health panel can flag it).
function resolveSupers(raw, roster) {
  const names = [], unresolved = [];
  const tokens = String(raw || '').split(/[\/,&+]|\band\b/i).map(t => t.trim()).filter(Boolean);
  for (const t of tokens) {
    const tl = t.toLowerCase();
    if (tl === 'none' || tl === 'super needed' || tl === 'tbd') continue;
    const hit = roster.find(n => n.toLowerCase() === tl)
      || roster.find(n => n.toLowerCase().split(' ')[0] === tl.split(' ')[0]);
    if (hit) { if (!names.includes(hit)) names.push(hit); }
    else unresolved.push(t);
  }
  return { names, unresolved };
}

function effectiveSuper(job) {
  if (job.super && job.super.manual && job.super.manual.length) return job.super.manual;
  return (job.super && job.super.names) || [];
}

// ── Sync ───────────────────────────────────────────────────────────────────
function isClosed(project, settings) {
  const st = String(project.Status || project.status || '').toLowerCase();
  return M.settingsWithDefaults(settings).closedStatuses.some(c => st.includes(c));
}

function milestonesChanged(a, b, noiseDays) {
  if (!a || !b) return true;
  return ['firstFieldCheck', 'firstDelivery', 'substantialCompletion'].some(k => {
    if (!a[k]) return false;                 // a date appearing is "filled in", not a change
    const d = M.daysBetween(a[k], b[k]);
    if (d == null) return (a[k] || null) !== (b[k] || null);
    return Math.abs(d) > noiseDays;
  });
}

async function runSync(state, context, trigger) {
  const started = Date.now();
  const settings = M.settingsWithDefaults(state.settings);
  const today = new Date().toISOString().slice(0, 10);
  const errors = [];

  let projects;
  try {
    projects = await innergy.listProjects();
  } catch (e) {
    // Hard failure: keep the book exactly as it was, just record the miss.
    state.lastSync = { at: new Date().toISOString(), ok: false, trigger, projects: 0, errors: [e.message], durationMs: Date.now() - started };
    logLine(state, 'error', 'Innergy project list failed: ' + e.message);
    return state;
  }

  // Jobs whose work orders were read longest ago go first, so when the time
  // budget runs out the next sync carries on where this one stopped.
  const woAge = p => { const j = state.jobs[String(p.Id || p.id || '')]; return (j && j.woReadAt) || ''; };
  const open = projects.filter(p => !isClosed(p, settings))
    .sort((a, b) => woAge(a) < woAge(b) ? -1 : woAge(a) > woAge(b) ? 1 : 0);
  const seen = new Set();
  // The very first sync is the starting book, not "new jobs" — don't open
  // with an alert listing every job in Innergy.
  const firstSync = Object.keys(state.jobs).length === 0;
  const deadline = started + SYNC_TIME_BUDGET_MS;
  let skipped = 0;

  await innergy.mapLimit(open, 6, async (p) => {
    const id = String(p.Id || p.id || '');
    if (!id) return;
    seen.add(id);
    const number = String(p.Number || p.number || '');
    const name   = p.Name || p.name || '';
    const client = (p.Customer && p.Customer.Name) || p.customerName || '';
    const status = p.Status || p.status || '';

    let job = state.jobs[id];

    // Work orders are only needed for the field-check date (and as a
    // fallback for the other two); jobs archived by hand don't need them.
    let wos = null;
    if (job && job.archived && job.archiveReason === 'manual') { /* skip */ }
    else if (Date.now() > deadline) skipped++;
    else {
      try { wos = await innergy.listWorkOrders(id); }
      catch (e) { errors.push(`${number || id}: ${e.message}`); }
    }

    const supFromInnergy = M.deriveSuperintendent(p, settings, wos);
    const resolved = resolveSupers(supFromInnergy.name, state.roster);

    const isNew = !job;
    if (isNew) {
      job = state.jobs[id] = {
        innergyId: id, number, name, client, status,
        super: { raw: '', names: [], unresolved: [], manual: [], source: '' },
        current: null, source: null, counts: null,
        baseline: null, variance: null,
        firstSeen: today, lastSeen: today, lastChanged: null,
        archived: false, archivedAt: null, acknowledged: firstSync,
      };
      if (!firstSync) logLine(state, 'new', `New job in Innergy: ${number} ${name}`, id);
    }

    job.number = number; job.name = name; job.client = client; job.status = status;
    job.lastSeen = today;
    job.innergyGone = false;
    // Auto-archived (closed / vanished) but open in Innergy again → bring it
    // back. Manual archives stay put.
    if (job.archived && job.archiveReason && job.archiveReason !== 'manual') {
      job.archived = false; job.archivedAt = null; job.archiveReason = '';
      logLine(state, 'restore', `${number} ${name} reopened in Innergy — restored`, id);
    }
    // Without work orders a WO.* super path can't be checked — keep last one.
    if (supFromInnergy.name || (wos && job.super.source)) {
      job.super.raw = supFromInnergy.name;
      job.super.names = resolved.names;
      job.super.unresolved = resolved.unresolved;
      job.super.source = supFromInnergy.name ? 'innergy:' + supFromInnergy.path : '';
    }

    const derived = M.deriveMilestones(wos, settings, p);
    const next = { firstFieldCheck: derived.firstFieldCheck, firstDelivery: derived.firstDelivery, substantialCompletion: derived.substantialCompletion };
    const source = Object.assign({}, derived.source);
    if (!wos && job.current) {
      // Work orders not read this time: keep whatever came from them before.
      ['firstFieldCheck', 'firstDelivery', 'substantialCompletion'].forEach(k => {
        if (!next[k]) { next[k] = job.current[k] || null; if (job.source) source[k] = job.source[k]; }
      });
    }
    if (wos) job.woReadAt = new Date().toISOString();
    if (wos || next.firstDelivery || next.substantialCompletion || next.firstFieldCheck) {
      if (!isNew && job.current && milestonesChanged(job.current, next, settings.noiseDays)) {
        ['firstFieldCheck', 'firstDelivery', 'substantialCompletion'].forEach(k => {
          const d = M.daysBetween(job.current[k], next[k]);
          if (d != null && Math.abs(d) > settings.noiseDays) {
            logLine(state, 'change', `${number} ${name}: ${k} ${job.current[k]} → ${next[k]} (${d > 0 ? '+' : ''}${d} d)`, id);
          } else if (job.current[k] && job.current[k] !== (next[k] || null)) {
            logLine(state, 'change', `${number} ${name}: ${k} ${job.current[k] || '—'} → ${next[k] || '—'}`, id);
          }
        });
        job.lastChanged = today;
      }
      job.current = next;
      job.source = source;
      if (derived.counts) job.counts = derived.counts;
      // Baseline = first sync that produced any date (or a manual set later).
      if (!job.baseline && (next.firstFieldCheck || next.firstDelivery || next.substantialCompletion)) {
        job.baseline = Object.assign({}, next, { setAt: today, source: 'first-sync' });
        if (!firstSync) logLine(state, 'baseline', `${number} ${name}: baseline captured from first Innergy snapshot`, id);
      } else if (job.baseline && job.baseline.source === 'first-sync') {
        // A date Innergy didn't have yet (or that wasn't read) at baseline
        // time joins the baseline the first time it shows up.
        ['firstFieldCheck', 'firstDelivery', 'substantialCompletion'].forEach(k => { if (!job.baseline[k] && next[k]) job.baseline[k] = next[k]; });
      }
      job.variance = M.classifyVariance(job.current, job.baseline, settings);
    }

    // Archive rule: past Substantial Completion + N days.
    if (!job.archived && job.current && job.current.substantialCompletion) {
      const age = M.daysBetween(job.current.substantialCompletion, today);
      job.archiveCandidate = age != null && age >= settings.archiveAfterDays;
    } else {
      job.archiveCandidate = false;
    }
  });

  // Jobs that left the open list (closed in Innergy, or deleted) are
  // auto-archived — hidden, never erased. Snapshots keep their history.
  for (const [id, job] of Object.entries(state.jobs)) {
    if (seen.has(id) || job.archived) continue;
    const closedProj = projects.find(p => String(p.Id || p.id || '') === id);
    job.innergyGone = !closedProj;
    job.status = closedProj ? (closedProj.Status || closedProj.status || job.status) : job.status;
    job.archived = true; job.archivedAt = today; job.archiveCandidate = false;
    job.archiveReason = closedProj ? 'closed in Innergy' : 'no longer in Innergy';
    logLine(state, 'archive', `${job.number} ${job.name} archived — ${job.archiveReason}`, id);
  }

  if (firstSync) logLine(state, 'sync', `Project Book started with ${Object.keys(state.jobs).length} jobs from Innergy`);

  // Daily snapshot (one doc per day, overwritten by later syncs the same day).
  const snap = { id: SNAP_PREFIX + today, type: 'projectBookSnapshot', date: today, jobs: {} };
  for (const [id, job] of Object.entries(state.jobs)) {
    snap.jobs[id] = { number: job.number, name: job.name, super: effectiveSuper(job), current: job.current, archived: !!job.archived };
  }
  try { await container.items.upsert(snap); }
  catch (e) { errors.push('snapshot: ' + e.message); }

  // Retention — best effort, never blocks the sync.
  try {
    const cutoff = new Date(Date.now() - settings.snapshotRetentionDays * 86400000).toISOString().slice(0, 10);
    const { resources } = await container.items.query({
      query: 'SELECT c.id FROM c WHERE c.type = @t AND c.date < @cutoff',
      parameters: [{ name: '@t', value: 'projectBookSnapshot' }, { name: '@cutoff', value: cutoff }],
    }).fetchAll();
    for (const r of resources) await container.item(r.id, r.id).delete();
  } catch (e) { if (context) context.log.warn('[projectBook] retention: ' + e.message); }

  state.lastSync = {
    at: new Date().toISOString(), ok: errors.length === 0, trigger,
    projects: open.length, closedSkipped: projects.length - open.length,
    // Not an error: these jobs got their project dates, and their work
    // orders are first in line next sync.
    woDeferred: skipped,
    errors, durationMs: Date.now() - started,
  };
  logLine(state, errors.length ? 'warn' : 'sync',
    `Sync (${trigger}): ${open.length} open jobs read` +
    (skipped ? `, ${skipped} jobs' work orders left for next sync` : '') +
    (errors.length ? ', ' + errors.length + ' error' + (errors.length === 1 ? '' : 's') : ''));
  return state;
}

// ── Read model ─────────────────────────────────────────────────────────────
function summarize(state) {
  const settings = M.settingsWithDefaults(state.settings);
  const today = new Date().toISOString().slice(0, 10);
  const jobs = Object.values(state.jobs);
  const active = jobs.filter(j => !j.archived);
  const health = {
    missingSuper: active.filter(j => !effectiveSuper(j).length).map(j => j.innergyId),
    missingDates: active.filter(j => !j.current || !j.current.firstFieldCheck || !j.current.firstDelivery || !j.current.substantialCompletion).map(j => j.innergyId),
    datesOutOfOrder: active.filter(j => j.current && j.current.firstDelivery && j.current.substantialCompletion && j.current.firstDelivery > j.current.substantialCompletion).map(j => j.innergyId),
    unresolvedSupers: active.filter(j => j.super && j.super.unresolved && j.super.unresolved.length && !(j.super.manual || []).length).map(j => ({ jobId: j.innergyId, tokens: j.super.unresolved })),
    syncAgeHours: state.lastSync ? Math.round((Date.now() - Date.parse(state.lastSync.at)) / 36e5) : null,
    lastSyncOk: state.lastSync ? state.lastSync.ok : null,
  };
  const byType = {};
  active.forEach(j => { const t = (j.variance && j.variance.type) || 'no-baseline'; byType[t] = (byType[t] || 0) + 1; });
  const supers = new Set(); active.forEach(j => effectiveSuper(j).forEach(n => supers.add(n)));
  return {
    today,
    activeJobs: active.length,
    archivedJobs: jobs.length - active.length,
    newJobs: active.filter(j => !j.acknowledged).map(j => j.innergyId),
    archiveCandidates: active.filter(j => j.archiveCandidate).map(j => j.innergyId),
    supersInUse: supers.size,
    rosterSize: state.roster.length,
    varianceByType: byType,
    health,
    settings,
  };
}

function publicState(state) {
  return {
    jobs: state.jobs, roster: state.roster, settings: state.settings,
    log: state.log, lastSync: state.lastSync, updatedAt: state.updatedAt,
    summary: summarize(state),
  };
}

// ── HTTP handler ───────────────────────────────────────────────────────────
function respond(context, status, body) {
  context.res = { status, headers: CORS, body: JSON.stringify(body) };
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return req.body;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS, body: '' }; return; }

  const action = String(req.query.action || (req.method === 'GET' ? 'state' : '')).trim();
  const body = parseBody(req);

  try {
    // ── reads ──
    if (action === 'state') {
      const state = await loadState();
      return respond(context, 200, publicState(state));
    }

    if (action === 'history') {
      const jobId = String(req.query.jobId || '');
      if (!/^[A-Za-z0-9_-]+$/.test(jobId)) return respond(context, 400, { error: 'jobId required' });
      const { resources } = await container.items.query({
        query: 'SELECT c.date, c.jobs[@id] AS job FROM c WHERE c.type = @t AND IS_DEFINED(c.jobs[@id]) ORDER BY c.date',
        parameters: [{ name: '@t', value: 'projectBookSnapshot' }, { name: '@id', value: jobId }],
      }).fetchAll();
      return respond(context, 200, { jobId, points: resources.map(r => ({ date: r.date, current: r.job && r.job.current, super: r.job && r.job.super })) });
    }

    if (action === 'discover') {
      // Field-mapping aid, read-only. Answers "where does Innergy keep the
      // superintendent?" by tallying who appears in each people field across
      // every open job, plus the people on recent Installation work orders.
      // Names and dates only: no money, notes or addresses.
      if (!innergy.hasKey()) return respond(context, 503, { error: 'INNERGY_API_KEY not set' });
      const projects = await innergy.listProjects();
      const settings = M.settingsWithDefaults((await loadState()).settings);
      const open = projects.filter(p => !isClosed(p, settings));
      const tally = (into, key, val) => { if (!val) return; (into[key] = into[key] || {}); into[key][val] = (into[key][val] || 0) + 1; };
      const PEOPLE = ['ProjectManager', 'Coordinators', 'Engineers', 'Estimators', 'SalesPersons', 'Installers', 'InstallerGroupEmployees', 'InstallerGroups'];
      const projectPeople = {}, customFields = {};
      const withDates = { FirstDelivery: 0, SubstantialCompletion: 0 };
      for (const p of open) {
        PEOPLE.forEach(k => tally(projectPeople, k, M.personName(p[k])));
        (p.CustomFields || []).forEach(f => tally(customFields, f.Name, M.personName(f.Value) || '(empty)'));
        if (p.FirstDelivery) withDates.FirstDelivery++;
        if (p.SubstantialCompletion) withDates.SubstantialCompletion++;
      }
      // Newest three open jobs (most likely to have install WOs staffed).
      const recent = open.slice().sort((a, b) => String(b.CreatedOn || '').localeCompare(String(a.CreatedOn || ''))).slice(0, 3);
      const WO_PEOPLE = ['Installers', 'InstallerGroupEmployees', 'TeamLead', 'Owner', 'Assignees', 'ProjectManager'];
      const samples = [];
      for (const p of recent) {
        let wos = [];
        try { wos = await innergy.listWorkOrders(p.Id || p.id); } catch (e) { samples.push({ job: p.Number, error: e.message }); continue; }
        const types = {}; wos.forEach(w => { const t = w.Type || '—'; types[t] = (types[t] || 0) + 1; });
        const installPeople = {};
        wos.filter(w => /install/i.test(w.Type || '')).forEach(w => WO_PEOPLE.forEach(k => tally(installPeople, k, M.personName(w[k]))));
        samples.push({
          job: `${p.Number} ${p.Name}`,
          workOrderTypes: types,
          installWorkOrderPeople: installPeople,
          workOrdersWithFieldVerifiedDate: wos.filter(w => w.FieldVerifiedStepItemPlannedDate).length,
          workOrdersWithReadyForFVDate: wos.filter(w => w.ReadyForFieldVerificationStepItemPlannedDate).length,
          superintendentGuess: M.deriveSuperintendent(p, settings, wos),
          milestonesGuess: M.deriveMilestones(wos, settings, p),
        });
      }
      return respond(context, 200, {
        projectCount: projects.length,
        openCount: open.length,
        openWithProjectDates: withDates,
        superintendentPathsTried: settings.superintendentPaths,
        projectPeople,           // field → { name: number of open jobs }
        customFields,            // custom field name → { value: count }
        recentJobs: samples,
      });
    }

    if (req.method !== 'POST') return respond(context, 405, { error: 'POST required for ' + action });

    // ── writes ──
    const state = await loadState();

    if (action === 'sync') {
      const secretOk = SYNC_SECRET && req.headers['x-sync-secret'] === SYNC_SECRET;
      const trigger = secretOk ? 'schedule' : (body.trigger || 'manual');
      if (!secretOk && state.lastSync && Date.now() - Date.parse(state.lastSync.at) < UI_SYNC_THROTTLE_MS) {
        return respond(context, 429, { error: 'Synced less than 5 minutes ago', lastSync: state.lastSync });
      }
      if (!innergy.hasKey()) return respond(context, 503, { error: 'INNERGY_API_KEY not set — add it in Azure → Configuration → Application settings' });
      await runSync(state, context, trigger);
      await saveState(state, context);
      return respond(context, 200, publicState(state));
    }

    const jobId = String(body.jobId || '');
    const needJob = ['assign', 'baseline', 'restore'].includes(action) || (action === 'acknowledge' && !body.all) || (action === 'archive' && !body.candidates);
    const job = needJob ? state.jobs[jobId] : null;
    if (needJob && !job) return respond(context, 404, { error: 'Unknown jobId', jobId });

    if (action === 'assign') {
      const names = Array.isArray(body.names) ? body.names.map(n => String(n).trim()).filter(Boolean) : [];
      const unknown = names.filter(n => !state.roster.includes(n));
      if (unknown.length) return respond(context, 400, { error: 'Not on roster: ' + unknown.join(', ') + ' — add them in Settings first' });
      job.super.manual = names;
      logLine(state, 'assign', `${job.number} ${job.name}: superintendent set to ${names.join(' / ') || '(cleared)'}`, jobId);
    }
    else if (action === 'baseline') {
      let b;
      if (body.fromCurrent) {
        if (!job.current) return respond(context, 400, { error: 'Job has no current dates' });
        b = Object.assign({}, job.current);
      } else {
        b = {};
        for (const k of ['firstFieldCheck', 'firstDelivery', 'substantialCompletion']) {
          const v = body[k] == null ? null : String(body[k]);
          if (v && !ISO.test(v)) return respond(context, 400, { error: `${k} must be YYYY-MM-DD` });
          b[k] = v || null;
        }
      }
      job.baseline = Object.assign(b, { setAt: new Date().toISOString().slice(0, 10), source: 'manual', note: body.note ? String(body.note).slice(0, 200) : '' });
      job.variance = job.current ? M.classifyVariance(job.current, job.baseline, state.settings) : null;
      logLine(state, 'baseline', `${job.number} ${job.name}: baseline set manually${body.note ? ' — ' + body.note : ''}`, jobId);
    }
    else if (action === 'acknowledge') {
      if (body.all) Object.values(state.jobs).forEach(j => { j.acknowledged = true; });
      else job.acknowledged = true;
    }
    else if (action === 'archive' && body.candidates) {
      const list = Object.values(state.jobs).filter(j => !j.archived && j.archiveCandidate);
      list.forEach(j => { j.archived = true; j.archivedAt = new Date().toISOString().slice(0, 10); j.archiveCandidate = false; j.archiveReason = 'manual'; });
      logLine(state, 'archive', `${list.length} job${list.length === 1 ? '' : 's'} past Substantial Completion archived`);
    }
    else if (action === 'archive') {
      job.archived = true; job.archivedAt = new Date().toISOString().slice(0, 10); job.archiveCandidate = false; job.archiveReason = 'manual';
      logLine(state, 'archive', `${job.number} ${job.name} archived manually`, jobId);
    }
    else if (action === 'restore') {
      job.archived = false; job.archivedAt = null; job.archiveReason = '';
      logLine(state, 'restore', `${job.number} ${job.name} restored`, jobId);
    }
    else if (action === 'settings') {
      if (body.roster) {
        if (!Array.isArray(body.roster)) return respond(context, 400, { error: 'roster must be an array' });
        state.roster = body.roster.map(n => String(n).trim()).filter(Boolean);
      }
      if (body.settings && typeof body.settings === 'object') {
        const allowed = Object.keys(M.DEFAULT_SETTINGS);
        const clean = {};
        for (const k of allowed) if (body.settings[k] !== undefined) clean[k] = body.settings[k];
        state.settings = Object.assign({}, state.settings, clean);
        // Re-run classification so a tolerance change shows immediately.
        for (const j of Object.values(state.jobs)) if (j.current) j.variance = M.classifyVariance(j.current, j.baseline, state.settings);
      }
      logLine(state, 'settings', 'Settings / roster updated');
    }
    else if (action === 'restoreBackup') {
      const b = await readDoc(BACKUP_ID);
      if (!b || !b.jobs) return respond(context, 404, { error: 'No backup available' });
      const restored = Object.assign({}, b, { id: STATE_ID });
      delete restored._etag; delete restored._rid; delete restored._self; delete restored._ts; delete restored._attachments;
      logLine(restored, 'restore', 'Book restored from backup taken ' + (b.backedUpAt || '—'));
      await saveState(restored, context);
      return respond(context, 200, publicState(restored));
    }
    else {
      return respond(context, 400, { error: 'Unknown action: ' + action });
    }

    await saveState(state, context);
    return respond(context, 200, publicState(state));

  } catch (e) {
    context.log.error('[projectBook] ' + action + ': ' + (e.stack || e.message));
    return respond(context, 500, { error: 'Project Book error: ' + e.message });
  }
};
