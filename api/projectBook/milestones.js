// api/projectBook/milestones.js
// Pure functions: Innergy project + work orders → the three Project Book
// milestones, and current-vs-baseline → a variance classification.
// No I/O here so the rules can be unit-tested and tuned without Azure.

const DAY = 86400000;

// ── Settings defaults ──────────────────────────────────────────────────────
// Everything a superintendent manager might want to tune lives in the state
// doc's `settings` and overrides these. Keep the shapes flat and JSON-only.
const DEFAULT_SETTINGS = {
  // Work-order Type/Name patterns (case-insensitive) that count as a field check.
  fieldCheckPatterns: ['field check', 'field verif', 'field measure', 'site verif', 'site measure'],
  // Work-order types that make up the install window (delivery → completion).
  installTypes: ['installation', 'install'],
  // Dotted paths tried in order on the Innergy project object for the super.
  // Confirm the real one with ?action=discover, then put it first.
  superintendentPaths: ['Superintendent.Name', 'Superintendent', 'ProjectManager.Name', 'ProjectManager', 'Manager.Name', 'Foreman.Name'],
  // Days a milestone may drift before it counts as a change.
  noiseDays: 2,
  // All three milestones moving within this many days of each other = "Moved".
  moveToleranceDays: 3,
  // Jobs this many days past Substantial Completion become archive candidates.
  archiveAfterDays: 30,
  // Innergy statuses that mean the job is over (hidden from the book).
  closedStatuses: ['closed', 'cancel'],
  // Keep daily snapshots this long.
  snapshotRetentionDays: 400,
};

function settingsWithDefaults(s) {
  return Object.assign({}, DEFAULT_SETTINGS, s || {});
}

// ── Helpers ────────────────────────────────────────────────────────────────
function pick(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Innergy dates arrive as ISO strings ("2026-03-23T00:00:00") or already-ISO
 *  dates; normalise to "YYYY-MM-DD" or null. */
function toISODate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
}

function minDate(list) { const l = list.filter(Boolean).sort(); return l.length ? l[0] : null; }
function maxDate(list) { const l = list.filter(Boolean).sort(); return l.length ? l[l.length - 1] : null; }

function woType(wo)   { return String(wo.Type || wo.type || '').toLowerCase(); }
function woName(wo)   { return String(wo.Name || wo.name || '').toLowerCase(); }
function woStatus(wo) { return String(wo.Status || wo.status || '').toLowerCase(); }
function woStart(wo)  { return toISODate(wo.PlannedStartDate || wo.plannedStartDate); }
function woCrit(wo)   { return toISODate(wo.PlannedCriticalDate || wo.plannedCriticalDate); }
function woShip(wo)   { return toISODate(wo.PlannedShipmentDate || wo.ShipmentDate || wo.shipmentDate); }

// ── Milestones ─────────────────────────────────────────────────────────────
/**
 * Derive { firstFieldCheck, firstDelivery, substantialCompletion } from a
 * project's work orders. Cancelled WOs are ignored.
 *
 *  firstFieldCheck      = earliest planned start of a field-check WO
 *  firstDelivery        = earliest planned shipment of any WO
 *                         (fallback: earliest install WO planned start)
 *  substantialCompletion= latest planned critical date of an install WO
 *                         (fallback: latest critical date of any WO)
 *
 * Also returns `source` so the UI can show which rule produced each date.
 */
