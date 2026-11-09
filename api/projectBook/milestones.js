// api/projectBook/milestones.js
// Pure functions: Innergy project + work orders → the three Project Book
// milestones, and current-vs-baseline → a variance classification.
// No I/O here so the rules can be unit-tested and tuned without Azure.

const DAY = 86400000;

// ── Settings defaults ──────────────────────────────────────────────────────
// Everything a superintendent manager might want to tune lives in the state
// doc's `settings` and overrides these. Keep the shapes flat and JSON-only.
const DEFAULT_SETTINGS = {
  // Fallback only: work-order Type/Name patterns (case-insensitive) that count
  // as a field check, used when no work order has a Field Verified step date.
  fieldCheckPatterns: ['field check', 'field verif', 'field measure', 'site verif', 'site measure'],
  // Work-order types that make up the install window (delivery → completion).
  installTypes: ['installation', 'install'],
  // Where to look for the superintendent, first non-empty wins. Innergy has no
  // superintendent field, so these are the likely homes (check with
  // ?action=discover):
  //   Installers              a field on the project (people → their FullName)
  //   CustomFields:<name>     a project custom field, matched by name
  //   WO.<field>              that field on the job's Installation work orders
  superintendentPaths: ['CustomFields:superintendent', 'CustomFields:super', 'Installers', 'InstallerGroupEmployees', 'WO.Installers'],
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

/** Innergy people are { Id, FullName }; lists of them are arrays. → "A / B". */
function personName(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return [...new Set(v.map(personName).filter(Boolean))].join(' / ');
  if (typeof v === 'object') return personName(v.FullName || v.Name || v.Value || '');
  return '';
}

function customField(project, name) {
  const cf = (project && project.CustomFields) || [];
  const hit = cf.find(f => String(f.Name || '').toLowerCase() === String(name).toLowerCase());
  return hit ? personName(hit.Value) : '';
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
function woFieldVerified(wo) { return toISODate(wo.FieldVerifiedStepItemPlannedDate); }
function woReadyForFV(wo)    { return toISODate(wo.ReadyForFieldVerificationStepItemPlannedDate); }
function woCrit(wo)   { return toISODate(wo.PlannedCriticalDate || wo.plannedCriticalDate); }
function woShip(wo)   { return toISODate(wo.PlannedShipmentDate || wo.ShipmentDate || wo.shipmentDate); }

// ── Milestones ─────────────────────────────────────────────────────────────
/**
 * Derive { firstFieldCheck, firstDelivery, substantialCompletion }.
 *
 *  firstDelivery         = the project's own FirstDelivery date in Innergy
 *                          (fallback: earliest planned shipment of any WO,
 *                          then earliest Installation WO planned start)
 *  substantialCompletion = the project's own SubstantialCompletion date
 *                          (fallback: latest Installation WO critical date,
 *                          then latest critical date of any WO)
 *  firstFieldCheck       = earliest "Field Verified" step planned date on any
 *                          WO (fallback: "Ready for Field Verification" step,
 *                          then a WO whose type/name matches fieldCheckPatterns)
 *
 * `workOrders` may be null (not read this sync): only the project-level
 * dates are filled then, and the caller keeps the rest from last time.
 * Cancelled WOs are ignored. `source` says which rule produced each date.
 */
function deriveMilestones(workOrders, settings, project) {
  const s = settingsWithDefaults(settings);
  const haveWOs = Array.isArray(workOrders);
  const live = (workOrders || []).filter(w => !woStatus(w).includes('cancel'));
  const proj = project || {};

  const isFieldCheck = w => s.fieldCheckPatterns.some(p => woType(w).includes(p) || woName(w).includes(p));
  const isInstall    = w => s.installTypes.some(t => woType(w) === t || woType(w).includes(t));
  const fieldChecks = live.filter(isFieldCheck);
  const installs    = live.filter(isInstall);

  let firstFieldCheck = null, ffcSource = haveWOs ? 'no field verification date on any work order' : 'work orders not read';
  const fv = minDate(live.map(woFieldVerified));
  const rfv = minDate(live.map(woReadyForFV));
  const fcw = minDate(fieldChecks.map(woStart));
  if (fv)       { firstFieldCheck = fv;  ffcSource = 'earliest Field Verified step (planned) on the work orders'; }
  else if (rfv) { firstFieldCheck = rfv; ffcSource = 'earliest Ready for Field Verification step (planned)'; }
  else if (fcw) { firstFieldCheck = fcw; ffcSource = `earliest field-check work order start (${fieldChecks.length})`; }

  let firstDelivery = toISODate(proj.FirstDelivery), deliverySource = 'project First Delivery (Innergy)';
  if (!firstDelivery && haveWOs) {
    firstDelivery = minDate(live.map(woShip)); deliverySource = 'earliest planned shipment (work orders) — project First Delivery empty';
    if (!firstDelivery) { firstDelivery = minDate(installs.map(woStart)); deliverySource = 'earliest Installation work order start — no shipment dates'; }
  }

  let substantialCompletion = toISODate(proj.SubstantialCompletion), completionSource = 'project Substantial Completion (Innergy)';
  if (!substantialCompletion && haveWOs) {
    substantialCompletion = maxDate(installs.map(woCrit)); completionSource = 'latest Installation critical date — project Substantial Completion empty';
    if (!substantialCompletion) { substantialCompletion = maxDate(live.map(woCrit)); completionSource = 'latest critical date (all work orders) — no Installation work orders'; }
  }

  return {
    firstFieldCheck,
    firstDelivery,
    substantialCompletion,
    source: {
      firstFieldCheck: ffcSource,
      firstDelivery: firstDelivery ? deliverySource : (haveWOs ? 'no dates' : 'work orders not read'),
      substantialCompletion: substantialCompletion ? completionSource : (haveWOs ? 'no dates' : 'work orders not read'),
    },
    counts: haveWOs ? { workOrders: live.length, installs: installs.length, fieldChecks: fieldChecks.length } : null,
  };
}

/** Superintendent name(s) from Innergy: first settings path that yields one.
 *  See DEFAULT_SETTINGS.superintendentPaths for the path syntax. */
function deriveSuperintendent(project, settings, workOrders) {
  const s = settingsWithDefaults(settings);
  const installs = (workOrders || []).filter(w => !woStatus(w).includes('cancel') &&
    s.installTypes.some(t => woType(w).includes(t)));
  for (const raw of s.superintendentPaths) {
    const p = String(raw).trim();
    let v = '';
    if (/^CustomFields:/i.test(p)) v = customField(project, p.slice(13));
    else if (/^WO\./i.test(p)) v = personName(installs.map(w => pick(w, p.slice(3))));
    else v = personName(pick(project, p));
    if (v) return { name: v, path: p };
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
  toISODate, daysBetween, pick, personName,
  deriveMilestones, deriveSuperintendent, classifyVariance,
};
