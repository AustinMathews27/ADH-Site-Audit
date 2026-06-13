// pdf-export.js — ADH Field Audit Tool
// Drop this file next to index.html and add ONE line to index.html <head>:
//   <script src="pdf-export.js" defer></script>
// Then remove the exportPDF, showPDFProgress, updatePDFProgress, hidePDFProgress
// functions from index.html (they now live here).

(function () {
  'use strict';

  // ── 5 DISTINCT PDF TEMPLATES ─────────────────────────────────────────────────
  const PDF_TEMPLATES = {
    classic: {
      name: 'Classic',
      bgPage: '#ffffff', bgHeader: '#1e3a5f', bgRow: '#f8fafc', bgAlt: '#eef2f7',
      cHeader: '#ffffff', cTitle: '#1e3a5f', cText: '#334155', cSub: '#64748b',
      cAccent: '#1e3a5f', cBorder: '#cbd5e1', cTag: '#dbeafe', cTagText: '#1e40af',
      font: 'helvetica', coverGradient: ['#1e3a5f', '#2563eb'],
    },
    modern: {
      name: 'Modern',
      bgPage: '#0f172a', bgHeader: '#0f172a', bgRow: '#1e293b', bgAlt: '#0f172a',
      cHeader: '#38bdf8', cTitle: '#e2e8f0', cText: '#94a3b8', cSub: '#475569',
      cAccent: '#38bdf8', cBorder: '#334155', cTag: '#0c4a6e', cTagText: '#38bdf8',
      font: 'helvetica', coverGradient: ['#0f172a', '#1e293b'],
    },
    minimal: {
      name: 'Minimal',
      bgPage: '#ffffff', bgHeader: '#ffffff', bgRow: '#ffffff', bgAlt: '#f9fafb',
      cHeader: '#111827', cTitle: '#111827', cText: '#374151', cSub: '#9ca3af',
      cAccent: '#111827', cBorder: '#e5e7eb', cTag: '#f3f4f6', cTagText: '#6b7280',
      font: 'helvetica', coverGradient: ['#f3f4f6', '#e5e7eb'],
    },
    corporate: {
      name: 'Corporate',
      bgPage: '#f0fdf4', bgHeader: '#14532d', bgRow: '#ffffff', bgAlt: '#f0fdf4',
      cHeader: '#dcfce7', cTitle: '#14532d', cText: '#166534', cSub: '#4d7c0f',
      cAccent: '#16a34a', cBorder: '#bbf7d0', cTag: '#dcfce7', cTagText: '#14532d',
      font: 'helvetica', coverGradient: ['#14532d', '#166534'],
    },
    photographic: {
      name: 'Photographic',
      bgPage: '#fafafa', bgHeader: '#1c1c1c', bgRow: '#ffffff', bgAlt: '#f5f5f5',
      cHeader: '#f59e0b', cTitle: '#1c1c1c', cText: '#404040', cSub: '#737373',
      cAccent: '#d97706', cBorder: '#e5e5e5', cTag: '#fef3c7', cTagText: '#92400e',
      font: 'helvetica', coverGradient: ['#1c1c1c', '#374151'],
    },
  };

  const THEME_ALIAS = {
    classic: 'classic', modern: 'modern', minimal: 'minimal',
    corporate: 'corporate', photographic: 'photographic',
    bright: 'classic', financial: 'corporate', dark: 'modern',
  };

  function resolveTemplate(name) {
    return PDF_TEMPLATES[THEME_ALIAS[name] || 'classic'] || PDF_TEMPLATES.classic;
  }

  function statusColor(s) {
    return s === 'completed' ? '#22c55e' : s === 'punch-ongoing' ? '#a855f7' :
           s === 'not-ready' ? '#ef4444' : s === 'in-progress'   ? '#fbbf24' :
           s === 'on-hold'   ? '#f97316' : s === 'out-of-scope'  ? '#94a3b8' : '#6b7280';
  }
  function statusLabel(s) {
    return (s || 'pending').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // ── HTML LIVE PREVIEW (layout-accurate: mirrors the exported PDF) ────────────
  // Renders both layout variants (Branded Grid / Clean Flow) combined with 5 color themes.
  // Employs a pure CSS scale wrapper so 560px layouts responsively fit any Mobile or iPad screen.
  window.buildPDFPreviewHTML = function (proj, opts) {
    opts = opts || {};

    const layoutKey = (opts.layout === 'flow') ? 'flow' : 'grid';
    const themeKey  = opts.theme || 'classic';
    const tpl       = resolveTemplate(themeKey);

    // Map resolved template colors dynamically
    const P = {
      bg: tpl.bgPage, ink: tpl.cTitle, text: tpl.cText, sub: tpl.cSub,
      rule: tpl.cAccent, accent: tpl.cAccent, red: '#c0392b', border: tpl.cBorder, row: tpl.bgRow
    };

    const FCB = { FC:{bg:'#dcfce7',fg:'#166534'}, UFC:{bg:'#fef3c7',fg:'#92400e'}, NFC:{bg:'#fee2e2',fg:'#991b1b'}, HT:{bg:'#dbeafe',fg:'#1e40af'} };
    const siLbl = n => String(n||'').replace(/^SI\s+/i,'SI-');
    const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const capOf = ph => (ph && (ph.caption||ph.note||ph.label||'')) || '';
    const srcOf = ph => ph?.url || ph?._blobUrl || ph?.data || null;

    const inclCover  = opts.inclCover  !== false;
    const inclPhotos = opts.inclPhotos !== false;
    const inclNotes  = opts.inclNotes  !== false;
    const inclTags   = opts.inclTags   !== false;
    const reportTitle= opts.reportTitle || 'Site Conditions Report';
    const whiteLabel = opts.whiteLabel || false;
    const branding   = opts.branding   || {};
    const filter     = opts.filter     || 'all';
    const today      = new Date().toLocaleDateString();

    const allItems = (proj.items || []).filter(i => !i._deleted);
    const items = allItems.filter(i => {
      if (filter === 'complete')   return i.status === 'completed' || i.status === 'punch-ongoing';
      if (filter === 'incomplete') return i.status !== 'completed' && i.status !== 'punch-ongoing';
      return true;
    });
    const sections = proj.sections || [];

    const total     = items.length;
    const completed = items.filter(i => i.status === 'completed').length;
    const punch     = items.filter(i => i.status === 'punch-ongoing').length;
    const notReady  = items.filter(i => i.status === 'not-ready').length;
    const inProg    = items.filter(i => i.status === 'in-progress').length;
    const pending   = items.filter(i => i.status === 'pending').length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const logoImg = (h) => (!whiteLabel && branding.logo)
      ? `<img src="${branding.logo}" style="height:${h}px;max-width:170px;object-fit:contain;display:block">`
      : '';

    // ── Stats strip (shared) ──────────────────────────────────────────────────
    const statCells = [
      ['Total', total, P.sub], ['Completed', completed, '#16a34a'], ['Punch', punch, '#a855f7'],
      ['Not Ready', notReady, '#dc2626'], ['In Prog', inProg, '#d97706'], ['Pending', pending, '#6b7280'],
    ].map(([l,v,c]) => `
      <div style="flex:1;text-align:left;padding:7px 8px;background:${P.row};border:1px solid ${P.border};border-radius:4px">
        <div style="font-size:16px;font-weight:800;color:${c}">${v}</div>
        <div style="font-size:7px;color:${P.sub};margin-top:1px">${l}</div>
      </div>`).join('');
    const statsBlock = `
      <div style="display:flex;gap:5px">${statCells}</div>
      <div style="height:4px;background:${P.border};border-radius:2px;margin-top:8px">
        <div style="height:4px;width:${pct}%;background:${P.accent};border-radius:2px"></div>
      </div>`;

    const metaCols = [['Client',proj.client],['Company',proj.company],['Auditor',proj.auditor]]
      .filter(([,v]) => v).map(([l,v]) => `
        <div style="min-width:0">
          <div style="font-size:7px;font-weight:700;color:${P.sub};text-transform:uppercase;letter-spacing:0.5px">${l}</div>
          <div style="font-size:11px;color:${P.text};font-weight:600;margin-top:2px">${esc(v)}</div>
        </div>`).join('');

    // ── COVER ─────────────────────────────────────────────────────────────────
    let coverPage = '';
    if (inclCover && layoutKey === 'grid') {
      const coverPhoto = proj.coverPhoto
        ? `<div style="flex:0 0 165px"><img src="${proj.coverPhoto}" style="width:165px;height:218px;object-fit:cover;border:1px solid ${P.border};border-radius:3px;display:block"></div>` : '';
      coverPage = `
        <div class="page-container">
        <div class="page-scaler" style="padding:34px 37px">
          <div class="page-num">1</div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:${P.sub};text-transform:uppercase;margin-top:4px">${esc(reportTitle)}</div>
            ${logoImg(38)}
          </div>
          <div style="display:flex;gap:20px;margin-top:18px">
            <div style="flex:1;min-width:0">
              <div style="font-size:30px;font-weight:800;color:${P.ink};line-height:1.08">${esc(proj.name||'Untitled Project')}</div>
              <div style="height:5px;background:${P.rule};margin:12px 0 14px"></div>
              <div style="font-size:14px;font-weight:700;color:${P.text};margin-bottom:18px">${esc(proj.date||today)}</div>
              <div style="display:flex;flex-direction:column;gap:13px">${metaCols}</div>
            </div>
            ${coverPhoto}
          </div>
          <div style="margin-top:auto">${statsBlock}
            <div style="font-size:8px;color:${P.sub};margin-top:10px">Generated ${today}</div>
          </div>
        </div></div>`;
    } else if (inclCover && layoutKey === 'flow') {
      const bg = proj.coverPhoto
        ? `background-image:url('${proj.coverPhoto}');background-size:cover;background-position:center`
        : `background:${P.ink}`;
      coverPage = `
        <div class="page-container">
        <div class="page-scaler" style="padding:0">
          <div class="page-num" style="color:#fff">1</div>
          <div style="position:relative;height:470px;${bg}">
            <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,12,24,0.62),rgba(8,12,24,0.28) 32%,rgba(8,12,24,0.58))"></div>
            <div style="position:relative;padding:30px 37px">
              <div style="font-size:30px;font-weight:800;color:#fff;line-height:1.08">${esc(proj.name||'Untitled Project')}</div>
              <div style="font-size:9px;font-weight:600;letter-spacing:1.5px;color:#cbd5e1;text-transform:uppercase;margin-top:7px">${esc(reportTitle)}</div>
            </div>
            <div style="position:absolute;left:0;right:0;bottom:0;padding:22px 37px;display:flex;justify-content:space-between;align-items:flex-end;gap:12px">
              <div>${logoImg(30)}</div>
              <div style="color:#e2e8f0;font-weight:700;font-size:12px">${esc(proj.date||today)}</div>
            </div>
          </div>
          <div style="padding:24px 37px">
            <div style="display:flex;gap:24px">${metaCols}</div>
            <div style="margin-top:20px">${statsBlock}</div>
          </div>
        </div></div>`;
    }

    // ── Item renderer (shared body) ───────────────────────────────────────────
    function itemBlock(item) {
      const isDone = item.status === 'completed';
      const statusLine = isDone
        ? `<span style="color:${P.red};font-weight:700;font-size:11px">Completed: Yes</span>`
        : `<span style="color:${statusColor(item.status)};font-weight:700;font-size:11px">Status: ${statusLabel(item.status)}</span>`;

      let fc = '';
      if (item.statusCode) {
        const b = FCB[item.statusCode] || { bg:'#f3f4f6', fg:'#374151' };
        fc = `<span style="display:inline-block;background:${b.bg};color:${b.fg};font-weight:700;font-size:9px;padding:2px 7px;border-radius:4px;vertical-align:middle">${esc(item.statusCode)}</span>${item.statusText?`<span style="font-size:10px;color:${P.text};margin-left:6px">${esc(item.statusText)}</span>`:''}`;
      } else if (item.statusText) {
        fc = `<span style="font-size:10px;color:${P.text}">${esc(item.statusText)}</span>`;
      }

      const notes = (inclNotes && item.notes && item.notes.trim())
        ? `<div style="font-size:10px;color:${P.text};line-height:1.5;margin-top:5px;white-space:pre-wrap">${esc(item.notes.trim())}</div>` : '';

      const dparts = [];
      if (item.deliveryDate)       dparts.push('Delivery: ' + esc(item.deliveryDate));
      if (item.dueDate)            dparts.push('Install: ' + esc(item.dueDate));
      if (item.projectedStartDate) dparts.push('Proj. Start: ' + esc(item.projectedStartDate));
      if (item.punchDate)          dparts.push('Punch: ' + esc(item.punchDate));
      const dates = dparts.length
        ? `<div style="font-size:9px;font-weight:700;color:${P.sub};margin-top:6px">${dparts.join('&nbsp;&nbsp;&bull;&nbsp;&nbsp;')}</div>` : '';

      const tags = (inclTags && item.tags && item.tags.length)
        ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:6px">${item.tags.map(t=>`<span style="font-size:8px;padding:2px 6px;background:${P.row};border:1px solid ${P.border};color:${P.sub};border-radius:4px">${esc(t)}</span>`).join('')}</div>` : '';

      const textBlock = `
        <div style="font-size:15px;font-weight:800;color:${P.ink};letter-spacing:0.3px">${esc(siLbl(item.num))}</div>
        <div style="font-size:13px;font-weight:700;color:${P.ink};line-height:1.25;margin-top:2px">${esc(item.title||'')}</div>
        <div style="margin-top:5px">${statusLine}</div>
        ${fc?`<div style="margin-top:5px">${fc}</div>`:''}
        ${notes}${dates}${tags}`;

      const photos = inclPhotos ? (item.photos || []) : [];
      const cell = (ph, idx) => {
        const src = srcOf(ph), cap = capOf(ph);
        return `<div style="position:relative;width:100%;aspect-ratio:4/3;background:${P.row};border:1px solid ${P.border};border-radius:4px;overflow:hidden">
            ${src?`<img src="${src}" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.style.opacity=0">`:`<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:16px;color:${P.sub}">📷</div>`}
            <div style="position:absolute;top:4px;right:4px;width:16px;height:16px;border-radius:50%;background:#1f2937;color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center">${idx}</div>
          </div>${cap?`<div style="font-size:8px;color:${P.sub};margin-top:2px;line-height:1.3">${esc(cap)}</div>`:''}`;
      };

      let body;
      if (photos.length === 1) {
        body = `<div style="display:flex;gap:12px;align-items:flex-start">
            <div style="flex:0 0 150px">${cell(photos[0],1)}</div>
            <div style="flex:1;min-width:0">${textBlock}</div>
          </div>`;
      } else if (photos.length >= 2) {
        const cols = (photos.length === 2 || photos.length === 4) ? 2 : 3;
        const basis = cols === 2 ? 'calc(50% - 3px)' : 'calc(33.333% - 4px)';
        const grid = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
            ${photos.map((p,i)=>`<div style="flex:0 0 ${basis};max-width:${basis}">${cell(p,i+1)}</div>`).join('')}
          </div>`;
        body = `<div>${textBlock}${grid}</div>`;
      } else {
        body = `<div>${textBlock}</div>`;
      }

      const sep = layoutKey === 'grid'
        ? `border-bottom:1px solid ${P.rule}`
        : `border-bottom:1px solid ${P.border}`;
      return `<div style="padding:11px 0;${sep}">${body}</div>`;
    }

    // ── SECTION PAGES ─────────────────────────────────────────────────────────
    let pgNum = inclCover ? 2 : 1;
    const sectionHeader = (name, count) => layoutKey === 'grid'
      ? `<div style="padding:14px 18px 0">
          <div style="height:3px;background:${P.rule}"></div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0">
            <span style="font-size:11px;font-weight:800;color:${P.ink};letter-spacing:1px;text-transform:uppercase">${esc(name||'Section')}</span>
            <span style="font-size:8px;color:${P.sub}">${count} item${count!==1?'s':''}</span>
          </div>
          <div style="height:3px;background:${P.rule}"></div>
        </div>`
      : `<div style="padding:16px 18px 0">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:17px;font-weight:800;color:${P.ink}">${esc(name||'Section')}</span>
            <span style="font-size:8px;color:${P.sub}">${count} item${count!==1?'s':''}</span>
          </div>
          <div style="width:46px;height:3px;background:${P.accent};margin-top:5px"></div>
        </div>`;

    const renderSection = (name, secItems) => {
      const pg = pgNum++;
      return `
        <div class="page-container">
        <div class="page-scaler">
          <div class="page-num">${pg}</div>
          ${sectionHeader(name, secItems.length)}
          <div style="padding:6px 18px 10px;flex:1">
            ${secItems.map(it => itemBlock(it)).join('')}
          </div>
          <div class="pg-footer">
            <span>${esc(proj.name||'')}</span><span>Page ${pg}</span>
          </div>
        </div></div>`;
    };

    const sectionIds = new Set(sections.map(s => s.id));
    let sectionPages = sections.map(sec => {
      const secItems = items.filter(i => i.sectionId === sec.id);
      return secItems.length ? renderSection(sec.name, secItems) : '';
    }).join('');
    const orphans = items.filter(i => !sectionIds.has(i.sectionId));
    if (orphans.length) sectionPages += renderSection('Other Items', orphans);

    // ── SIGNATURE PAGE ────────────────────────────────────────────────────────
    const audSig = branding.auditorSig, cliSig = branding.clientSig;
    const sigPage = (audSig || cliSig) ? `
      <div class="page-container">
      <div class="page-scaler">
        <div class="page-num">${pgNum}</div>
        ${sectionHeader('Report Sign-Off', 0).replace(/<span style="font-size:8px[^>]*>[^<]*<\/span>/, '')}
        <div style="padding:18px;flex:1">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px">
            <div>
              <div style="font-size:8px;font-weight:700;color:${P.sub};margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Auditor / Inspector</div>
              ${audSig?`<img src="${audSig}" style="height:44px;max-width:140px;object-fit:contain;display:block;margin-bottom:6px">`:`<div style="height:44px;border-bottom:1px solid ${P.border};margin-bottom:6px;width:140px"></div>`}
              <div style="font-size:8px;color:${P.sub}">Signature &nbsp;&nbsp; Date: ___________</div>
            </div>
            <div>
              <div style="font-size:8px;font-weight:700;color:${P.sub};margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Client / GC</div>
              ${cliSig?`<img src="${cliSig}" style="height:44px;max-width:140px;object-fit:contain;display:block;margin-bottom:6px">`:`<div style="height:44px;border-bottom:1px solid ${P.border};margin-bottom:6px;width:140px"></div>`}
              <div style="font-size:8px;color:${P.sub}">Signature &nbsp;&nbsp; Date: ___________</div>
            </div>
          </div>
        </div>
        <div class="pg-footer"><span>${esc(proj.name||'')}</span><span>Page ${pgNum}</span></div>
      </div></div>` : '';

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#18212f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
  padding:20px;display:flex;flex-direction:column;align-items:center;gap:20px;min-height:100vh; overflow-x:hidden; width:100%;}
.page-container{width:100%;max-width:560px;position:relative;}
.page-scaler{width:560px;min-height:792px;background:${P.bg};
  box-shadow:0 6px 28px rgba(0,0,0,0.38);border-radius:2px;
  display:flex;flex-direction:column;position:relative;overflow:hidden;
  transform-origin:top center;}
.page-num{position:absolute;top:6px;right:10px;font-size:7.5px;font-weight:700;color:${P.sub};opacity:0.5;z-index:10}
.pg-footer{padding:6px 18px;display:flex;justify-content:space-between;align-items:center;
  margin-top:auto;font-size:7px;font-weight:600;color:${P.sub};border-top:1px solid ${P.border}}
</style>
<script>
  function scalePages() {
    const containers = document.querySelectorAll('.page-container');
    containers.forEach(c => {
      const scaler = c.querySelector('.page-scaler');
      if(scaler) {
        const scale = c.clientWidth / 560;
        scaler.style.transform = 'scale(' + scale + ')';
        c.style.height = (scaler.offsetHeight * scale) + 'px';
      }
    });
  }
  window.addEventListener('resize', scalePages);
  window.addEventListener('DOMContentLoaded', scalePages);
</script>
</head><body>
${coverPage}
${sectionPages}
${sigPage}
${total===0?`<div class="page-container"><div class="page-scaler" style="align-items:center;justify-content:center;min-height:200px"><div style="background:${P.bg};border-radius:8px;padding:40px 24px;text-align:center;width:560px;box-shadow:0 4px 20px rgba(0,0,0,0.2)">
  <div style="font-size:28px;margin-bottom:12px;opacity:0.25">📄</div>
  <div style="font-size:13px;color:${P.sub}">No items match the current filter</div></div></div></div>`:''}
<script>scalePages();</script>
</body></html>`;
  };

  // ── PROGRESS OVERLAY ──────────────────────────────────────────────────────────
  window.showPDFProgress = function (msg, pct) {
    document.getElementById('pdf-progress-overlay')?.remove();
    const el = document.createElement('div');
    el.className = 'pdf-progress-overlay'; el.id = 'pdf-progress-overlay';
    el.innerHTML = `
      <div class="pdf-progress-box">
        <div style="font-size:28px;margin-bottom:10px">📄</div>
        <div class="pdf-progress-title">Generating PDF</div>
        <div class="pdf-progress-sub" id="pdf-prog-sub">${msg}</div>
        <div class="pdf-progress-track">
          <div class="pdf-progress-fill" id="pdf-prog-fill" style="width:${pct}%"></div>
        </div>
        <div style="font-size:11px;color:var(--text3,#94a3b8);margin-top:8px;font-family:monospace"
          id="pdf-prog-pct">${pct}%</div>
      </div>`;
    document.body.appendChild(el);
  };
  window.updatePDFProgress = function (msg, pct) {
    const s = document.getElementById('pdf-prog-sub');
    const f = document.getElementById('pdf-prog-fill');
    const p = document.getElementById('pdf-prog-pct');
    if (s) s.textContent  = msg;
    if (f) f.style.width  = pct + '%';
    if (p) p.textContent  = pct + '%';
  };
  window.hidePDFProgress = function () {
    document.getElementById('pdf-progress-overlay')?.remove();
  };

  // ── EXPORT PDF — Theme-aware and Layout-aware engine  ───────────────────────

  // Field Check codes (FC / UFC / NFC / HT) → badge colours
  const FC_BADGE = {
    FC:  { bg:'#dcfce7', fg:'#166534' },
    UFC: { bg:'#fef3c7', fg:'#92400e' },
    NFC: { bg:'#fee2e2', fg:'#991b1b' },
    HT:  { bg:'#dbeafe', fg:'#1e40af' },
  };

  function siLabel(num){ return String(num || '').replace(/^SI\s+/i, 'SI-'); }
  function photoCaption(ph){ return (ph && (ph.caption || ph.note || ph.label || '')) || ''; }

  window.exportPDF = async function (pid) {
    const proj = (typeof getProject === 'function' ? getProject : window.getProject)(pid);
    if (!proj) return;

    // Mandatory field check (incomplete items must have Field Check, Notes, Photos)
    const incomplete = (proj.items || []).filter(it => {
      if (it.status === 'completed' || it.status === 'punch-ongoing') return false;
      return !it.statusCode || !(it.notes && it.notes.trim()) || !(it.photos && it.photos.length > 0);
    });
    if (incomplete.length > 0) {
      const list = incomplete.map(it => it.num).join(', ');
      if (typeof showToast === 'function')
        showToast(`Cannot export: Items [${list}] are missing Field Check, Notes, or Photos.`, 'red');
      return;
    }

    const S          = window._pdfExportSettings || {};
    const quality    = S.quality     ?? 0.72;
    const inclPhotos = S.inclPhotos  ?? true;
    const inclTS     = S.inclTS      ?? true;
    const inclNotes  = S.inclNotes   ?? true;
    const inclTags   = S.inclTags    ?? true;
    const inclCover  = S.inclCover   ?? true;
    const inclEnv    = S.inclEnv     ?? true;
    const reportTitle= S.reportTitle ?? 'Site Conditions Report';
    const footerText = S.footerText  ?? '';
    const whiteLabel = S.whiteLabel  ?? false;
    const layoutKey  = (S.layout === 'flow') ? 'flow' : 'grid';
    const themeKey   = S.theme || 'classic';
    const tpl        = resolveTemplate(themeKey);

    // Dynamic Palette injected directly from Theme Engine
    const P = {
      bg: tpl.bgPage, ink: tpl.cTitle, text: tpl.cText, sub: tpl.cSub,
      rule: tpl.cAccent, accent: tpl.cAccent, red: '#c0392b', border: tpl.cBorder,
      row: tpl.bgRow, font: tpl.font || 'helvetica'
    };

    document.getElementById('rg-overlay')?.remove();
    if (typeof closeModal === 'function') closeModal();
    window.showPDFProgress('Loading PDF engine…', 0);

    let attempts = 0;
    while (typeof window.jspdf === 'undefined' && attempts < 32) {
      await new Promise(r => setTimeout(r, 250)); attempts++;
    }
    if (typeof window.jspdf === 'undefined') {
      window.hidePDFProgress();
      if (typeof showToast === 'function') showToast('PDF library not loaded — check your connection');
      return;
    }

    window.updatePDFProgress('Building PDF…', 5);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const PW = 210, PH = 297, MX = 14, CW = PW - MX * 2, BOT = 14, PAGE_TOP = 20;

    const hex2rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
    const setFill   = c => doc.setFillColor(...hex2rgb(c));
    const setStroke = c => doc.setDrawColor(...hex2rgb(c));
    const setText   = c => doc.setTextColor(...hex2rgb(c));

    let pageNum = 0;
    function newPage() { if (pageNum > 0) doc.addPage(); pageNum++; setFill(P.bg); doc.rect(0,0,PW,PH,'F'); }

    async function compressImage(dataUrl, q, addTS) {
      return new Promise(res => {
        const img = new Image();
        if (dataUrl && dataUrl.startsWith('https://')) img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 900; let w = img.width, h = img.height;
          if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
          if (addTS) {
            const ts = addTS || '', fsize = Math.max(11, Math.round(w * 0.032));
            ctx.font = `bold ${fsize}px monospace`;
            const tw = ctx.measureText(ts).width, pad = fsize * 0.4;
            const bx = w - tw - pad * 2 - 8, by = h - fsize - pad * 2 - 8;
            const bw = tw + pad * 2, bh = fsize + pad * 2, r2 = fsize * 0.35;
            ctx.fillStyle = 'rgba(0,0,0,0.58)';
            ctx.beginPath();
            ctx.moveTo(bx+r2,by); ctx.lineTo(bx+bw-r2,by);
            ctx.quadraticCurveTo(bx+bw,by,bx+bw,by+r2); ctx.lineTo(bx+bw,by+bh-r2);
            ctx.quadraticCurveTo(bx+bw,by+bh,bx+bw-r2,by+bh); ctx.lineTo(bx+r2,by+bh);
            ctx.quadraticCurveTo(bx,by+bh,bx,by+bh-r2); ctx.lineTo(bx,by+r2);
            ctx.quadraticCurveTo(bx,by,bx+r2,by); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.fillText(ts, bx+pad, by+fsize+pad*0.6);
          }
          try { res(canvas.toDataURL('image/jpeg', q)); } catch (e) { res(null); }
        };
        img.onerror = () => res(null); img.src = dataUrl;
      });
    }

    // ── Shared stats strip (used on both covers) ──────────────────────────────
    function drawStats(yTop) {
      const items = proj.items || [];
      const st = [
        ['Total',      items.length,                                             P.sub],
        ['Completed',  items.filter(i=>i.status==='completed').length,           '#16a34a'],
        ['Punch',      items.filter(i=>i.status==='punch-ongoing').length,       '#a855f7'],
        ['Not Ready',  items.filter(i=>i.status==='not-ready').length,           '#dc2626'],
        ['In Prog',    items.filter(i=>i.status==='in-progress').length,         '#d97706'],
        ['Pending',    items.filter(i=>i.status==='pending').length,             '#6b7280'],
      ];
      const bw = CW / st.length;
      st.forEach((s,i) => {
        const x = MX + i*bw;
        setFill(P.row); setStroke(P.border); doc.setLineWidth(0.3); doc.roundedRect(x,yTop,bw-3,20,2,2,'FD');
        doc.setFont(P.font,'bold'); doc.setFontSize(15); doc.setTextColor(...hex2rgb(s[2])); doc.text(String(s[1]),x+3,yTop+11);
        doc.setFont(P.font,'normal'); doc.setFontSize(6.5); setText(P.sub); doc.text(s[0],x+3,yTop+17);
      });
      const py = yTop + 24, frac = items.length ? items.filter(i=>i.status==='completed').length/items.length : 0;
      setFill(P.border); doc.rect(MX,py,CW,2.5,'F'); setFill(P.accent); doc.rect(MX,py,CW*frac,2.5,'F');
    }

    // ── COVER: Branded Grid ───────────────────────────────────────────────────
    function coverGrid() {
      newPage();
      if (window._pdfBranding?.logo && !whiteLabel) {
        try { const pr = doc.getImageProperties(window._pdfBranding.logo);
          const lh = 16, lw = pr.width*lh/pr.height;
          doc.addImage(window._pdfBranding.logo,'PNG',PW-MX-lw,12,lw,lh); } catch(e){}
      }
      doc.setFont(P.font,'bold'); doc.setFontSize(9); setText(P.sub);
      doc.text((reportTitle||'').toUpperCase(), MX, 24, { charSpace: 0.6 });
      doc.setFont(P.font,'bold'); doc.setFontSize(26); setText(P.ink);
      const titleLines = doc.splitTextToSize(proj.name || 'Untitled Project', CW);
      doc.text(titleLines, MX, 44);
      let ty = 44 + titleLines.length*11;
      setFill(P.rule); doc.rect(MX, ty, CW, 1.8, 'F'); ty += 11;
      doc.setFont(P.font,'bold'); doc.setFontSize(12); setText(P.text);
      doc.text(proj.date || new Date().toLocaleDateString(), MX, ty); ty += 15;
      const meta = [['Client',proj.client],['Company',proj.company],['Auditor',proj.auditor]];
      meta.forEach(([k,v]) => { if (!v) return;
        doc.setFontSize(7.5); doc.setFont(P.font,'bold'); setText(P.sub); doc.text(k.toUpperCase(),MX,ty);
        doc.setFontSize(11); doc.setFont(P.font,'normal'); setText(P.text); doc.text(String(v),MX,ty+6,{maxWidth:CW-78}); ty += 15;
      });
      if (proj.coverPhoto) { try {
        const iw=70, ih=92, ix=PW-MX-iw, iy=72;
        setStroke(P.border); doc.setLineWidth(0.3); doc.roundedRect(ix,iy,iw,ih,2,2,'D');
        doc.addImage(proj.coverPhoto,'JPEG',ix,iy,iw,ih,'','FAST');
      } catch(e){} }
      drawStats(228);
      setText(P.sub); doc.setFontSize(8); doc.text('Generated '+new Date().toLocaleDateString(), MX, PH-14);
    }

    // ── COVER: Clean Flow (hero) ──────────────────────────────────────────────
    function coverFlow() {
      newPage();
      const heroH = 176;
      let drew = false;
      if (proj.coverPhoto) { try { doc.addImage(proj.coverPhoto,'JPEG',0,0,PW,heroH,'','FAST'); drew = true; } catch(e){} }
      if (!drew) { setFill(P.ink); doc.rect(0,0,PW,heroH,'F'); }
      try {
        doc.setGState(new doc.GState({opacity:0.45})); setFill('#0b1220'); doc.rect(0,0,PW,heroH,'F');
        doc.setGState(new doc.GState({opacity:0.35})); setFill('#000000'); doc.rect(0,0,PW,52,'F');
        doc.setGState(new doc.GState({opacity:1}));
      } catch(e) { setFill('#0b1220'); doc.rect(0,0,PW,52,'F'); doc.rect(0,heroH-30,PW,30,'F'); }
      setText('#ffffff'); doc.setFont(P.font,'bold'); doc.setFontSize(23);
      const tl = doc.splitTextToSize(proj.name || 'Untitled Project', CW);
      doc.text(tl, MX, 24);
      doc.setFont(P.font,'normal'); doc.setFontSize(9); setText('#cbd5e1');
      doc.text((reportTitle||'').toUpperCase(), MX, 24 + tl.length*9, { charSpace: 0.6 });
      // logo + date inside bottom of hero
      let by = heroH - 16;
      if (window._pdfBranding?.logo && !whiteLabel) {
        try { const pr = doc.getImageProperties(window._pdfBranding.logo);
          const lh = 12, lw = pr.width*lh/pr.height;
          doc.addImage(window._pdfBranding.logo,'PNG',MX,heroH-lh-10,lw,lh); by = heroH-10; } catch(e){}
      }
      setText('#e2e8f0'); doc.setFont(P.font,'bold'); doc.setFontSize(10);
      doc.text(proj.date || new Date().toLocaleDateString(), PW-MX, heroH-10, { align:'right' });
      // white area: meta + stats
      let my = heroH + 16;
      const meta = [['Client',proj.client],['Company',proj.company],['Auditor',proj.auditor]];
      const present = meta.filter(([,v])=>v);
      const colW = present.length ? CW/present.length : CW;
      present.forEach(([k,v],i) => {
        const x = MX + i*colW;
        doc.setFontSize(7.5); doc.setFont(P.font,'bold'); setText(P.sub); doc.text(k.toUpperCase(), x, my);
        doc.setFontSize(10.5); doc.setFont(P.font,'normal'); setText(P.text); doc.text(String(v), x, my+6, {maxWidth:colW-4});
      });
      drawStats(heroH + 36);
    }

    // ── Section headers ───────────────────────────────────────────────────────
    function sectionHeader(name, count, y) {
      if (layoutKey === 'grid') {
        setFill(P.rule); doc.rect(MX, y, CW, 0.7, 'F');
        doc.setFont(P.font,'bold'); doc.setFontSize(11); setText(P.ink);
        doc.text((name||'').toUpperCase(), MX, y+7);
        doc.setFont(P.font,'normal'); doc.setFontSize(8); setText(P.sub);
        doc.text(count+' item'+(count!==1?'s':''), PW-MX, y+7, {align:'right'});
        setFill(P.rule); doc.rect(MX, y+10, CW, 0.7, 'F');
        return y + 16;
      } else {
        doc.setFont(P.font,'bold'); doc.setFontSize(15); setText(P.ink);
        doc.text(name||'', MX, y+6);
        doc.setFont(P.font,'normal'); doc.setFontSize(8); setText(P.sub);
        doc.text(count+' item'+(count!==1?'s':''), PW-MX, y+6, {align:'right'});
        setFill(P.accent); doc.rect(MX, y+9, 28, 0.8, 'F');
        return y + 15;
      }
    }
    function contHeader(name) {
      if (layoutKey === 'grid') {
        setFill(P.rule); doc.rect(MX, 8, CW, 0.6, 'F');
        doc.setFont(P.font,'bold'); doc.setFontSize(8); setText(P.ink);
        doc.text((name+' (cont.)').toUpperCase(), MX, 7);
      } else {
        doc.setFont(P.font,'bold'); doc.setFontSize(9); setText(P.sub);
        doc.text(name+' (continued)', MX, 9);
      }
      return 14;
    }

    // ── Item text block (measure when draw=false, render when draw=true) ───────
    function itemTextBlock(item, x, y, width, draw) {
      let cyy = y;
      doc.setFont(P.font,'bold'); doc.setFontSize(13);
      if (draw) { setText(P.ink); doc.text(siLabel(item.num), x, cyy+4); }
      cyy += 6.6;

      doc.setFont(P.font,'bold'); doc.setFontSize(11);
      const titleLines = doc.splitTextToSize(item.title || '', width);
      if (draw) { setText(P.ink); doc.text(titleLines, x, cyy+3.5); }
      cyy += titleLines.length*5.2 + 1.5;

      const isDone = item.status === 'completed';
      const statusStr = isDone ? 'Completed: Yes' : ('Status: ' + statusLabel(item.status));
      doc.setFont(P.font,'bold'); doc.setFontSize(9);
      if (draw) { setText(isDone ? P.red : statusColor(item.status)); doc.text(statusStr, x, cyy+3); }
      cyy += 5.6;

      if (item.statusCode) {
        const b = FC_BADGE[item.statusCode] || { bg:'#f3f4f6', fg:'#374151' };
        doc.setFont(P.font,'bold'); doc.setFontSize(8);
        const lw = doc.getTextWidth(item.statusCode) + 5, bh = 5;
        if (draw) { setFill(b.bg); doc.roundedRect(x, cyy, lw, bh, 1.2, 1.2, 'F'); setText(b.fg); doc.text(item.statusCode, x+2.5, cyy+3.6); }
        if (item.statusText) {
          doc.setFont(P.font,'normal'); doc.setFontSize(8.5);
          if (draw) { setText(P.text); doc.text(item.statusText, x+lw+3, cyy+3.6, {maxWidth: width-lw-3}); }
        }
        cyy += bh + 2.6;
      } else if (item.statusText) {
        doc.setFont(P.font,'normal'); doc.setFontSize(8.5);
        const sl = doc.splitTextToSize(item.statusText, width);
        if (draw) { setText(P.text); doc.text(sl, x, cyy+3); }
        cyy += sl.length*4.4 + 1;
      }

      if (inclNotes && item.notes && item.notes.trim()) {
        doc.setFont(P.font,'normal'); doc.setFontSize(9);
        const nl = doc.splitTextToSize(item.notes.trim(), width);
        if (draw) { setText(P.text); doc.text(nl, x, cyy+3.5); }
        cyy += nl.length*4.6 + 1.5;
      }

      const parts = [];
      if (item.deliveryDate)       parts.push('Delivery: ' + item.deliveryDate);
      if (item.dueDate)            parts.push('Install: ' + item.dueDate);
      if (item.projectedStartDate) parts.push('Proj. Start: ' + item.projectedStartDate);
      if (item.punchDate)          parts.push('Punch: ' + item.punchDate);
      if (parts.length) {
        doc.setFont(P.font,'bold'); doc.setFontSize(7.5);
        const dl = doc.splitTextToSize(parts.join('    \u2022    '), width);
        if (draw) { setText(P.sub); doc.text(dl, x, cyy+3); }
        cyy += dl.length*4 + 1.5;
      }

      if (inclTags && item.tags && item.tags.length) {
        doc.setFont(P.font,'normal'); doc.setFontSize(6.5);
        let tx = x, ty2 = cyy + 1;
        item.tags.forEach(tag => {
          const tw = doc.getTextWidth(tag) + 4;
          if (tx + tw > x + width) { tx = x; ty2 += 6; }
          if (draw) { setFill(P.row); setStroke(P.border); doc.setLineWidth(0.2); doc.roundedRect(tx, ty2-3, tw, 5, 1.2, 1.2, 'FD'); setText(P.sub); doc.text(tag, tx+2, ty2+0.6); }
          tx += tw + 2;
        });
        cyy = ty2 + 5;
      }
      return cyy - y;
    }

    // ── Photo grid (2-up for exactly 2 photos, else 3-up) ─────────────────────
    async function drawPhotoGrid(photos, x, y, width, contName) {
      // Intelligently handle exactly 4 photos using a 2x2 grid for symmetry
      const cols = (photos.length === 2 || photos.length === 4) ? 2 : 3;
      const gap = 4;
      const cellW = (width - gap*(cols-1)) / cols;
      const cellH = Math.round(cellW * 0.72);
      const hasCap = photos.some(p => photoCaption(p));
      const rowH = cellH + (hasCap ? 6 : 0) + 3;
      let gy = y;
      for (let i = 0; i < photos.length; i++) {
        const col = i % cols;
        if (col === 0 && i > 0) gy += rowH;
        if (col === 0 && gy + cellH > PH - BOT) { newPage(); gy = contHeader(contName); }
        const px = x + col*(cellW + gap);
        const ph = photos[i];
        try {
          const ts = inclTS ? (ph.takenAt || null) : null;
          const src = (typeof getPhotoSrcForDisplay === 'function') ? getPhotoSrcForDisplay(ph) : (ph?.url || ph?._blobUrl || ph?.data || null);
          const comp = src ? await compressImage(src, quality, ts) : null;
          if (comp) doc.addImage(comp, 'JPEG', px, gy, cellW, cellH, '', 'FAST');
          else { setFill(P.row); setStroke(P.border); doc.setLineWidth(0.3); doc.roundedRect(px, gy, cellW, cellH, 1, 1, 'FD'); }
        } catch(e) { setFill(P.row); doc.rect(px, gy, cellW, cellH, 'F'); }
        const br = 3.2, bx = px + cellW - br - 1.6, byy = gy + br + 1.6;
        setFill('#1f2937'); doc.circle(bx, byy, br, 'F');
        doc.setFont(P.font,'bold'); doc.setFontSize(7); setText('#ffffff'); doc.text(String(i+1), bx, byy+2.3, {align:'center'});
        const cap = photoCaption(ph);
        if (cap) { doc.setFont(P.font,'normal'); doc.setFontSize(6.5); setText(P.sub); const cl = doc.splitTextToSize(cap, cellW).slice(0,2); doc.text(cl, px, gy+cellH+3); }
      }
      return gy + cellH + (hasCap ? 6 : 0) + 4;
    }

    // ── One SI item (keep-together; 1-up side-by-side; multi-up grid below) ────
    let cy = PAGE_TOP;
    function estimateItemHeight(item) {
      const single = inclPhotos && (item.photos?.length === 1);
      if (single) {
        const photoW = 60, photoH = 45, tw = CW - photoW - 6;
        return Math.max(photoH, itemTextBlock(item, MX+photoW+6, 0, tw, false)) + 6;
      }
      const th = itemTextBlock(item, MX, 0, CW, false);
      let ph = 0;
      if (inclPhotos && item.photos?.length) {
        const cols = (item.photos.length === 2 || item.photos.length === 4) ? 2 : 3;
        const cellW = (CW - 4*(cols-1)) / cols, cellH = Math.round(cellW*0.72);
        const rows = Math.ceil(item.photos.length / cols);
        const hasCap = item.photos.some(p => photoCaption(p));
        ph = rows*(cellH + (hasCap?6:0) + 3) + 2;
      }
      return th + ph + 6;
    }
    async function drawItem(item, contName) {
      const single = inclPhotos && (item.photos?.length === 1);
      const estH = estimateItemHeight(item);
      if (cy > PAGE_TOP && cy + Math.min(estH, PH - PAGE_TOP - BOT) > PH - BOT) { newPage(); cy = contHeader(contName); }

      if (single) {
        const photoW = 60, photoH = 45, tx = MX + photoW + 6, tw = CW - photoW - 6;
        const ph = item.photos[0];
        try {
          const ts = inclTS ? (ph.takenAt || null) : null;
          const src = (typeof getPhotoSrcForDisplay === 'function') ? getPhotoSrcForDisplay(ph) : (ph?.url || ph?._blobUrl || ph?.data || null);
          const comp = src ? await compressImage(src, quality, ts) : null;
          if (comp) doc.addImage(comp, 'JPEG', MX, cy, photoW, photoH, '', 'FAST');
          else { setFill(P.row); setStroke(P.border); doc.setLineWidth(0.3); doc.roundedRect(MX, cy, photoW, photoH, 1, 1, 'FD'); }
        } catch(e){}
        const br = 3.2, bx = MX + photoW - br - 1.6, byy = cy + br + 1.6;
        setFill('#1f2937'); doc.circle(bx, byy, br, 'F'); doc.setFont(P.font,'bold'); doc.setFontSize(7); setText('#ffffff'); doc.text('1', bx, byy+2.3, {align:'center'});
        let belowPhoto = cy + photoH;
        const cap = photoCaption(ph);
        if (cap) { doc.setFont(P.font,'normal'); doc.setFontSize(6.5); setText(P.sub); const cl = doc.splitTextToSize(cap, photoW).slice(0,3); doc.text(cl, MX, belowPhoto+3); belowPhoto += 3 + cl.length*3; }
        const th = itemTextBlock(item, tx, cy, tw, true);
        cy = Math.max(belowPhoto, cy + th) + 6;
      } else {
        const th = itemTextBlock(item, MX, cy, CW, true);
        cy += th + 2;
        if (inclPhotos && item.photos?.length) cy = await drawPhotoGrid(item.photos, MX, cy, CW, contName);
        cy += 4;
      }

      if (layoutKey === 'grid') { setFill(P.rule); doc.rect(MX, cy, CW, 0.4, 'F'); cy += 5; }
      else { setStroke(P.border); doc.setLineWidth(0.3); doc.line(MX, cy, PW-MX, cy); cy += 5; }
    }

    // ── DISPATCH: cover ───────────────────────────────────────────────────────
    if (inclCover) { layoutKey === 'flow' ? coverFlow() : coverGrid(); }

    // ── SECTIONS + ITEMS ──────────────────────────────────────────────────────
    const allItems = proj.items || [];
    const totalCount = allItems.length || 1;
    let done = 0;
    const sections = proj.sections || [];
    const sectionIds = new Set(sections.map(s => s.id));

    for (const sec of sections) {
      const secItems = allItems.filter(i => i.sectionId === sec.id);
      if (!secItems.length) continue;
      newPage();
      cy = sectionHeader(sec.name, secItems.length, 12);
      for (const item of secItems) {
        await drawItem(item, sec.name);
        done++; window.updatePDFProgress('Rendering items…', Math.round((done/totalCount)*78) + 10);
        await new Promise(r => requestAnimationFrame(r));
      }
    }
    // Orphan items (no matching section) — don't silently drop them
    const orphans = allItems.filter(i => !sectionIds.has(i.sectionId));
    if (orphans.length) {
      newPage();
      cy = sectionHeader('Other Items', orphans.length, 12);
      for (const item of orphans) {
        await drawItem(item, 'Other Items');
        done++; window.updatePDFProgress('Rendering items…', Math.round((done/totalCount)*78) + 10);
        await new Promise(r => requestAnimationFrame(r));
      }
    }

    // ── ENVIRONMENTAL CONDITIONS (overall site — humidity / temperature) ──────
    if (inclEnv && proj.envData) {
      const env = proj.envData, thr = env.thresholds || { maxTemp:80, maxHum:60 };
      if ((env.sensors?.length || 0) + (env.screenshots?.length || 0) > 0) {
        window.updatePDFProgress('Rendering environmental charts…', 90);
        newPage();
        setFill(P.ink); doc.rect(0,0,PW,18,'F');
        doc.setFontSize(10); doc.setFont(P.font,'bold'); setText('#ffffff');
        doc.text('ENVIRONMENTAL CONDITIONS — SITE',15,12);
        let ey = 24;
        const gef = (typeof window.getEnvFilter === 'function') ? window.getEnvFilter : () => ({startPct:0,endPct:100});
        const fd  = (typeof window.filterData === 'function') ? window.filterData : d => d;
        async function envChart(data, lc, maxT, minT, x, y, w, h) {
          if (!data.length) return;
          const cv = document.createElement('canvas'), dp = 2;
          cv.width = w*dp*4; cv.height = h*dp*4;
          const ctx = cv.getContext('2d'); ctx.scale(dp*4, dp*4);
          const CWi = w, CHi = h, pad = {t:8,b:18,l:32,r:6}, cw = CWi-pad.l-pad.r, ch = CHi-pad.t-pad.b;
          ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,CWi,CHi);
          const vs = data.map(d=>d.v), mn = Math.min(...vs), mx = Math.max(...vs);
          const dMin = Math.min(mn,(minT!==undefined?minT-2:mn),(maxT!==undefined?maxT-2:mn));
          const dMax = Math.max(mx,(maxT!==undefined?maxT+2:mx),(minT!==undefined?minT+2:mx));
          const rng = dMax-dMin || 1;
          ctx.strokeStyle='rgba(0,0,0,0.06)'; ctx.lineWidth=0.5;
          for (let g=0; g<=4; g++){ const f=g/4, gy=pad.t+ch*(1-f); ctx.beginPath(); ctx.moveTo(pad.l,gy); ctx.lineTo(pad.l+cw,gy); ctx.stroke();
            ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.font='5px monospace'; ctx.textAlign='right'; ctx.fillText((dMin+rng*f).toFixed(1),pad.l-2,gy+2); }
          ctx.beginPath();
          data.forEach((d,i)=>{ const px2=pad.l+cw*(i/(data.length-1||1)), py2=pad.t+ch*(1-(d.v-dMin)/rng); i===0?ctx.moveTo(px2,py2):ctx.lineTo(px2,py2); });
          ctx.lineTo(pad.l+cw,pad.t+ch); ctx.lineTo(pad.l,pad.t+ch); ctx.closePath(); ctx.fillStyle=lc+'33'; ctx.fill();
          for (let i=1; i<data.length; i++){
            const x0=pad.l+cw*((i-1)/(data.length-1||1)), y0=pad.t+ch*(1-(data[i-1].v-dMin)/rng);
            const x1=pad.l+cw*(i/(data.length-1||1)), y1=pad.t+ch*(1-(data[i].v-dMin)/rng);
            const abv = maxT!==undefined && (data[i-1].v>maxT || data[i].v>maxT);
            ctx.beginPath(); ctx.strokeStyle=abv?'#ef4444':lc; ctx.lineWidth=abv?1.2:0.9; ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke(); }
          doc.addImage(cv.toDataURL('image/jpeg',0.92),'JPEG',x,y,w,h,'','FAST');
        }
        for (const [si,s] of (env.sensors||[]).entries()) {
          const flt = gef(proj.id,si), td = fd(s.temperature||[],flt.startPct,flt.endPct), hd = fd(s.humidity||[],flt.startPct,flt.endPct);
          if (ey+80 > PH-20) { newPage(); ey=16; }
          setFill(P.row); doc.roundedRect(12,ey,PW-24,8,1,1,'F');
          doc.setFontSize(8); doc.setFont(P.font,'bold'); setText(P.ink); doc.text((s.name||'Sensor '+(si+1)),15,ey+5.5); ey+=11;
          if (td.length) { if (ey+44>PH-20){newPage();ey=16;} doc.setFontSize(7); doc.setFont(P.font,'bold'); doc.setTextColor(249,115,22);
            doc.text('TEMPERATURE (\u00b0F)',15,ey+4); ey+=7; await envChart(td,'#f97316',thr.maxTemp,thr.minTemp,12,ey,PW-24,38); ey+=41; }
          if (hd.length) { if (ey+44>PH-20){newPage();ey=16;} doc.setFontSize(7); doc.setFont(P.font,'bold'); doc.setTextColor(248,113,113);
            doc.text('RELATIVE HUMIDITY (%)',15,ey+4); ey+=7; await envChart(hd,'#f87171',thr.maxHum,thr.minHum,12,ey,PW-24,38); ey+=41; }
          ey += 6; await new Promise(r=>requestAnimationFrame(r));
        }
        for (const [si,s] of (env.screenshots||[]).entries()) {
          if (ey+70 > PH-20) { newPage(); ey=16; }
          doc.setFontSize(8); doc.setFont(P.font,'bold'); setText(P.ink); doc.text((s.label||'Screenshot '+(si+1)),15,ey+5); ey+=9;
          try { doc.addImage(s.data,'PNG',12,ey,PW-24,65,'','FAST'); ey+=68; } catch(e){}
        }
      }
    }

    // ── SIGNATURE PAGE ────────────────────────────────────────────────────────
    if (window._pdfBranding?.auditorSig || window._pdfBranding?.clientSig) {
      newPage();
      setFill(P.ink); doc.rect(0,0,PW,18,'F');
      doc.setFontSize(10); doc.setFont(P.font,'bold'); setText('#ffffff'); doc.text('REPORT SIGN-OFF',15,12);
      let sy = 38;
      doc.setFontSize(11); doc.setFont(P.font,'bold'); setText(P.ink); doc.text('Auditor / Inspector',15,sy);
      if (window._pdfBranding.auditorSig) doc.addImage(window._pdfBranding.auditorSig,'PNG',15,sy+5,60,20);
      doc.setFontSize(9); doc.setFont(P.font,'normal'); setText(P.sub);
      doc.line(15,sy+26,85,sy+26); doc.text('Signature',15,sy+30); doc.text('Date: '+new Date().toLocaleDateString(),60,sy+30);
      sy = 98;
      doc.setFontSize(11); doc.setFont(P.font,'bold'); setText(P.ink); doc.text('Client / General Contractor',15,sy);
      if (window._pdfBranding.clientSig) doc.addImage(window._pdfBranding.clientSig,'PNG',15,sy+5,60,20);
      doc.setFontSize(9); doc.setFont(P.font,'normal'); setText(P.sub);
      doc.line(15,sy+26,85,sy+26); doc.text('Signature',15,sy+30); doc.text('Date: ________________',60,sy+30);
    }

    // ── FOOTERS ───────────────────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let p=1; p<=pageCount; p++) {
      doc.setPage(p);
      setStroke(P.border); doc.setLineWidth(0.4); doc.line(MX, PH-10, PW-MX, PH-10);
      doc.setFontSize(7); setText(P.sub); doc.setFont(P.font,'normal');
      doc.text(proj.name || '', MX, PH-5.5);
      if (footerText) doc.text(footerText, PW/2, PH-5.5, {align:'center'});
      doc.text('Page '+p+' of '+pageCount, PW-MX, PH-5.5, {align:'right'});
    }

    window.updatePDFProgress('Saving PDF…', 97);
    await new Promise(r => setTimeout(r, 100));

    const layoutName = layoutKey === 'flow' ? 'Clean Flow' : 'Branded Grid';
    const filename = (proj.name || 'report').replace(/[^a-z0-9]/gi,'_') + '_' + layoutKey + '_report.pdf';
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      const blobURL = URL.createObjectURL(doc.output('blob'));
      window.hidePDFProgress();
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(0,0,0,0.8);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;';
      ov.innerHTML = `<div style="background:var(--surface,#1e293b);border:1px solid var(--border,#334155);border-radius:16px;padding:24px;max-width:340px;text-align:center;">
        <div style="font-size:36px;margin-bottom:12px">\u{1F4C4}</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:8px">PDF Ready — ${layoutName}</div>
        <div style="font-size:12px;color:var(--text2,#94a3b8);margin-bottom:20px;line-height:1.6">Tap <strong>Share \u2B06</strong> → <strong>Save to Files</strong></div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button onclick="window.open('${blobURL}','_blank');this.closest('div[style]').remove();"
            style="background:var(--accent,#3db8f5);color:#000;border:none;border-radius:10px;padding:12px;font-family:monospace;font-size:13px;font-weight:700;cursor:pointer;">Open PDF \u2197</button>
          <button onclick="this.closest('div[style]').remove();"
            style="background:var(--surface2,#1e293b);color:var(--text2,#94a3b8);border:1px solid var(--border,#334155);border-radius:10px;padding:10px;font-family:monospace;font-size:12px;cursor:pointer;">Cancel</button>
        </div></div>`;
      document.body.appendChild(ov);
    } else {
      doc.save(filename);
      window.hidePDFProgress();
      if (typeof showToast === 'function') showToast('\u2713 PDF Downloaded — ' + layoutName, 'green');
    }
  };

})();