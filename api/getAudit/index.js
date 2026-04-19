const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
    const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
    const database = client.database("Auditdata");
    const container = database.container("Audits");

    try {
        // Fetch the single shared store document by fixed ID
        const { resources: items } = await container.items.query({
            query: "SELECT * FROM c WHERE c.id = 'adh-store-v1'"
        }).fetchAll();

        if (items.length > 0) {
            context.res = { status: 200, body: items[0] };
        } else {
            context.res = { status: 404, body: { error: "No store found" } };
        }
    } catch (error) {
        context.res = {
            status: 500,
            body: { error: error.message }
        };
    }
};