function deriveMilestones(workOrders, settings) {
  const s = settingsWithDefaults(settings);
  const live = (workOrders || []).filter(w => !woStatus(w).includes('cancel'));

  const isFieldCheck = w => s.fieldCheckPatterns.some(p => woType(w).includes(p) || woName(w).includes(p));
  const isInstall    = w => s.installTypes.some(t => woType(w) === t || woType(w).includes(t));

  const fieldChecks = live.filter(isFieldCheck);
  const installs    = live.filter(isInstall);

  const firstFieldCheck = minDate(fieldChecks.map(woStart));

  let firstDelivery = minDate(live.map(woShip));
  let deliverySource = 'min PlannedShipmentDate (all WOs)';
  if (!firstDelivery) {
    firstDelivery = minDate(installs.map(woStart));
    deliverySource = 'min PlannedStartDate (Installation WOs) — no shipment dates';
  }

  let substantialCompletion = maxDate(installs.map(woCrit));
  let completionSource = 'max PlannedCriticalDate (Installation WOs)';
  if (!substantialCompletion) {
    substantialCompletion = maxDate(live.map(woCrit));
    completionSource = 'max PlannedCriticalDate (all WOs) — no Installation WOs';
  }

  return {
    firstFieldCheck,
    firstDelivery,
    substantialCompletion,
    source: {
      firstFieldCheck: fieldChecks.length ? `min PlannedStartDate (${fieldChecks.length} field-check WO${fieldChecks.length === 1 ? '' : 's'})` : 'no field-check WO found',
      firstDelivery: firstDelivery ? deliverySource : 'no dates',
      substantialCompletion: substantialCompletion ? completionSource : 'no dates',
    },
    counts: { workOrders: live.length, installs: installs.length, fieldChecks: fieldChecks.length },
  };
}

/** Superintendent name from the Innergy project object, if any path resolves. */
function deriveSuperintendent(project, settings) {
  const s = settingsWithDefaults(settings);
  for (const p of s.superintendentPaths) {
    const v = pick(project, p);
    if (typeof v === 'string' && v.trim()) return { name: v.trim(), path: p };
  }
  return { name: '', path: '' };
}

// ── Variance ───────────────────────────────────────────────────────────────
/**
 * Compare current vs baseline milestones.
 * Returns { type, deltas:{firstFieldCheck,firstDelivery,substantialCompletion},
 *           installDelta, summary }
 *
 * type ∈ 'on-plan' | 'moved' | 'slip' | 'compressed' | 'accelerated' | 'no-baseline'
 *
 *  moved       all three shifted the same way, by about the same amount
 *  compressed  the install window (delivery → completion) got shorter
 *  slip        completion got later (and the window did not shrink)
 *  accelerated something got earlier, nothing got later
 */
function classifyVariance(current, baseline, settings) {
  const s = settingsWithDefaults(settings);
  const keys = ['firstFieldCheck', 'firstDelivery', 'substantialCompletion'];
  if (!baseline) return { type: 'no-baseline', deltas: {}, installDelta: null, summary: 'No baseline yet' };

  const deltas = {};
  keys.forEach(k => { deltas[k] = daysBetween(baseline[k], current[k]); });
  const known = keys.filter(k => deltas[k] != null);
  const sig   = known.filter(k => Math.abs(deltas[k]) > s.noiseDays);

  const curWin  = daysBetween(current.firstDelivery,  current.substantialCompletion);
  const baseWin = daysBetween(baseline.firstDelivery, baseline.substantialCompletion);
  const installDelta = (curWin != null && baseWin != null) ? curWin - baseWin : null;

  if (!sig.length) return { type: 'on-plan', deltas, installDelta, summary: 'Within tolerance of baseline' };

  const vals = sig.map(k => deltas[k]);
  const allSameDir = vals.every(v => v > 0) || vals.every(v => v < 0);
  const spread = Math.max(...vals) - Math.min(...vals);
  if (sig.length === known.length && known.length >= 2 && allSameDir && spread <= s.moveToleranceDays) {
    const d = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    return { type: 'moved', deltas, installDelta, summary: `Whole project moved ${d > 0 ? 'later' : 'earlier'} ${Math.abs(d)} d` };
  }
  if (installDelta != null && installDelta < -s.noiseDays) {
    return { type: 'compressed', deltas, installDelta, summary: `Install window shrank ${Math.abs(installDelta)} d` };
  }
  if ((deltas.substantialCompletion || 0) > s.noiseDays) {
    return { type: 'slip', deltas, installDelta, summary: `Completion pushed ${deltas.substantialCompletion} d` };
  }
  if (vals.some(v => v < 0) && !vals.some(v => v > 0)) {
    const d = Math.min(...vals);
    return { type: 'accelerated', deltas, installDelta, summary: `Pulled in ${Math.abs(d)} d` };
  }
  return { type: 'slip', deltas, installDelta, summary: 'Dates moved later' };
}

module.exports = {
  DEFAULT_SETTINGS, settingsWithDefaults,
  toISODate, daysBetween, pick,
  deriveMilestones, deriveSuperintendent, classifyVariance,
};
