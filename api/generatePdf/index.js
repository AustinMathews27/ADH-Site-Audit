// api/generatePdf/index.js
// GET  /api/generatePdf?projectId=xxx
// POST /api/generatePdf  Body: { projectId, reportDate (optional) }
//
// Generates a server-side PDF matching the "SITE CONDITIONS REPORT" format.
// Returns application/pdf — the browser can download or open it inline.
//
// Reads the project from Cosmos DB (adh-proj-{projectId}).
// Sections and items are rendered in the same order as the app UI.

const { CosmosClient } = require("@azure/cosmos");
const PDFDocument      = require("pdfkit");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");

// ── Status label map ──────────────────────────────────────────────────────────
const STATUS_LABELS = {
  completed:     "Completed",
  "not-ready":   "Not Ready",
  "in-progress": "In Progress",
  "punch-ongoing": "Punch Ongoing",
  "on-hold":     "On Hold",
  "out-of-scope":"Out of Scope",
  changed:       "Changed",
  pending:       "Pending"
};

// ── Colour palette (RGB) ──────────────────────────────────────────────────────
const COLORS = {
  accent:      [37,  99,  235],   // blue-600
  green:       [22,  163,  74],
  red:         [220,  38,  38],
  yellow:      [217, 119,   6],
  orange:      [249, 115,  22],
  purple:      [168,  85, 247],
  text:        [15,  23,  42],
  text2:       [71,  85, 105],
  text3:       [148,163,184],
  border:      [209,213,219],
  surface:     [255,255,248],
  bg:          [241,245,249]
};

function statusColor(status) {
  switch (status) {
    case "completed":      return COLORS.green;
    case "not-ready":      return COLORS.red;
    case "in-progress":    return COLORS.yellow;
    case "punch-ongoing":  return COLORS.purple;
    case "on-hold":        return COLORS.orange;
    case "changed":        return COLORS.orange;
    default:               return COLORS.text3;
  }
}

function fmtDate(isoOrMs) {
  if (!isoOrMs) return "";
  try {
    const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
    return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  } catch { return String(isoOrMs); }
}

