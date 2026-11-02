// project-book.js — Master Project Book view (ADH Site Audit)
// Loaded by index.html next to pdf-export.js. Uses the app's globals:
// makeModal/closeModal/showToast/_htmlEsc/route/isAdmin/XLSX and CSS vars.
//
// Data comes from /api/projectBook (see api/projectBook/index.js). This file
// only renders and sends actions; every rule (milestones, variance, archive)
// lives server-side so the schedule sync and the UI can never disagree.

(function () {
  'use strict';

  const API = '/api/projectBook';
  const DAY = 86400000;
  const MS = ['firstFieldCheck', 'firstDelivery', 'substantialCompletion'];
  const MS_LABEL = { firstFieldCheck: 'First Field Check', firstDelivery: 'First Delivery', substantialCompletion: 'Substantial Completion' };
  const TYPE_LABEL = { 'on-plan': 'On plan', slip: 'Slip', compressed: 'Compressed', accelerated: 'Accelerated', moved: 'Moved', 'no-baseline': 'No baseline', new: 'New' };

  // ── state ──
  let book = null;              // last /api/projectBook payload
  let loading = false;
  const ui = { view: 'gantt', superFilter: '', showArchived: false, showBaseline: true, rangeMonths: 14 };

  // ── styles (injected once; never touches the app's structural CSS) ──
  function ensureStyles() {
    if (document.getElementById('pb-styles')) return;
    const s = document.createElement('style');
    s.id = 'pb-styles';
    s.textContent = `
.pb-wrap{--pb-warn:#b45309;--pb-purple:#7e22ce;--pb-blue:#1d4ed8;display:flex;flex-direction:column;gap:14px;padding:14px;overflow:auto;flex:1;min-height:0}
.pb-wrap>*{flex-shrink:0}
.pb-head{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 20px}
.pb-head h2{margin:0;font-size:20px;font-weight:700}
.pb-sub{font-size:12px;color:var(--text2)}
.pb-actions{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}
.pb-btn{height:36px;padding:0 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:inherit;font-weight:600;font-size:12px;cursor:pointer}
.pb-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.pb-btn:disabled{opacity:.5;cursor:default}
.pb-alert{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);font-size:12.5px}
.pb-alert.new{border-color:rgba(245,158,11,.5);background:rgba(245,158,11,.10)}
.pb-alert.err{border-color:rgba(220,38,38,.5);background:rgba(220,38,38,.08)}
.pb-alert .grow{flex:1 1 280px}
.pb-kpis{display:flex;flex-wrap:wrap;gap:10px}
.pb-kpi{flex:1 1 130px;min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.pb-kpi .l{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text2)}
.pb-kpi .v{font-size:24px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
.pb-kpi .s{font-size:11px;color:var(--text2)}
.pb-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.pb-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border)}
.pb-seg{display:flex;gap:2px;background:var(--surface2);border-radius:9px;padding:3px}
.pb-seg button{height:30px;padding:0 12px;border:none;border-radius:7px;background:transparent;color:var(--text);font-family:inherit;font-weight:500;font-size:12px;cursor:pointer}
.pb-seg button.on{background:var(--accent);color:#fff;font-weight:600}
.pb-toolbar label{display:flex;align-items:center;gap:6px;font-size:12px}
.pb-toolbar select{height:30px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-family:inherit;font-weight:500;font-size:12px;padding:0 8px}
.pb-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--text2);margin-left:auto}
.pb-legend span{display:flex;align-items:center;gap:5px}
.pb-sw{width:16px;height:9px;border-radius:2px;display:inline-block}
.pb-scroll{overflow-x:auto}
.pb-gantt{min-width:1000px}
.pb-row{display:flex;border-top:1px solid var(--border);height:46px}
.pb-row.sup{height:auto;background:var(--surface2)}
.pb-row.hdr{height:26px;border-top:none}
.pb-left{width:330px;flex:none;padding:6px 12px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0}
.pb-left .n{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb-left .m{display:flex;gap:8px;align-items:center;font-size:11px;color:var(--text2)}
.pb-row.sup .pb-left{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:6px 12px}
.pb-right{flex:1 1 0;min-width:0;position:relative}
.pb-month{position:absolute;top:0;bottom:0;border-left:1px solid var(--border);font-size:10.5px;color:var(--text2);padding:5px 0 0 5px;box-sizing:border-box;white-space:nowrap;overflow:hidden}
.pb-grid{position:absolute;top:0;bottom:0;border-left:1px solid var(--border);opacity:.5}
.pb-today{position:absolute;top:0;bottom:0;border-left:2px solid #f59e0b}
.pb-bar{position:absolute;top:10px;height:15px}
.pb-bar.pre{background:var(--border);border-radius:4px 0 0 4px}
.pb-bar.ins{background:var(--accent);border-radius:0 4px 4px 0}
.pb-bar.ghost{top:29px;height:7px;border:1.5px dashed var(--text2);border-radius:4px;box-sizing:border-box}
.pb-mk{position:absolute;top:8px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid #f59e0b;margin-left:-5px}
.pb-chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:600;white-space:nowrap}
.pb-chip.on-plan{color:var(--text2);background:var(--surface2);border:1px solid var(--border)}
.pb-chip.slip{color:#9a3f00;background:#ffe8d6}
.pb-chip.compressed{color:#6b2fa0;background:#efe3fb}
.pb-chip.accelerated{color:#0b5cad;background:#dcebfb}
.pb-chip.moved{color:#0e6b5e;background:#d7f2ec}
.pb-chip.new{color:#8a5a00;background:#fff1c2}
.pb-chip.no-baseline{color:var(--text2);background:var(--surface2);border:1px dashed var(--border)}
.pb-chip.archived{color:var(--text2);background:var(--surface2);border:1px solid var(--border);text-decoration:line-through}
.pb-table{width:100%;min-width:900px;border-collapse:collapse;font-size:12.5px}
.pb-table th{text-align:left;padding:8px 10px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text2);background:var(--surface2)}
.pb-table td{padding:8px 10px;border-top:1px solid var(--border);vertical-align:middle}
.pb-table td.num,.pb-table th.num{text-align:right;font-variant-numeric:tabular-nums}
.pb-table tr.click{cursor:pointer}.pb-table tr.click:hover td{background:var(--surface2)}
.pb-two{display:flex;flex-wrap:wrap;gap:14px}
.pb-two>.pb-card{flex:1 1 380px;padding:12px}
.pb-card h3{margin:0 0 8px;font-size:14px;font-weight:700}
.pb-line{display:flex;gap:10px;padding:6px 0;border-top:1px solid var(--border);font-size:12px}
.pb-line .t{color:var(--text2);width:118px;flex:none;font-variant-numeric:tabular-nums}
.pb-line .r{margin-left:auto;font-weight:700}
.pb-empty{padding:28px;text-align:center;color:var(--text2);font-size:12.5px}
.pb-form label{display:block;font-size:12px;margin:8px 0 4px;color:var(--text2)}
.pb-form input,.pb-form textarea{width:100%;box-sizing:border-box;height:34px;border:1px solid var(--border);border-radius:7px;background:var(--surface2);color:var(--text);padding:0 8px;font:inherit}
.pb-form textarea{height:auto;min-height:70px;padding:8px}
.pb-check{display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 0}
body.theme-dark .pb-wrap{--pb-warn:#fbbf24;--pb-purple:#c084fc;--pb-blue:#60a5fa}
html.is-phone .pb-left{width:200px}
html.is-phone .pb-head h2{font-size:17px}
`;
    document.head.appendChild(s);
  }

  // ── helpers ──
  const esc = s => (typeof _htmlEsc === 'function' ? _htmlEsc(s) : String(s == null ? '' : s));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t); };
  const fmt = iso => iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}` : '—';
  const fmtTs = iso => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const signed = n => n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + ' d';
  const chip = (t, label) => `<span class="pb-chip ${esc(t)}">${esc(label || TYPE_LABEL[t] || t)}</span>`;
  const supersOf = j => (j.super && j.super.manual && j.super.manual.length) ? j.super.manual : ((j.super && j.super.names) || []);
  const jobsArr = () => book ? Object.values(book.jobs) : [];
  const jobById = id => book && book.jobs[id];
  const activeJobs = () => jobsArr().filter(j => !j.archived);

  async function api(action, body, method, extraQuery) {
    const res = await fetch(API + '?action=' + encodeURIComponent(action) + (extraQuery || ''), body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: method || 'GET' });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  async function load() {
    loading = true; paint();
    try { book = await api('state'); }
    catch (e) { book = null; toast('Project Book: ' + e.message, 'red'); }
    loading = false; paint();
  }

  async function act(action, body, okMsg) {
    try {
      book = await api(action, body || { trigger: 'manual' });
      if (okMsg) toast(okMsg, 'green');
      paint();
    } catch (e) { toast(e.message, 'red'); }
  }

  // ── navigation hooks used by index.html ──
  window.navToProjectBook = function () {
    stack = [{ view: 'pbook' }];
    render();
  };

  window.buildProjectBookView = function () {
    ensureStyles();
    const el = document.getElementById('v-pbook'); if (!el) return;
    if (!book && !loading) load(); else paint();
  };

  window.pbUI = function (k, v) { ui[k] = v; paint(); };
  let syncing = false;
  window.pbSync = async () => {
    if (syncing) return;
    syncing = true; paint();
    toast('Syncing with Innergy…');
    await act('sync', { trigger: 'manual' }, 'Synced with Innergy');
    syncing = false; paint();
  };
  window.pbAck = id => act('acknowledge', { jobId: id });
  window.pbAckAll = () => act('acknowledge', { all: true });
  window.pbArchive = id => act('archive', { jobId: id }, 'Archived (hidden, not deleted)');
  window.pbRestore = id => act('restore', { jobId: id }, 'Restored');
  window.pbRestoreBackup = () => { if (confirm('Roll the Project Book back to the previous saved version?')) act('restoreBackup', {}, 'Restored from backup'); };

  // ── modals ──
  window.pbAssign = function (id) {
    const j = jobById(id); if (!j) return;
    const cur = supersOf(j);
    const rows = book.roster.map(n => `<label class="pb-check"><input type="checkbox" value="${esc(n)}" ${cur.includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('');
    makeModal('Assign superintendent', `
      <div style="font-size:12px;color:var(--text2);margin-bottom:6px">${esc(j.number)} ${esc(j.name)}${j.super && j.super.raw ? ` · Innergy says: <strong>${esc(j.super.raw)}</strong>` : ''}</div>
      <div id="pb-assign">${rows || '<div class="pb-empty">Roster is empty — add names in Settings</div>'}</div>`,
      () => {
        const names = [...document.querySelectorAll('#pb-assign input:checked')].map(i => i.value);
        closeModal();
        act('assign', { jobId: id, names }, 'Superintendent saved');
      });
  };

  window.pbBaseline = function (id) {
    const j = jobById(id); if (!j) return;
    const b = j.baseline || {}; const c = j.current || {};
    makeModal('Set baseline', `
      <div class="pb-form">
        <div style="font-size:12px;color:var(--text2)">${esc(j.number)} ${esc(j.name)} · current baseline: ${b.source ? esc(b.source) + ' (' + fmt(b.setAt) + ')' : 'none'}</div>
        ${MS.map(k => `<label>${MS_LABEL[k]} <span style="opacity:.7">(now ${fmt(c[k])})</span></label><input type="date" id="pb-b-${k}" value="${esc(b[k] || c[k] || '')}">`).join('')}
        <label>Note</label><input id="pb-b-note" placeholder="e.g. GC contract schedule rev 2">
        <label class="pb-check"><input type="checkbox" id="pb-b-cur"> Just use today's Innergy dates as the baseline</label>
      </div>`,
      () => {
        const fromCurrent = document.getElementById('pb-b-cur').checked;
        const body = { jobId: id, note: document.getElementById('pb-b-note').value };
        if (fromCurrent) body.fromCurrent = true;
        else MS.forEach(k => { body[k] = document.getElementById('pb-b-' + k).value || null; });
        closeModal();
        act('baseline', body, 'Baseline saved');
      });
  };

  window.pbSettings = function () {
    const s = book.summary.settings;
    makeModal('Project Book settings', `
      <div class="pb-form">
        <label>Superintendent roster (one per line)</label>
        <textarea id="pb-s-roster" style="min-height:140px">${esc(book.roster.join('\n'))}</textarea>
        <label>Field-check work-order patterns (comma separated)</label><input id="pb-s-fc" value="${esc(s.fieldCheckPatterns.join(', '))}">
        <label>Innergy fields to try for the superintendent (comma separated, first match wins)</label><input id="pb-s-sp" value="${esc(s.superintendentPaths.join(', '))}">
        <label>Ignore date moves up to (days)</label><input id="pb-s-noise" type="number" min="0" value="${s.noiseDays}">
        <label>Archive jobs this many days after Substantial Completion</label><input id="pb-s-arch" type="number" min="0" value="${s.archiveAfterDays}">
        ${typeof isAdmin !== 'undefined' && isAdmin ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="pb-btn" onclick="pbDiscover()">Show raw Innergy fields</button><button class="pb-btn" onclick="pbRestoreBackup()">Restore previous version</button></div>` : ''}
      </div>`,
      () => {
        const split = v => v.split(',').map(x => x.trim()).filter(Boolean);
        const val = id => document.getElementById(id).value;
        const body = {
          roster: val('pb-s-roster').split('\n').map(x => x.trim()).filter(Boolean),
          settings: {
            fieldCheckPatterns: split(val('pb-s-fc')),
            superintendentPaths: split(val('pb-s-sp')),
            noiseDays: +val('pb-s-noise') || 0,
            archiveAfterDays: +val('pb-s-arch') || 0,
          },
        };
        closeModal();
        act('settings', body, 'Settings saved');
      });
  };

  window.pbDiscover = async function () {
    makeModal('Raw Innergy fields', '<div class="pb-empty">Reading one project from Innergy…</div>', null, true);
    try {
      const d = await api('discover');
      const body = document.querySelector('#modal-overlay .modal-body');
      if (body) body.innerHTML = `<div style="font-size:12px;color:var(--text2);margin-bottom:6px">Use these names in Settings → superintendent fields / field-check patterns.</div>
        <pre style="font-size:11px;white-space:pre-wrap;max-height:60vh;overflow:auto;background:var(--surface2);padding:10px;border-radius:8px">${esc(JSON.stringify({
          projectKeys: d.projectKeys, workOrderTypes: d.workOrderTypes, workOrderKeys: d.workOrderKeys,
          superintendentGuess: d.superintendentGuess, milestonesGuess: d.milestonesGuess, sampleProject: d.sampleProject,
        }, null, 2))}</pre>`;
    } catch (e) { toast(e.message, 'red'); }
  };

  window.pbHistory = async function (id) {
    const j = jobById(id); if (!j) return;
    makeModal(`${esc(j.number)} ${esc(j.name)} — history`, '<div class="pb-empty">Loading…</div>', null, true);
    try {
      const h = await api('history', null, 'GET', '&jobId=' + encodeURIComponent(id));
      const body = document.querySelector('#modal-overlay .modal-body');
      const rows = (h.points || []).map(p => `<tr><td>${fmt(p.date)}</td>${MS.map(k => `<td>${fmt(p.current && p.current[k])}</td>`).join('')}<td>${esc((p.super || []).join(' / '))}</td></tr>`).join('');
      if (body) body.innerHTML = `
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px">Baseline: ${j.baseline ? MS.map(k => fmt(j.baseline[k])).join(' · ') + ' (' + esc(j.baseline.source) + ')' : 'none'} · Dates come from: ${j.source ? MS.map(k => esc(j.source[k])).join('; ') : '—'}</div>
        <div class="pb-scroll"><table class="pb-table" style="min-width:0"><thead><tr><th>Snapshot</th>${MS.map(k => `<th>${MS_LABEL[k]}</th>`).join('')}<th>Super</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="pb-empty">No snapshots yet</td></tr>'}</tbody></table></div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="pb-btn" onclick="closeModal();pbAssign('${esc(id)}')">Assign super</button>
          <button class="pb-btn" onclick="closeModal();pbBaseline('${esc(id)}')">Set baseline</button>
          ${j.archived ? `<button class="pb-btn" onclick="closeModal();pbRestore('${esc(id)}')">Restore</button>` : `<button class="pb-btn" onclick="closeModal();pbArchive('${esc(id)}')">Archive</button>`}
        </div>`;
    } catch (e) { toast(e.message, 'red'); }
  };

  window.pbExport = function () {
    if (typeof XLSX === 'undefined') { toast('Spreadsheet library not loaded', 'red'); return; }
    const jobs = visibleJobs();
    const rows = jobs.map(j => ({
      'Job #': j.number, 'Job Name': j.name, 'Superintendent': supersOf(j).join(' / '),
      'First Field Check': j.current && j.current.firstFieldCheck || '', 'First Delivery': j.current && j.current.firstDelivery || '', 'Substantial Completion': j.current && j.current.substantialCompletion || '',
      'Baseline FFC': j.baseline && j.baseline.firstFieldCheck || '', 'Baseline Delivery': j.baseline && j.baseline.firstDelivery || '', 'Baseline SC': j.baseline && j.baseline.substantialCompletion || '',
      'Change': j.variance ? TYPE_LABEL[j.variance.type] : '', 'Δ SC (days)': j.variance && j.variance.deltas ? j.variance.deltas.substantialCompletion : '',
      'Client': j.client, 'Innergy Status': j.status, 'Archived': j.archived ? 'yes' : '',
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Job Entry');
    const log = XLSX.utils.json_to_sheet((book.log || []).map(l => ({ When: l.at, Kind: l.kind, What: l.msg })));
    XLSX.utils.book_append_sheet(wb, log, 'Changes');
    XLSX.writeFile(wb, `Master_Project_Book_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── render ──
  function visibleJobs() {
    let jobs = ui.showArchived ? jobsArr() : activeJobs();
    if (ui.superFilter) jobs = jobs.filter(j => ui.superFilter === '__none' ? !supersOf(j).length : supersOf(j).includes(ui.superFilter));
    return jobs.sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  }

  function paint() {
    const el = document.getElementById('v-pbook'); if (!el) return;
    if (typeof route === 'function' && route().view !== 'pbook') return;
    if (loading && !book) { el.innerHTML = '<div class="pb-empty">Loading the Project Book…</div>'; return; }
    if (!book) { el.innerHTML = `<div class="pb-empty">Could not load the Project Book.<br><br><button class="pb-btn" onclick="buildProjectBookView()">Retry</button></div>`; return; }

    const S = book.summary, H = S.health;
    const ls = book.lastSync;
    const syncTxt = ls ? `${ls.ok ? 'Synced' : 'Sync had errors'} ${fmtTs(ls.at)} (${ls.trigger})` : 'Never synced — press Sync Innergy';

    const newJobs = S.newJobs.map(jobById).filter(Boolean);
    const archCands = S.archiveCandidates.map(jobById).filter(Boolean);

    el.innerHTML = `<div class="pb-wrap">
      <div class="pb-head">
        <div><h2>📘 Master Project Book</h2><div class="pb-sub">Source: Innergy · ${S.activeJobs} active jobs · ${S.supersInUse} superintendents · ${esc(syncTxt)}</div></div>
        <div class="pb-actions">
          <button class="pb-btn primary" onclick="pbSync()" ${loading || syncing ? 'disabled' : ''}>${syncing ? 'Syncing…' : '⚡ Sync Innergy'}</button>
          <button class="pb-btn" onclick="pbExport()">Export .xlsx</button>
          <button class="pb-btn" onclick="pbSettings()">Settings</button>
        </div>
      </div>

      ${ls && !ls.ok ? `<div class="pb-alert err"><div class="grow"><strong>Last sync had ${ls.errors.length} problem${ls.errors.length === 1 ? '' : 's'}</strong> — previous dates were kept for those jobs. ${esc(ls.errors.slice(0, 3).join(' · '))}</div></div>` : ''}
      ${newJobs.length ? `<div class="pb-alert new"><div class="grow"><strong>${newJobs.length} new job${newJobs.length === 1 ? '' : 's'} from Innergy:</strong> ${newJobs.map(j => `${esc(j.number)} ${esc(j.name)}${supersOf(j).length ? '' : ' (no super)'}`).join(', ')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${newJobs.map(j => `<button class="pb-btn" onclick="pbAssign('${esc(j.innergyId)}')">Assign ${esc(j.number)}</button>`).join('')}<button class="pb-btn" onclick="pbAckAll()">Dismiss</button></div></div>` : ''}
      ${archCands.length ? `<div class="pb-alert"><div class="grow"><strong>${archCands.length} job${archCands.length === 1 ? '' : 's'} ready to archive</strong> (past Substantial Completion + ${S.settings.archiveAfterDays} d): ${archCands.map(j => `${esc(j.number)} ${esc(j.name)}`).join(', ')}. Archived jobs stay searchable; nothing is deleted.</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${archCands.map(j => `<button class="pb-btn" onclick="pbArchive('${esc(j.innergyId)}')">Archive ${esc(j.number)}</button>`).join('')}</div></div>` : ''}

      <div class="pb-kpis">
        ${kpi('Active jobs', S.activeJobs, `${newJobs.length} new · ${archCands.length} to archive`)}
        ${kpi('Superintendents', S.supersInUse, `${H.missingSuper.length} job${H.missingSuper.length === 1 ? '' : 's'} need a super`, H.missingSuper.length ? 'var(--pb-warn)' : '')}
        ${kpi('Changed vs baseline', (S.varianceByType.slip || 0) + (S.varianceByType.compressed || 0) + (S.varianceByType.accelerated || 0) + (S.varianceByType.moved || 0), `of ${S.activeJobs} jobs`)}
        ${kpi('Slipped', S.varianceByType.slip || 0, 'completion later', S.varianceByType.slip ? 'var(--pb-warn)' : '')}
        ${kpi('Compressed', S.varianceByType.compressed || 0, 'install window shorter', S.varianceByType.compressed ? 'var(--pb-purple)' : '')}
        ${kpi('Accelerated', S.varianceByType.accelerated || 0, 'pulled in', S.varianceByType.accelerated ? 'var(--pb-blue)' : '')}
      </div>

      <div class="pb-card">
        <div class="pb-toolbar">
          <div class="pb-seg">${['gantt', 'list', 'variance'].map(v => `<button class="${ui.view === v ? 'on' : ''}" onclick="pbUI('view','${v}')">${{ gantt: 'Gantt by super', list: 'Job list', variance: 'Variance' }[v]}</button>`).join('')}</div>
          <label>Super <select onchange="pbUI('superFilter',this.value)"><option value="">All</option><option value="__none" ${ui.superFilter === '__none' ? 'selected' : ''}>— Needs super —</option>${book.roster.map(n => `<option ${ui.superFilter === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <label><input type="checkbox" ${ui.showBaseline ? 'checked' : ''} onchange="pbUI('showBaseline',this.checked)"> Baseline</label>
          <label><input type="checkbox" ${ui.showArchived ? 'checked' : ''} onchange="pbUI('showArchived',this.checked)"> Archived (${S.archivedJobs})</label>
          <div class="pb-legend"><span><i class="pb-sw" style="background:var(--border)"></i>Field check → delivery</span><span><i class="pb-sw" style="background:var(--accent)"></i>Delivery → completion</span><span><i class="pb-sw" style="height:0;border-top:2px dashed var(--text2)"></i>Baseline</span><span><i class="pb-sw" style="width:2px;background:#f59e0b"></i>Today</span></div>
        </div>
        ${ui.view === 'gantt' ? gantt() : ui.view === 'list' ? list() : variance()}
      </div>

      <div class="pb-two">
        <div class="pb-card"><h3>Recent changes</h3>${(book.log || []).slice(0, 12).map(l => `<div class="pb-line"><span class="t">${fmtTs(l.at)}</span><span>${esc(l.msg)}</span></div>`).join('') || '<div class="pb-empty">Nothing yet</div>'}</div>
        <div class="pb-card"><h3>Data health</h3>
          ${healthLine('Jobs missing a superintendent', H.missingSuper.length)}
          ${healthLine('Jobs missing milestone dates', H.missingDates.length)}
          ${healthLine('Dates out of order (delivery after completion)', H.datesOutOfOrder.length)}
          ${healthLine('Super names not on roster', H.unresolvedSupers.length, H.unresolvedSupers.map(u => u.tokens.join('/')).join(', '))}
          ${healthLine('Hours since last sync', H.syncAgeHours == null ? '—' : H.syncAgeHours, '', H.syncAgeHours > 30)}
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="pb-btn" onclick="pbUI('superFilter','__none')">Show jobs needing a super</button>${typeof isAdmin !== 'undefined' && isAdmin ? `<button class="pb-btn" onclick="pbRestoreBackup()">Restore previous version</button>` : ''}</div>
        </div>
      </div>
    </div>`;
  }

  function kpi(l, v, s, color) {
    return `<div class="pb-kpi"><div class="l">${l}</div><div class="v" ${color ? `style="color:${color}"` : ''}>${v}</div><div class="s">${s}</div></div>`;
  }
  function healthLine(label, n, detail, warnOverride) {
    const warn = warnOverride != null ? warnOverride : (typeof n === 'number' && n > 0);
    return `<div class="pb-line"><span>${label}${detail ? ` <span style="color:var(--text2)">(${esc(detail)})</span>` : ''}</span><span class="r" ${warn ? 'style="color:var(--pb-warn)"' : ''}>${n}</span></div>`;
  }

  // ── Gantt ──
  function gantt() {
    const jobs = visibleJobs();
    if (!jobs.length) return '<div class="pb-empty">No jobs to show. Press ⚡ Sync Innergy to pull the current list.</div>';
    const t0 = new Date(); t0.setDate(1); t0.setHours(0, 0, 0, 0);
    const t1 = new Date(t0); t1.setMonth(t1.getMonth() + ui.rangeMonths);
    const span = t1 - t0;
    const pct = iso => { if (!iso) return null; const d = Date.parse(iso + 'T00:00:00'); return Math.max(0, Math.min(100, (d - t0) / span * 100)); };
    const months = []; for (let d = new Date(t0); d < t1; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
    const monthCells = months.map(d => `<div class="pb-month" style="left:${(d - t0) / span * 100}%">${d.toLocaleString(undefined, { month: 'short', year: '2-digit' })}</div>`).join('');
    const gridLines = months.map(d => `<div class="pb-grid" style="left:${(d - t0) / span * 100}%"></div>`).join('');
    const today = `<div class="pb-today" style="left:${(Date.now() - t0) / span * 100}%"></div>`;

    const bar = (m, ghost) => {
      if (!m) return '';
      const l1 = pct(m.firstFieldCheck), l2 = pct(m.firstDelivery), l3 = pct(m.substantialCompletion);
      const a = l1 != null ? l1 : l2, b = l3 != null ? l3 : l2;
      if (a == null || b == null) return '';
      if (ghost) return `<div class="pb-bar ghost" style="left:${a}%;width:${Math.max(b - a, .4)}%"></div>`;
      let h = '';
      if (l1 != null && l2 != null) h += `<div class="pb-bar pre" style="left:${l1}%;width:${Math.max(l2 - l1, .3)}%"></div>`;
      if (l2 != null && l3 != null) h += `<div class="pb-bar ins" style="left:${l2}%;width:${Math.max(l3 - l2, .3)}%"></div>`;
      [l1, l2].forEach(x => { if (x != null) h += `<div class="pb-mk" style="left:${x}%"></div>`; });
      return h;
    };

    // group by super (multi-super jobs appear under each; none → "Super needed")
    const groups = new Map();
    jobs.forEach(j => { const ss = supersOf(j); (ss.length ? ss : ['Super needed']).forEach(s => { if (!groups.has(s)) groups.set(s, []); groups.get(s).push(j); }); });
    const order = [...groups.keys()].sort((a, b) => (a === 'Super needed') - (b === 'Super needed') || a.localeCompare(b));

    let rows = '';
    order.forEach(s => {
      const js = groups.get(s);
      rows += `<div class="pb-row sup"><div class="pb-left">${esc(s)} <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--text2)">· ${js.length} job${js.length === 1 ? '' : 's'}</span></div><div class="pb-right"></div></div>`;
      js.forEach(j => {
        const t = j.archived ? 'archived' : (!j.acknowledged ? 'new' : (j.variance && j.variance.type) || 'no-baseline');
        const noDates = !j.current || (!j.current.firstDelivery && !j.current.substantialCompletion);
        rows += `<div class="pb-row"><div class="pb-left" style="cursor:pointer" onclick="pbHistory('${esc(j.innergyId)}')"><div class="n" title="${esc(j.name)}">${esc(j.name)}</div><div class="m"><span>${esc(j.number)}</span>${chip(t, j.archived ? 'Archived' : null)}</div></div>
          <div class="pb-right">${gridLines}${today}${noDates ? `<div style="position:absolute;left:8px;top:13px;font-size:11px;color:var(--pb-warn)">No milestone dates in Innergy yet</div>` : bar(j.current) + (ui.showBaseline && j.baseline ? bar(j.baseline, true) : '')}</div></div>`;
      });
    });
    return `<div class="pb-scroll"><div class="pb-gantt"><div class="pb-row hdr"><div class="pb-left" style="font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text2)">Superintendent / Job</div><div class="pb-right">${monthCells}</div></div>${rows}</div></div>`;
  }

  // ── Job list ──
  function list() {
    const jobs = visibleJobs();
    if (!jobs.length) return '<div class="pb-empty">No jobs to show.</div>';
    return `<div class="pb-scroll"><table class="pb-table"><thead><tr><th>Job #</th><th>Job</th><th>Superintendent</th>${MS.map(k => `<th>${MS_LABEL[k]}</th>`).join('')}<th>Change</th><th>Client</th><th></th></tr></thead><tbody>
      ${jobs.map(j => `<tr class="click" onclick="pbHistory('${esc(j.innergyId)}')"><td>${esc(j.number)}</td><td><strong>${esc(j.name)}</strong></td><td>${esc(supersOf(j).join(' / ')) || '<span style="color:var(--pb-warn)">needs super</span>'}</td>${MS.map(k => `<td>${fmt(j.current && j.current[k])}</td>`).join('')}<td>${chip(j.archived ? 'archived' : (j.variance && j.variance.type) || 'no-baseline', j.archived ? 'Archived' : null)}</td><td>${esc(j.client)}</td><td><button class="pb-btn" style="height:28px;padding:0 10px" onclick="event.stopPropagation();pbAssign('${esc(j.innergyId)}')">Super</button></td></tr>`).join('')}
    </tbody></table></div>`;
  }

  // ── Variance ──
  function variance() {
    const jobs = visibleJobs().filter(j => j.variance && !['on-plan', 'no-baseline'].includes(j.variance.type));
    if (!jobs.length) return '<div class="pb-empty">Every job is within tolerance of its baseline.</div>';
    const rows = [];
    jobs.forEach(j => {
      const d = j.variance.deltas || {};
      MS.forEach(k => {
        if (d[k] == null || Math.abs(d[k]) <= book.summary.settings.noiseDays) return;
        rows.push(`<tr class="click" onclick="pbHistory('${esc(j.innergyId)}')"><td>${esc(j.number)}</td><td><strong>${esc(j.name)}</strong></td><td>${esc(supersOf(j).join(' / '))}</td><td>${MS_LABEL[k]}</td><td>${fmt(j.baseline[k])}</td><td>${fmt(j.current[k])}</td><td class="num"><strong>${signed(d[k])}</strong></td><td>${chip(j.variance.type)}</td><td style="color:var(--text2)">${esc(j.variance.summary)}</td></tr>`);
      });
    });
    return `<div class="pb-scroll"><table class="pb-table"><thead><tr><th>Job #</th><th>Job</th><th>Super</th><th>Milestone</th><th>Baseline</th><th>Current</th><th class="num">Δ</th><th>Type</th><th>What changed</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
})();
