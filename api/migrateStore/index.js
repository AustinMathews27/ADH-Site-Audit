// api/migrateStore/index.js
// POST /api/migrateStore
// Body: { secret: "your-migration-secret" }   (optional — set MIGRATION_SECRET in app settings)
//
// ONE-TIME migration: splits the old adh-store-v1 document into:
//   adh-index-v1          → folders, contacts, settings, projectIds[]
//   adh-proj-{id}         → one document per project
//
// Safe to run multiple times — uses upsert so it won't duplicate documents.
// After migration succeeds, you can delete adh-store-v1 manually if desired.

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");

const OLD_DOC_ID = "adh-store-v1";
const INDEX_ID   = "adh-index-v1";

module.exports = async function (context, req) {
  context.log("[migrateStore] Starting migration...");

  // Optional secret guard — set MIGRATION_SECRET in Azure App Settings
  const expectedSecret = process.env.MIGRATION_SECRET;
  if (expectedSecret) {
    const provided = req.body && req.body.secret;
    if (provided !== expectedSecret) {
      context.res = { status: 403, body: { ok: false, error: "Forbidden" } };
      return;
    }
  }

  try {
    // ── 1. Read the old monolithic store ──────────────────────────────────────
    let oldStore;
    try {
      const { resource } = await container.item(OLD_DOC_ID, OLD_DOC_ID).read();
      oldStore = resource;
    } catch (e) {
      if (e.code === 404) {
        context.res = {
          status: 404,
          body: { ok: false, error: "adh-store-v1 not found. Nothing to migrate." }
        };
        return;
      }
      throw e;
    }

    if (!oldStore) {
      context.res = { status: 404, body: { ok: false, error: "adh-store-v1 is empty." } };
      return;
    }

    const projects = oldStore.projects || [];
    context.log(`[migrateStore] Found ${projects.length} projects to migrate.`);

    const results = { ok: [], failed: [] };

    // ── 2. Write each project as its own document ──────────────────────────────
    for (const project of projects) {
      const docId = "adh-proj-" + project.id;

      // Strip photos from items — they live in IndexedDB / Azure Blob
      const cleanItems = (project.items || []).map(item => {
        const cloudPhotos = (item.photos || [])
          .filter(p => p.url)
          .map(p => ({ url: p.url, caption: p.caption || "", takenAt: p.takenAt || "" }));

        const cloudAttachments = (item.attachments || [])
          .map(a => ({
            id: a.id, name: a.name, type: a.type, ext: a.ext,
            icon: a.icon, size: a.size, addedAt: a.addedAt, addedBy: a.addedBy
          }));

        return Object.assign({}, item, {
          photos:      cloudPhotos,
          attachments: cloudAttachments
        });
      });

      // Strip floorPlan imageData (too large for Cosmos)
      const cleanFloorPlan = project.floorPlan
        ? Object.assign({}, project.floorPlan, { imageData: null })
        : undefined;

      const projectDoc = Object.assign({}, project, {
        id:          docId,
        projectId:   project.id,  // preserve original ID
        items:       cleanItems,
        coverPhoto:  null,        // never in Cosmos
        _migratedAt: Date.now(),
        _savedAt:    Date.now()
      });
      if (cleanFloorPlan) projectDoc.floorPlan = cleanFloorPlan;

      try {
        await container.items.upsert(projectDoc);
        context.log(`[migrateStore] ✓ ${project.id} — ${project.name}`);
        results.ok.push({ id: project.id, name: project.name });
      } catch (err) {
        context.log.error(`[migrateStore] ✗ ${project.id}: ${err.message}`);
        results.failed.push({ id: project.id, name: project.name, error: err.message });
      }
    }

    // ── 3. Write the index document ────────────────────────────────────────────
    const indexDoc = {
      id:          INDEX_ID,
      folders:     oldStore.folders  || [],
      contacts:    oldStore.contacts || [],
      settings:    oldStore.settings || { isAdmin: false, theme: "light" },
      projectIds:  projects.map(p => p.id),
      _migratedAt: Date.now(),
      _savedAt:    Date.now()
    };

    await container.items.upsert(indexDoc);
    context.log("[migrateStore] ✓ Index document (adh-index-v1) written.");

    // ── 4. Summary ─────────────────────────────────────────────────────────────
    const summary = {
      ok:     true,
      message: results.failed.length === 0
        ? "Migration complete — all projects migrated successfully."
        : `Migration complete with ${results.failed.length} error(s). Check failed[] for details.`,
      projectsMigrated: results.ok.length,
      projectsFailed:   results.failed.length,
      indexWritten:     true,
      projects: results,
      next: [
        "1. Deploy new client sync engine (v5)",
        "2. Verify app loads correctly from new documents",
        "3. Optionally delete adh-store-v1 from Cosmos Data Explorer",
        "4. Optionally delete or disable /api/migrateStore function"
      ]
    };

    context.log("[migrateStore] Done.", JSON.stringify(summary, null, 2));
    context.res = { status: 200, body: summary };

  } catch (err) {
    context.log.error("[migrateStore] Fatal error:", err.message);
    context.res = {
      status: 500,
      body: { ok: false, error: err.message, stack: err.stack }
    };
  }
};
