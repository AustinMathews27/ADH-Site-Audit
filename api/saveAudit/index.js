const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
    // Connect to your Cosmos DB
    const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
    const database = client.database("AuditData");
    const container = database.container("Audits");

    try {
        // Grab the data sent from your frontend app
        const auditData = req.body;
        
        // Ensure it has an ID, or create one
        if (!auditData.id) {
            auditData.id = new Date().toISOString() + "-" + Math.random().toString(36).substr(2, 9);
        }

        // Save it to the database
        const { resource: createdItem } = await container.items.create(auditData);

        context.res = {
            status: 201,
            body: createdItem
        };
    } catch (error) {
        context.res = {
            status: 500,
            body: "Error saving to database: " + error.message
        };
    }
}
