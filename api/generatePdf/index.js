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

    // Field Check
    if (item.fieldCheck) {
      doc.moveDown(0.2)
         .fontSize(8).font("Helvetica").fillColor(COLORS.text2)
         .text(`Field Check: [${item.fieldCheck}]`, MARGIN + 12, doc.y);
    }

    // Conditions
    if (item.conditions && item.conditions.length) {
      doc.moveDown(0.2)
         .fontSize(8).font("Helvetica").fillColor(COLORS.text3)
         .text(`Conditions: ${item.conditions.join(" · ")}`, MARGIN + 12, doc.y,
               { width: CONTENT_W - 12 });
    }

    // Notes
    if (item.notes && item.notes.trim()) {
      doc.moveDown(0.3)
         .fontSize(9).font("Helvetica").fillColor(COLORS.text2)
         .text(item.notes.trim(), MARGIN + 12, doc.y,
               { width: CONTENT_W - 12, lineGap: 2 });
    }

    // Delivery date
    if (item.delivery) {
      doc.moveDown(0.3)
         .fontSize(8).font("Helvetica-Bold").fillColor(COLORS.text3)
         .text(`Delivery: ${item.delivery}`, MARGIN + 12, doc.y);
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
