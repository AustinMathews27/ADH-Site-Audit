// api/getProject/index.js
// GET /api/getProject?id=proj_abc123
//
// Returns a single project document. Each project is stored independently
// so users on different projects can never conflict with each other.
//
// The Cosmos document ID is "adh-proj-{projectId}".
// The original projectId is preserved in the "projectId" field.

const { CosmosClient } = require("@azure/cosmos");

const client    = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database  = client.database("Auditdata");
const container = database.container("Audits");

module.exports = async function (context, req) {
  const projectId = req.query.id;

  if (!projectId) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { error: "Missing required query parameter: id" }
    };
    return;
  }

  // Sanitize: only allow alphanumeric, underscores, hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { error: "Invalid project ID format" }
    };
    return;
  }

  const docId = "adh-proj-" + projectId;

  try {
    const { resource } = await container.item(docId, docId).read();

    if (!resource) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: { error: "Project not found", projectId }
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
        body: { error: "Project not found", projectId }
      };
    } else {
      context.log.error(`[getProject] Error fetching ${projectId}:`, error.message);
      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: { error: error.message }
      };
    }
  }
};
