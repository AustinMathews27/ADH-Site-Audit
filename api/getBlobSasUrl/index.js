// api/getBlobSasUrl/index.js
// GET /api/getBlobSasUrl
//
// Returns a short-lived SAS URL for the Azure Blob Storage container.
// The browser uses this token to upload photos directly to Blob Storage
// without ever seeing the account key.
//
// Required Application Settings (Azure Portal → Function App → Configuration):
//   AZURE_STORAGE_ACCOUNT  = your storage account name  (e.g. "adhauditphotos")
//   AZURE_STORAGE_KEY      = key1 from Storage Account → Access keys
//   AZURE_BLOB_CONTAINER   = your container name        (e.g. "site-photos")

const {
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require('@azure/storage-blob');

module.exports = async function (context, req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: _corsHeaders(), body: '' };
    return;
  }

  const account    = process.env.AZURE_STORAGE_ACCOUNT;
  const accountKey = process.env.AZURE_STORAGE_KEY;
  const container  = process.env.AZURE_BLOB_CONTAINER;

  if (!account || !accountKey || !container) {
    context.log.error('[getBlobSasUrl] Missing env vars: AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY, or AZURE_BLOB_CONTAINER');
    context.res = {
      status: 500,
      headers: _corsHeaders(),
      body: JSON.stringify({ error: 'Server misconfiguration — storage env vars missing.' }),
    };
    return;
  }

  // Per-blob scoping: ?blob=<name> narrows the token to create/write on that
  // single blob path. A container-wide write token would let any holder
  // overwrite ANY photo in the container for an hour.
  const blobName = (req.query && req.query.blob || '').trim();
  if (blobName && (!/^[a-zA-Z0-9_\-./]+$/.test(blobName) || blobName.includes('..'))) {
    context.res = {
      status: 400,
      headers: _corsHeaders(),
      body: JSON.stringify({ error: 'Invalid blob name.' }),
    };
    return;
  }

  try {
    const cred      = new StorageSharedKeyCredential(account, accountKey);
    const now       = new Date();
    const expiresOn = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

    const sasToken = generateBlobSASQueryParameters(
      blobName
        ? {
            containerName: container,
            blobName,
            permissions  : BlobSASPermissions.parse('cw'), // create/write THIS blob only
            protocol     : SASProtocol.Https,
            startsOn     : new Date(now.getTime() - 5 * 60 * 1000),
            expiresOn,
          }
        : {
            containerName: container,
            permissions  : BlobSASPermissions.parse('r'), // legacy no-blob callers: read-only
            protocol     : SASProtocol.Https,
            startsOn     : new Date(now.getTime() - 5 * 60 * 1000), // 5 min clock-skew buffer
            expiresOn,
          },
      cred
    ).toString();

    const sasUrl = blobName
      ? `https://${account}.blob.core.windows.net/${container}/${blobName}?${sasToken}`
      : `https://${account}.blob.core.windows.net/${container}?${sasToken}`;

    context.log(`[getBlobSasUrl] ✓ SAS issued. Expires: ${expiresOn.toISOString()}`);

    context.res = {
      status : 200,
      headers: { ..._corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body   : JSON.stringify({ sasUrl, expiresOn: expiresOn.toISOString() }),
    };
  } catch (err) {
    context.log.error('[getBlobSasUrl] Error:', err.message);
    context.res = {
      status: 500,
      headers: _corsHeaders(),
      body: JSON.stringify({ error: 'Failed to generate SAS token.', detail: err.message }),
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
