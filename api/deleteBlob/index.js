// api/deleteBlob/index.js
// POST /api/deleteBlob  —  Body: { blobUrl: "https://..." }
//
// Deletes a photo blob from Azure Storage server-side.
// The browser never gets delete permission in its SAS token —
// all deletions go through this function.

const {
  BlobServiceClient,
  StorageSharedKeyCredential,
} = require('@azure/storage-blob');

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: _corsHeaders(), body: '' };
    return;
  }

  const account    = process.env.AZURE_STORAGE_ACCOUNT;
  const accountKey = process.env.AZURE_STORAGE_KEY;
  const container  = process.env.AZURE_BLOB_CONTAINER;

  if (!account || !accountKey || !container) {
    context.log.error('[deleteBlob] Missing storage env vars.');
    context.res = {
      status: 500,
      headers: _corsHeaders(),
      body: JSON.stringify({ error: 'Server misconfiguration.' }),
    };
    return;
  }

  const body = req.body;
  if (!body || !body.blobUrl) {
    context.res = {
      status: 400,
      headers: _corsHeaders(),
      body: JSON.stringify({ error: 'Missing required field: blobUrl' }),
    };
    return;
  }

  // Security: ensure the URL belongs to OUR storage account and container
  let parsedUrl;
  try { parsedUrl = new URL(body.blobUrl); }
  catch {
    context.res = { status: 400, headers: _corsHeaders(), body: JSON.stringify({ error: 'Invalid blobUrl' }) };
    return;
  }

  const expectedHost = `${account}.blob.core.windows.net`;
  if (parsedUrl.hostname !== expectedHost) {
    context.log.warn(`[deleteBlob] Rejected URL from unexpected host: ${parsedUrl.hostname}`);
    context.res = { status: 403, headers: _corsHeaders(), body: JSON.stringify({ error: 'Forbidden — URL does not belong to this storage account.' }) };
    return;
  }

  // Extract blob name: path is /<container>/<blobName...>
  const pathParts = parsedUrl.pathname.split('/');
  if (pathParts[1] !== container) {
    context.res = { status: 403, headers: _corsHeaders(), body: JSON.stringify({ error: 'Forbidden — container mismatch.' }) };
    return;
  }

  const blobName = pathParts.slice(2).join('/');
  if (!blobName) {
    context.res = { status: 400, headers: _corsHeaders(), body: JSON.stringify({ error: 'Could not parse blob name from URL.' }) };
    return;
  }

  try {
    const cred    = new StorageSharedKeyCredential(account, accountKey);
    const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, cred);
    const result  = await service.getContainerClient(container).getBlobClient(blobName).deleteIfExists({ deleteSnapshots: 'includeSnapshots' });

    context.log(`[deleteBlob] ${result.succeeded ? '✓ Deleted' : 'Not found (already deleted?)'}: ${blobName}`);
    context.res = {
      status: 200,
      headers: { ..._corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleted: result.succeeded, blobName }),
    };
  } catch (err) {
    context.log.error('[deleteBlob] Error:', err.message);
    context.res = {
      status: 500,
      headers: _corsHeaders(),
      body: JSON.stringify({ error: 'Failed to delete blob.', detail: err.message }),
    };
  }
};

function _corsHeaders() {
  return {
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
