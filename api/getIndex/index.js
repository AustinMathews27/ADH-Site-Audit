// api/getIndex/index.js
// GET /api/getIndex
//
// Returns the shared index document: folders, contacts, settings, projectIds[].
// This is the "directory listing" of the app. It is small and cheap to poll.
// Individual project data lives in separate documents — see getProject.

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");
const INDEX_ID  = "adh-index-v1";

module.exports = async function (context, req) {
  try {
    const { resource } = await container.item(INDEX_ID, INDEX_ID).read();

    if (!resource) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: { error: "Index not found — run /api/migrateStore first" }
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: resource
    };

  } catch (error) {
    if (error.code === 404) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: { error: "Index not found" }
      };
    } else {
      context.log.error("[getIndex] Error:", error.message);
      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: { error: error.message }
      };
    }
  }
};
