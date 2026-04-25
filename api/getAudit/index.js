// api/getAudit/index.js
// GET /api/getAudit
// Returns the shared audit store document.
// _ts (Cosmos DB server timestamp) is included so the client can detect
// remote changes without comparing the full document.

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("adh-site-db");
const container = database.container("Audits");

module.exports = async function (context, req) {
  try {
    // Use item() point-read instead of a query — faster and cheaper (1 RU vs query cost)
    const { resource } = await container.item("adh-store-v1", "adh-store-v1").read();

    if (!resource) {
      context.res = { status: 404, body: { error: "No store found" } };
      return;
    }

    // _ts is a Cosmos system property (Unix seconds, auto-updated on every write).
    // The client uses it to detect when someone else has saved since the last poll.
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: resource
    };
  } catch (error) {
    if (error.code === 404) {
      context.res = { status: 404, body: { error: "No store found" } };
    } else {
      context.log.error("[getAudit] Error:", error.message);
      context.res = { status: 500, body: { error: error.message } };
    }
  }
};
