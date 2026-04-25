// api/patchAudit/index.js
// POST /api/patchAudit  —  Body: { patch: {...} }
//
// Handles three patch formats (most → least granular):
//
//  1. itemsById    { id, _savedAt, itemsById: { si_abc: { projectId, item } } }
//     Only the listed items are touched inside their parent projects.
//     Two supers editing different fields on the same SI both survive.
//
//  2. projectsById { id, _savedAt, projectsById: { proj_xyz: {...} } }
//     Only the listed projects are replaced (item-level merge inside each).
//     Other projects in the document are untouched.
//
//  3. Full store   { id, _savedAt, settings, folders, contacts, projects: [...] }
//     Deep-merge of everything. Used by manual sync as a clean baseline.
//     Still a merge — never a full overwrite.
//
// All formats use ETag-based optimistic concurrency with up to 5 retries
// so concurrent saves never silently lose data.

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");
const DOC_ID    = "adh-store-v1";

// Deep-merge: patch wins on conflict; arrays are replaced, not concatenated
function deepMerge(target, patch) {
  for (const key of Object.keys(patch)) {
    const pv = patch[key], tv = target[key];
    if (pv !== null && typeof pv === "object" && !Array.isArray(pv) &&
        tv !== null && typeof tv === "object" && !Array.isArray(tv)) {
      deepMerge(tv, pv);
    } else {
      target[key] = pv;
    }
  }
  return target;
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (!req.body || !req.body.patch) {
    context.res.status = 400;
    context.res.body   = { ok: false, error: "Body must contain { patch: {...} }" };
    return;
  }

  const incoming    = req.body.patch;
  const MAX_RETRIES = 5;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // ── 1. Read current document + ETag ──────────────────────────
      let current, etag;
      try {
        const { resource } = await container.item(DOC_ID, DOC_ID).read();
        current = resource;
        etag    = resource._etag;
      } catch (e) {
        if (e.code === 404) { current = { id: DOC_ID }; etag = null; }
        else throw e;
      }

      const updated = JSON.parse(JSON.stringify(current));

      // ── 2. Apply the patch ────────────────────────────────────────

      if (incoming.itemsById) {
        // ── FORMAT 1: item-level (most granular) ──────────────────
        // Copy scalar fields (_savedAt, etc.) but not itemsById itself
        Object.keys(incoming).forEach(k => {
          if (k !== "itemsById") updated[k] = incoming[k];
        });

        if (!updated.projects) updated.projects = [];

        // Build a map: projectId → project index in updated.projects
        const projIndexMap = new Map(
          updated.projects.map((p, i) => [p.id, i])
        );

        Object.entries(incoming.itemsById).forEach(([itemId, { projectId, item }]) => {
          // Find or create the parent project
          let projIdx = projIndexMap.get(projectId);
          if (projIdx === undefined) {
            // Project doesn't exist yet — create a shell; client will
            // send a full projectsById sync to fill it in
            updated.projects.push({ id: projectId, items: [] });
            projIdx = updated.projects.length - 1;
            projIndexMap.set(projectId, projIdx);
          }

          const proj = updated.projects[projIdx];
          if (!proj.items) proj.items = [];

          const itemIdx = proj.items.findIndex(i => i.id === itemId);

          if (itemIdx >= 0) {
            // Item exists — deep-merge so concurrent field edits both survive
            // e.g. Super A changed notes, Super B changed status → both kept
            deepMerge(proj.items[itemIdx], item);
          } else {
            // New item — just add it
            proj.items.push(item);
          }
        });

      } else if (incoming.projectsById) {
        // ── FORMAT 2: project-level ───────────────────────────────
        Object.keys(incoming).forEach(k => {
          if (k !== "projectsById") updated[k] = incoming[k];
        });

        if (!updated.projects) updated.projects = [];
        const projectMap = new Map(updated.projects.map(p => [p.id, p]));

        Object.entries(incoming.projectsById).forEach(([id, proj]) => {
          if (projectMap.has(id)) {
            // Item-level merge inside this project
            const existing   = projectMap.get(id);
            const localItems = new Map((existing.items || []).map(i => [i.id, i]));
            (proj.items || []).forEach(ci => {
              if (localItems.has(ci.id)) deepMerge(localItems.get(ci.id), ci);
              else localItems.set(ci.id, ci);
            });
            const merged = Object.assign({}, existing, proj);
            merged.items = [...localItems.values()];
            projectMap.set(id, merged);
          } else {
            projectMap.set(id, proj);
          }
        });

        updated.projects = [...projectMap.values()];

      } else {
        // ── FORMAT 3: full store (manual sync baseline) ───────────
        // Deep-merge everything; projects array gets item-level merge
        const incomingProjects = incoming.projects || [];
        const existingProjMap  = new Map((updated.projects || []).map(p => [p.id, p]));

        // Apply all scalar/non-project fields first
        Object.keys(incoming).forEach(k => {
          if (k !== "projects") updated[k] = incoming[k];
        });

        // Item-level merge for each project
        incomingProjects.forEach(ip => {
          if (existingProjMap.has(ip.id)) {
            const ep        = existingProjMap.get(ip.id);
            const itemMap   = new Map((ep.items || []).map(i => [i.id, i]));
            (ip.items || []).forEach(ci => {
              if (itemMap.has(ci.id)) deepMerge(itemMap.get(ci.id), ci);
              else itemMap.set(ci.id, ci);
            });
            const merged  = Object.assign({}, ep, ip);
            merged.items  = [...itemMap.values()];
            existingProjMap.set(ip.id, merged);
          } else {
            existingProjMap.set(ip.id, ip);
          }
        });

        updated.projects = [...existingProjMap.values()];
      }

      updated._savedAt = incoming._savedAt || Date.now();

      // ── 3. Write back with ETag check ─────────────────────────────
      const writeOpts = etag
        ? { accessCondition: { type: "IfMatch", condition: etag } }
        : {};

      const { resource: saved } = await container.items.upsert(updated, writeOpts);updated.id = DOC_ID;

      context.res.status = 200;
      context.res.body   = { ok: true, _savedAt: saved._savedAt, _ts: saved._ts };
      return;

    } catch (err) {
      if (err.code === 412 && attempt < MAX_RETRIES) {
        context.log.warn(`[patchAudit] ETag conflict, retry ${attempt}/${MAX_RETRIES}`);
        await new Promise(r => setTimeout(r, 60 * attempt));
        continue;
      }
      context.log.error("[patchAudit] Error:", err.message);
      context.res.status = err.code === 412 ? 409 : 500;
      context.res.body   = { ok: false, error: err.message };
      return;
    }
  }
};
