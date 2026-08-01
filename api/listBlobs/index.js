// api/listBlobs/index.js
// GET /api/listBlobs?prefix=proj_123/   (prefix optional)
//
// Lists photo blobs in the Azure Storage container so the admin Photo
// Recovery view can browse and re-link orphaned photos without downloading
// them one by one. Returns name, url, size, and timestamps per blob.
// Read-only — recovery re-links URLs; it never writes or deletes blobs.

const {
  BlobServiceClient,
  StorageSharedKeyCredential,
} = require('@azure/storage-blob');

const MAX_BLOBS = 20000; // safety cap — metadata only, ~150 bytes per entry

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: _corsHeaders(), body: '' };
    return;
  }

  const account    = process.env.AZURE_STORAGE_ACCOUNT;
  const accountKey = process.env.AZURE_STORAGE_KEY;
  const container  = process.env.AZURE_BLOB_CONTAINER;

  if (!account || !accountKey || !container) {
    context.log.error('[listBlobs] Missing storage env vars.');
    context.res = {
      status: 500,
      headers: _corsHeaders(),
      body: JSON.stringify({ error: 'Server misconfiguration — storage env vars missing.' }),
    };
    return;
  }

  const prefix = (req.query && req.query.prefix) || '';

  try {
    const cred      = new StorageSharedKeyCredential(account, accountKey);
    const service   = new BlobServiceClient(`https://${account}.blob.core.windows.net`, cred);
    const client    = service.getContainerClient(container);
    const baseUrl   = `https://${account}.blob.core.windows.net/${container}`;

    const blobs = [];
    let truncated = false;
    for await (const b of client.listBlobsFlat(prefix ? { prefix } : {})) {
      blobs.push({
        name:         b.name,
        url:          `${baseUrl}/${b.name}`,
        size:         b.properties.contentLength || 0,
        lastModified: b.properties.lastModified || null,
        createdOn:    b.properties.createdOn || null,
      });
      if (blobs.length >= MAX_BLOBS) { truncated = true; break; }
    }

    context.log(`[listBlobs] ✓ ${blobs.length} blobs (prefix: "${prefix}")${truncated ? ' [truncated]' : ''}`);
    context.res = {
      status : 200,
      headers: { ..._corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body   : JSON.stringify({ blobs, truncated }),
    };
  } catch (err) {
    context.log.error('[listBlobs] Error:', err.message);
    context.res = {
      status: 500,
      headers: _corsHeaders(),
      body: JSON.stringify({ error: 'Failed to list blobs.', detail: err.message }),
    };
  }
};

function _corsHeaders() {
  return {
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
