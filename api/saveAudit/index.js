const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
    const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
    const database = client.database("Auditdata");
    const container = database.container("Audits");

    try {
        const storeData = req.body;
        // Fixed ID so all users share one document (upsert = create or overwrite)
        storeData.id = 'adh-store-v1';

        const { resource: saved } = await container.items.upsert(storeData);

        context.res = {
            status: 200,
            body: { ok: true, _savedAt: saved._savedAt }
        };
    } catch (error) {
        context.res = {
            status: 500,
            body: { ok: false, error: error.message }
        };
    }
};
