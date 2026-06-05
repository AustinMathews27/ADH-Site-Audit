// api/logChange/index.js
// POST /api/logChange
//
// Appends a change-log entry to the AuditLog container.
// Documents are stored with a TTL of 90 days (7,776,000 seconds).
// TTL must be enabled on the AuditLog container in Cosmos DB portal:
//   Auditdata → AuditLog → Settings → Time to Live → On (no default)
//
// Body: {
//   projectId   string   — e.g. "proj_1779297505172"
//   projectName string   — human name of the project
//   siId        string   — item ID (optional, omit for project-level events)
//   siNum       string   — e.g. "SI 0101"
//   siTitle     string   — item title
//   field       string   — which field changed, e.g. "status", "notes", "delivery"
//   oldValue    any      — previous value (string/null)
//   newValue    any      — new value
//   by          string   — displayName of the person making the change
//   byId        string   — userId from clientPrincipal
// }

const { CosmosClient } = require("@azure/cosmos");

const client   = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = client.database("Auditdata");

const CONTAINER_ID  = "AuditLog";
const TTL_90_DAYS   = 60 * 60 * 24 * 90; // seconds

async function ensureContainer(context) {
  try {
    const { container } = await database.containers.createIfNotExists({
      id: CONTAINER_ID,
      partitionKey: { paths: ["/projectId"] },
      defaultTtl: -1   // TTL enabled but no default — each doc sets its own ttl
    });
    return container;
  } catch (err) {
    context.log.error("[logChange] Could not create/verify AuditLog container:", err.message);
    throw err;
  }
}

module.exports = async function (context, req) {
  context.res = { headers: { "Content-Type": "application/json" } };

  if (req.method === "OPTIONS") {
    context.res = { status: 204, body: "" };
    return;
  }

  const body = req.body;
  if (!body || !body.projectId || !body.field) {
    context.res.status = 400;
    context.res.body   = { ok: false, error: "Body must include projectId and field" };
    return;
  }

  try {
    const container = await ensureContainer(context);

    const now = Date.now();
    const entry = {
      id:          `log_${now}_${Math.random().toString(36).slice(2, 8)}`,
      projectId:   body.projectId,
      projectName: body.projectName  || "",
      siId:        body.siId         || null,
      siNum:       body.siNum        || null,
      siTitle:     body.siTitle      || null,
      field:       body.field,
      oldValue:    body.oldValue     ?? null,
      newValue:    body.newValue     ?? null,
      by:          body.by           || "Unknown",
      byId:        body.byId         || null,
      changedAt:   now,
      ttl:         TTL_90_DAYS
    };

    await container.items.create(entry);

    context.log(`[logChange] ✓ ${body.projectId} / ${body.siNum || "project"} — ${body.field}: "${body.oldValue}" → "${body.newValue}" by ${body.by}`);
    context.res.status = 200;
    context.res.body   = { ok: true, id: entry.id };

  } catch (err) {
    context.log.error("[logChange] Error:", err.message);
    context.res.status = 500;
    context.res.body   = { ok: false, error: err.message };
  }
};
