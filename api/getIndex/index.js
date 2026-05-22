// api/getIndex/index.js
// GET /api/getIndex?userId={userId}
//
// Returns the per-user index document: folders, contacts, settings, projectIds[].
// Each user gets their own isolated document — adh-index-{userId}.
// Falls back to adh-index-v1 for legacy data if the user index doesn't exist yet.

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");

module.exports = async function (context, req) {
  const userId  = (req.query.userId || '').trim();
  const indexId = userId ? `adh-index-${userId}` : 'adh-index-v1';

  try {
    let resource;

    // Try user-specific index first
    try {
      const result = await container.item(indexId, indexId).read();
      resource = result.resource;
    } catch (e) {
      if (e.code !== 404) throw e;
      resource = null;
    }

    // First-time user: try migrating from the legacy shared index
    if (!resource && userId) {
      try {
        const legacy = await container.item('adh-index-v1', 'adh-index-v1').read();
        if (legacy.resource) {
          // Return legacy data so client can bootstrap — client will save it
          // under the user-scoped key on next saveIndex call
          context.res = {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: { ...legacy.resource, id: indexId, _migratedFromLegacy: true }
          };
          return;
        }
      } catch (legacyErr) { /* no legacy data either — fresh start */ }
    }

    if (!resource) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: { error: "Index not found" }
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: resource
    };

  } catch (error) {
    context.log.error("[getIndex] Error:", error.message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: error.message }
    };
  }
};