module.exports = async function (context, req) {
  // ── 1. Read projectId ──────────────────────────────────────────────────────
  const projectId = (req.query.projectId || (req.body && req.body.projectId) || "").trim();

  if (!projectId) {
    context.res = { status: 400, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing projectId" }) };
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    context.res = { status: 400, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid projectId format" }) };
    return;
  }

  // ── 2. Fetch project from Cosmos ───────────────────────────────────────────
  const docId = projectId.startsWith("adh-proj-") ? projectId : "adh-proj-" + projectId;
  let proj;
  try {
    const { resource } = await container.item(docId, docId).read();
    if (!resource) {
      context.res = { status: 404, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Project not found" }) };
      return;
    }
    proj = resource;
  } catch (err) {
    if (err.code === 404) {
      context.res = { status: 404, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Project not found" }) };
    } else {
      context.log.error("[generatePdf] Cosmos error:", err.message);
      context.res = { status: 500, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: err.message }) };
    }
    return;
  }

  // ── 3. Build stat counts ───────────────────────────────────────────────────
  const items    = (proj.items || []).filter(i => !i._deleted);
  const sections = proj.sections || [];

  const stats = { total: items.length, completed: 0, punch: 0, notReady: 0, inProgress: 0, pending: 0 };
  for (const item of items) {
    if (item.status === "completed")           stats.completed++;
    else if (item.status === "punch-ongoing")  stats.punch++;
    else if (item.status === "not-ready")      stats.notReady++;
    else if (item.status === "in-progress")    stats.inProgress++;
    else                                       stats.pending++;
  }

  // ── 4. Generate PDF ────────────────────────────────────────────────────────
  const doc = new PDFDocument({
    size:    "LETTER",
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: {
      Title:    proj.name || projectId,
      Author:   "ADH Field Audit Tool",
      Subject:  "Site Conditions Report",
      Creator:  "ADH Field Audit Tool"
    }
  });

  const chunks = [];
  doc.on("data",  chunk => chunks.push(chunk));

  const PAGE_W    = doc.page.width;
  const MARGIN    = 54;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let pageNum = 1;

  // ── Helper: draw page footer ───────────────────────────────────────────────
  function drawFooter() {
    const y = doc.page.height - MARGIN + 12;
    doc.save()
       .fontSize(8).fillColor(COLORS.text3)
       .text(proj.name || "", MARGIN, y, { width: CONTENT_W / 2, align: "left" })
       .text(`Page ${pageNum} of {TOTAL}`, MARGIN + CONTENT_W / 2, y,
             { width: CONTENT_W / 2, align: "right" })
       .restore();
    pageNum++;
  }

  // ── Helper: draw section header bar ───────────────────────────────────────
  function drawSectionHeader(name, count) {
    doc.save()
       .rect(MARGIN, doc.y, CONTENT_W, 20).fillColor(COLORS.bg).fill()
       .fillColor(COLORS.text3).fontSize(8).font("Helvetica-Bold")
       .text(name.toUpperCase(), MARGIN + 8, doc.y + 6,
             { width: CONTENT_W - 60, continued: false })
       .fillColor(COLORS.text2).fontSize(8).font("Helvetica")
       .text(`${count} item${count !== 1 ? "s" : ""}`,
             MARGIN + CONTENT_W - 60, doc.y - 14,
             { width: 50, align: "right" })
       .restore()
       .moveDown(1.4);
  }

  // ── Helper: draw one SI item card ─────────────────────────────────────────
  function drawItem(item) {
    const cardTop = doc.y;
    const statusLabel = STATUS_LABELS[item.status] || item.status || "Pending";
    const sColor      = statusColor(item.status);

    // Left accent bar
    doc.save().rect(MARGIN, cardTop, 3, 1).fillColor(sColor).restore();

    // SI Number
    doc.fontSize(9).font("Helvetica-Bold").fillColor(COLORS.accent)
       .text(`SI ${(item.num || "").replace(/^SI\s+/, "")}`, MARGIN + 12, cardTop);

    // Status badge — right aligned
    doc.save()
       .fontSize(8).font("Helvetica-Bold").fillColor(sColor)
       .text(statusLabel, MARGIN, cardTop, { width: CONTENT_W, align: "right" })
       .restore();

    // Title
    doc.moveDown(0.25)
       .fontSize(11).font("Helvetica-Bold").fillColor(COLORS.text)
       .text(item.title || "(No title)", MARGIN + 12, doc.y, { width: CONTENT_W - 12 });

    // Field Check  (app stores this as statusCode/statusText; fall back to those)
    const _fieldCheck = item.fieldCheck || item.statusCode || "";
    if (_fieldCheck) {
      const _fcDetail = item.statusText ? `  ${item.statusText}` : "";
      doc.moveDown(0.2)
         .fontSize(8).font("Helvetica").fillColor(COLORS.text2)
         .text(`Field Check: [${_fieldCheck}]${_fcDetail}`, MARGIN + 12, doc.y);
    }

    // Conditions  (app stores condition tags under item.tags)
    const _conds = (item.conditions && item.conditions.length) ? item.conditions
                 : (Array.isArray(item.tags) ? item.tags : []);
    if (_conds.length) {
      doc.moveDown(0.2)
         .fontSize(8).font("Helvetica").fillColor(COLORS.text3)
         .text(`Conditions: ${_conds.join(" \u00b7 ")}`, MARGIN + 12, doc.y,
               { width: CONTENT_W - 12 });
    }

    // Notes
    if (item.notes && item.notes.trim()) {
      doc.moveDown(0.3)
         .fontSize(9).font("Helvetica").fillColor(COLORS.text2)
         .text(item.notes.trim(), MARGIN + 12, doc.y,
               { width: CONTENT_W - 12, lineGap: 2 });
    }

    // Delivery date  (app stores this as item.deliveryDate)
    const _delivery = item.delivery || item.deliveryDate || "";
    if (_delivery) {
      doc.moveDown(0.3)
         .fontSize(8).font("Helvetica-Bold").fillColor(COLORS.text3)
         .text(`Delivery: ${fmtDate(_delivery)}`, MARGIN + 12, doc.y);
    }

    // Updated by
    if (item._updatedBy && item._updatedAt) {
      doc.moveDown(0.15)
         .fontSize(7.5).font("Helvetica").fillColor(COLORS.text3)
         .text(`Last updated by ${item._updatedBy} · ${fmtDate(item._updatedAt)}`,
               MARGIN + 12, doc.y);
    }

    // Bottom border
    doc.moveDown(0.5)
       .save()
       .moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y)
       .strokeColor(COLORS.border).lineWidth(0.5).stroke()
       .restore()
       .moveDown(0.6);

    // Now draw the accent bar height now that we know total card height
    const cardHeight = doc.y - cardTop;
    doc.save()
       .rect(MARGIN, cardTop, 3, cardHeight - 8).fillColor(sColor).fill()
       .restore();
  }

  // ── Helper: check remaining space; add page if needed ─────────────────────
  function ensureSpace(needed) {
    if (doc.y + needed > doc.page.height - MARGIN - 30) {
      drawFooter();
      doc.addPage();
    }
  }

  // ── Environmental helpers ──────────────────────────────────────────────────
  // Thresholds default to the same values used by the app. The UI's per-sensor
  // time-window filter is a client-only setting and is NOT available here, so the
  // server renders the FULL recorded series for each sensor.
  const ENV_DEFAULT_THR = { minTemp: 50, maxTemp: 80, minHum: 20, maxHum: 60 };

  function envHeaderBar() {
    const y = doc.y;
    doc.save().rect(MARGIN, y, CONTENT_W, 22).fillColor(COLORS.text).fill().restore();
    doc.fontSize(10).font("Helvetica-Bold").fillColor([255, 255, 255])
       .text("ENVIRONMENTAL CONDITIONS \u2014 SITE", MARGIN + 10, y + 7);
    doc.y = y + 22 + 12;
  }

  function acceptableBand(thr) {
    const y = doc.y;
    doc.save().roundedRect(MARGIN, y, CONTENT_W, 30, 3).fillColor(COLORS.bg).fill().restore();
    doc.fontSize(8).font("Helvetica-Bold").fillColor([51, 65, 85])
       .text("ACCEPTABLE RANGES", MARGIN + 10, y + 6);
    doc.fontSize(9).font("Helvetica").fillColor([71, 85, 105])
       .text(`Temperature:  ${thr.minTemp}\u2013${thr.maxTemp} \u00b0F`, MARGIN + 10, y + 17,
             { width: CONTENT_W / 2 - 12 });
    doc.fontSize(9).font("Helvetica").fillColor([71, 85, 105])
       .text(`Relative Humidity:  ${thr.minHum}\u2013${thr.maxHum} %`, MARGIN + CONTENT_W / 2, y + 17,
             { width: CONTENT_W / 2 - 10 });
    doc.y = y + 30 + 10;
  }

  function envNums(arr) {
    return (arr || []).map(d => (d && typeof d.v === "number") ? d.v : null).filter(n => n !== null);
  }

  function computeViolations(sensors, thr) {
    const out = [];
    sensors.forEach((s, i) => {
      const td = envNums(s.temperature), hd = envNums(s.humidity);
      const nm = s.name || ("Sensor " + (i + 1));
      const tHi = td.filter(x => x > thr.maxTemp).length, tLo = td.filter(x => x < thr.minTemp).length;
      const hHi = hd.filter(x => x > thr.maxHum).length,  hLo = hd.filter(x => x < thr.minHum).length;
      if (tHi) out.push(`${nm}: temp above ${thr.maxTemp}\u00b0F (${tHi} reading${tHi > 1 ? "s" : ""}, peak ${Math.max(...td).toFixed(1)}\u00b0F)`);
      if (tLo) out.push(`${nm}: temp below ${thr.minTemp}\u00b0F (${tLo} reading${tLo > 1 ? "s" : ""}, low ${Math.min(...td).toFixed(1)}\u00b0F)`);
      if (hHi) out.push(`${nm}: humidity above ${thr.maxHum}% (${hHi} reading${hHi > 1 ? "s" : ""}, peak ${Math.max(...hd).toFixed(1)}%)`);
      if (hLo) out.push(`${nm}: humidity below ${thr.minHum}% (${hLo} reading${hLo > 1 ? "s" : ""}, low ${Math.min(...hd).toFixed(1)}%)`);
    });
    return out;
  }

  function violationSummary(sensors, thr) {
    const v = computeViolations(sensors, thr);
    ensureSpace(36);
    if (v.length) {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(COLORS.red)
         .text(`${v.length} THRESHOLD EXCEEDANCE${v.length > 1 ? "S" : ""} DETECTED`, MARGIN, doc.y);
      doc.moveDown(0.4);
      doc.fontSize(8.5).font("Helvetica").fillColor([153, 27, 27]);
      for (const line of v) {
        ensureSpace(16);
        doc.fillColor([153, 27, 27]).text(`\u00b7  ${line}`, MARGIN + 6, doc.y, { width: CONTENT_W - 6 });
        doc.moveDown(0.15);
      }
      doc.moveDown(0.6);
    } else {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(COLORS.green)
         .text("ALL READINGS WITHIN ACCEPTABLE RANGE", MARGIN, doc.y);
      doc.moveDown(0.8);
    }
  }

  // Lightweight vector line chart (no DOM/canvas — drawn with pdfkit primitives).
  function miniChart(data, x, y, w, h, rgb, minThr, maxThr) {
    const vals = envNums(data);
    if (!vals.length) return;
    const padL = 30, padR = 8, padT = 6, padB = 14;
    const cw = w - padL - padR, ch = h - padT - padB;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (minThr != null) { lo = Math.min(lo, minThr); hi = Math.max(hi, minThr); }
    if (maxThr != null) { lo = Math.min(lo, maxThr); hi = Math.max(hi, maxThr); }
    if (lo === hi) { lo -= 1; hi += 1; }
    const margin = (hi - lo) * 0.12; lo -= margin; hi += margin;
    const rng = (hi - lo) || 1;
    const X = i => x + padL + cw * (vals.length === 1 ? 0.5 : i / (vals.length - 1));
    const Y = val => y + padT + ch * (1 - (val - lo) / rng);

    doc.save();
    doc.rect(x, y, w, h).fillColor([248, 250, 252]).fill();
    if (minThr != null && maxThr != null) {
      const top = Y(Math.min(maxThr, hi)), bot = Y(Math.max(minThr, lo));
      doc.rect(x + padL, top, cw, Math.max(0, bot - top)).fillColor([225, 247, 232]).fill();
    }
    doc.lineWidth(0.5).strokeColor([226, 232, 240]);
    for (let g = 0; g <= 4; g++) {
      const gy = y + padT + ch * (g / 4);
      doc.moveTo(x + padL, gy).lineTo(x + padL + cw, gy).stroke();
      doc.fontSize(6).font("Helvetica").fillColor([148, 163, 184])
         .text((hi - rng * (g / 4)).toFixed(0), x, gy - 3, { width: padL - 3, align: "right" });
    }
    for (let i = 1; i < vals.length; i++) {
      const over = (maxThr != null && (vals[i] > maxThr || vals[i - 1] > maxThr)) ||
                   (minThr != null && (vals[i] < minThr || vals[i - 1] < minThr));
      doc.lineWidth(over ? 1.4 : 1).strokeColor(over ? [239, 68, 68] : rgb)
         .moveTo(X(i - 1), Y(vals[i - 1])).lineTo(X(i), Y(vals[i])).stroke();
    }
    if (vals.length === 1) doc.circle(X(0), Y(vals[0]), 1.8).fillColor(rgb).fill();
    doc.lineWidth(0.5).strokeColor(COLORS.border).rect(x, y, w, h).stroke();
    doc.restore();
  }

  function statLine(data, unit, lo, hi) {
    const vals = envNums(data);
    if (!vals.length) return;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const out = (mx > hi || mn < lo);
    doc.fontSize(7.5).font("Helvetica").fillColor(out ? COLORS.red : COLORS.text2)
       .text(`avg ${avg.toFixed(1)}${unit}   \u00b7   range ${mn.toFixed(1)}\u2013${mx.toFixed(1)}${unit}   \u00b7   ${vals.length} readings`,
             MARGIN, doc.y, { width: CONTENT_W });
    doc.moveDown(0.3);
  }

  function drawSensor(s, idx, thr) {
    const nm = s.name || ("Sensor " + (idx + 1));
    ensureSpace(30);
    doc.save().rect(MARGIN, doc.y, CONTENT_W, 16).fillColor(COLORS.bg).fill().restore();
    doc.fontSize(9).font("Helvetica-Bold").fillColor(COLORS.text).text(nm, MARGIN + 8, doc.y + 4);
    doc.y += 16 + 8;

    if (envNums(s.temperature).length) {
      ensureSpace(98);
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(COLORS.orange).text("TEMPERATURE (\u00b0F)", MARGIN, doc.y);
      doc.moveDown(0.3);
      const cy = doc.y;
      miniChart(s.temperature, MARGIN, cy, CONTENT_W, 74, COLORS.orange, thr.minTemp, thr.maxTemp);
      doc.y = cy + 74 + 4;
      statLine(s.temperature, "\u00b0F", thr.minTemp, thr.maxTemp);
    }
    if (envNums(s.humidity).length) {
      ensureSpace(98);
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor([248, 113, 113]).text("RELATIVE HUMIDITY (%)", MARGIN, doc.y);
      doc.moveDown(0.3);
      const cy = doc.y;
      miniChart(s.humidity, MARGIN, cy, CONTENT_W, 74, [248, 113, 113], thr.minHum, thr.maxHum);
      doc.y = cy + 74 + 4;
      statLine(s.humidity, "%", thr.minHum, thr.maxHum);
    }
    doc.moveDown(0.6);
  }

  function drawScreenshot(s, idx) {
    if (!s || !s.data) return;
    const m = /^data:(image\/[a-z.+-]+);base64,(.*)$/i.exec(s.data);
    if (!m) return;
    let buf;
    try { buf = Buffer.from(m[2], "base64"); } catch (e) { return; }
    const label = s.label || ("Screenshot " + (idx + 1));
    try {
      const img = doc.openImage(buf);            // PNG/JPEG only; WEBP throws -> caught below
      let dw = CONTENT_W, dh = img.height * (CONTENT_W / img.width);
      if (dh > 240) { dh = 240; dw = img.width * (240 / img.height); }
      ensureSpace(dh + 22);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.text2).text(label, MARGIN, doc.y);
      doc.moveDown(0.3);
      doc.image(buf, MARGIN, doc.y, { width: dw, height: dh });
      doc.y += dh + 10;
    } catch (e) {
      ensureSpace(20);
      doc.fontSize(8).font("Helvetica-Oblique").fillColor(COLORS.text3)
         .text(`${label}  (image format not supported in server PDF)`, MARGIN, doc.y);
      doc.moveDown(0.5);
    }
  }

  // Renders the whole environmental section. Adds a page only if there is data.
  function drawEnvironmental() {
    const env = proj.envData;
    if (!env) return;
    const sensors = Array.isArray(env.sensors) ? env.sensors : [];
    const shots   = Array.isArray(env.screenshots) ? env.screenshots : [];
    if (!sensors.length && !shots.length) return;
    const thr = Object.assign({}, ENV_DEFAULT_THR, env.thresholds || {});

    doc.addPage();
    envHeaderBar();

    if (sensors.length) {
      acceptableBand(thr);
      violationSummary(sensors, thr);
      sensors.forEach((s, i) => drawSensor(s, i, thr));
    }
    if (shots.length) {
      ensureSpace(28);
      doc.fontSize(9).font("Helvetica-Bold").fillColor(COLORS.text2).text("SCREENSHOTS", MARGIN, doc.y);
      doc.moveDown(0.5);
      shots.forEach((s, i) => drawScreenshot(s, i));
    }
    drawFooter();
  }

  // ── Cover page ─────────────────────────────────────────────────────────────
  const coverY = MARGIN + 20;

  doc.fontSize(11).font("Helvetica-Bold").fillColor(COLORS.text3)
     .text("SITE CONDITIONS REPORT", MARGIN, coverY, { align: "center", width: CONTENT_W });

  doc.moveDown(1)
     .fontSize(18).font("Helvetica-Bold").fillColor(COLORS.text)
     .text(proj.name || "Unnamed Project", MARGIN, doc.y, { align: "center", width: CONTENT_W });

  // Horizontal rule
  doc.moveDown(1)
     .save().moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y)
     .strokeColor(COLORS.border).lineWidth(1).stroke().restore()
     .moveDown(1);

  // Meta grid
  const metaLeft  = MARGIN;
  const metaRight = MARGIN + CONTENT_W / 2;
  const metaW     = CONTENT_W / 2 - 12;

  function metaLine(label, value, x) {
    const y = doc.y;
    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(COLORS.text3)
       .text(label.toUpperCase(), x, y, { width: metaW });
    doc.fontSize(10).font("Helvetica").fillColor(COLORS.text)
       .text(value || "—", x, doc.y, { width: metaW });
    doc.moveDown(0.6);
  }

  const reportDate = (req.body && req.body.reportDate)
    ? req.body.reportDate
    : new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });

  const savedY = doc.y;
  metaLine("Client",  proj.clientName  || proj.client  || "", metaLeft);
  metaLine("Auditor", proj.auditorName || proj.auditor || "", metaLeft);
  doc.y = savedY;
  metaLine("Company", proj.company || "Allegheny Millwork", metaRight);
  metaLine("Date",    fmtDate(proj.auditDate || proj.date) || reportDate, metaRight);

  doc.moveDown(1)
     .save().moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y)
     .strokeColor(COLORS.border).lineWidth(1).stroke().restore()
     .moveDown(1.5);

  // Stats row
  const statCols = [
    { label: "Total Items",  value: stats.total,       color: COLORS.text },
    { label: "Completed",    value: stats.completed,   color: COLORS.green },
    { label: "Punch",        value: stats.punch,       color: COLORS.purple },
    { label: "Not Ready",    value: stats.notReady,    color: COLORS.red },
    { label: "In Progress",  value: stats.inProgress,  color: COLORS.yellow },
    { label: "Pending",      value: stats.pending,     color: COLORS.text3 }
  ];
  const colW = CONTENT_W / statCols.length;
  const statTop = doc.y;
  statCols.forEach((s, i) => {
    const x = MARGIN + i * colW;
    doc.fontSize(22).font("Helvetica-Bold").fillColor(s.color)
       .text(String(s.value), x, statTop, { width: colW, align: "center" });
    doc.fontSize(8).font("Helvetica").fillColor(COLORS.text2)
       .text(s.label, x, statTop + 26, { width: colW, align: "center" });
  });

  doc.y = statTop + 50;
  doc.moveDown(1.5)
     .fontSize(7.5).font("Helvetica").fillColor(COLORS.text3)
     .text(`Report Date: ${reportDate}`, MARGIN, doc.y, { width: CONTENT_W, align: "left" });

  drawFooter();

  // ── Section pages ──────────────────────────────────────────────────────────
  for (const sec of sections) {
    const secItems = items.filter(i => i.sectionId === sec.id);
    if (!secItems.length) continue;

    doc.addPage();
    drawSectionHeader(sec.name || "Unnamed Section", secItems.length);

    for (const item of secItems) {
      // Estimate height needed: title(20) + notes(~40) + padding(30) ≈ 90 min
      const estHeight = 90 + (item.notes ? Math.ceil(item.notes.length / 80) * 12 : 0);
      ensureSpace(estHeight);
      drawItem(item);
    }

    drawFooter();
  }

  // ── Environmental conditions section ────────────────────────────────────────
  drawEnvironmental();

  // ── Finalize PDF ───────────────────────────────────────────────────────────
  doc.end();

  await new Promise(resolve => doc.on("end", resolve));

  const pdfBuffer = Buffer.concat(chunks);
  const safeName  = (proj.name || "report").replace(/[^a-z0-9_\- ]/gi, "_").trim();

  context.res = {
    status: 200,
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
      "Cache-Control":       "no-store"
    },
    isRaw: true,
    body:  pdfBuffer
  };

  context.log(`[generatePdf] ✓ ${proj.name} — ${pdfBuffer.length} bytes`);
};
