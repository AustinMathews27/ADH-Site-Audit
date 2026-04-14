const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
    // Connect to the database using your hidden key
    const client = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
    const database = client.database("Auditdata");
    const container = database.container("Audits");

    try {
        // Query the database: "Get the 1 most recent item, sorted by time saved"
        const querySpec = {
            query: "SELECT TOP 1 * FROM c ORDER BY c._ts DESC"
        };
        
        const { resources: items } = await container.items.query(querySpec).fetchAll();

        // If we found saved data, send it back!
        if (items.length > 0) {
            context.res = {
                status: 200,
                body: items[0] 
            };
        } else {
            // If the database is empty
            context.res = {
                status: 404,
                body: "No saved data found"
            };
        }
    } catch (error) {
        context.res = {
            status: 500,
            body: "Error fetching from database: " + error.message
        };
    }
}
