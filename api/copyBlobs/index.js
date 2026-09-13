// api/copyBlobs/index.js
// POST /api/copyBlobs
// Body: { copies: [ { from: "https://<account>.blob.core.windows.net/<container>/<name>",
//                     to:   "<newProjectId>/<newSiId>/<filename>" }, … ] }   (≤ 200 per call)
//
// Server-side copy of photo blobs INSIDE our container. Used when a project is
// duplicated with "keep photos": before this, the copy pointed at the original's
// blob URLs, so deleting a photo in either project deleted the file the other
// one still showed. Each copy gets its own file under the new project id.
//
// The browser never gets a copy/read-all token — the source is authorised with
// a 10-minute read SAS minted here, per blob, and the destination is written
// with the account key. Per-blob failures are reported, not fatal.

const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require('@azure/storage-blob');

const MAX_COPIES  = 200;
const CONCURRENCY = 8;
const NAME_RE     = /^[a-zA-Z0-9_\-./]+$/;

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: _corsHeaders(), body: '' };
    return;
  }

  const account    = process.env.AZURE_STORAGE_ACCOUNT;
  const accountKey = process.env.AZURE_STORAGE_KEY;
  const container  = process.env.AZURE_BLOB_CONTAINER;

  if (!account || !accountKey || !container) {
    context.log.error('[copyBlobs] Missing storage env vars.');
    context.res = { status: 500, headers: _corsHeaders(), body: JSON.stringify({ ok: false, error: 'Server misconfiguration.' }) };
    return;
  }

  const copies = req.body && Array.isArray(req.body.copies) ? req.body.copies : null;
  if (!copies || !copies.length) {
    context.res = { status: 400, headers: _corsHeaders(), body: JSON.stringify({ ok: false, error: 'Body must contain { copies: [{ from, to }] }' }) };
    return;
  }
  if (copies.length > MAX_COPIES) {
    context.res = { status: 400, headers: _corsHeaders(), body: JSON.stringify({ ok: false, error: `At most ${MAX_COPIES} copies per call` }) };
    return;
  }

  const expectedHost = `${account}.blob.core.windows.net`;
  const base         = `https://${expectedHost}/${container}/`;

  // Validate every entry up front — same rules as deleteBlob (source must be
  // OUR account + container) and getBlobSasUrl (destination name charset).
  const jobs = copies.map(c => {
    const job = { from: String((c && c.from) || ''), to: String((c && c.to) || ''), ok: false, url: null, error: null };
    let parsed;
    try { parsed = new URL(job.from); } catch { job.error = 'invalid from URL'; return job; }
    if (parsed.hostname !== expectedHost) { job.error = 'from: foreign host'; return job; }
    const parts = parsed.pathname.split('/');
    if (parts[1] !== container) { job.error = 'from: container mismatch'; return job; }
    job.srcName = decodeURIComponent(parts.slice(2).join('/'));
    if (!job.srcName) { job.error = 'from: no blob name'; return job; }
    if (!job.to || job.to.length > 512 || !NAME_RE.test(job.to) || job.to.includes('..')) { job.error = 'to: invalid blob name'; return job; }
    if (job.to === job.srcName) { job.error = 'to: same as source'; return job; }
    return job;
  });

  try {
    const cred    = new StorageSharedKeyCredential(account, accountKey);
    const service = new BlobServiceClient(`https://${expectedHost}`, cred);
    const cc      = service.getContainerClient(container);
    const now     = new Date();

    const runnable = jobs.filter(j => !j.error);
    let next = 0;
    async function worker() {
      while (next < runnable.length) {
        const job = runnable[next++];
        try {
          const sas = generateBlobSASQueryParameters({
            containerName: container,
            blobName     : job.srcName,
            permissions  : BlobSASPermissions.parse('r'),
            protocol     : SASProtocol.Https,
            startsOn     : new Date(now.getTime() - 5 * 60 * 1000),
            expiresOn    : new Date(now.getTime() + 10 * 60 * 1000),
          }, cred).toString();
          await cc.getBlobClient(job.to).syncCopyFromURL(`${base}${encodeURI(job.srcName)}?${sas}`);
          job.ok  = true;
          job.url = base + job.to;
        } catch (err) {
          job.error = (err && (err.details && err.details.errorCode)) || (err && err.message) || 'copy failed';
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, runnable.length) }, worker));

    const copied = jobs.filter(j => j.ok).length;
    context.log(`[copyBlobs] ✓ ${copied}/${jobs.length} copied`);
    context.res = {
      status : 200,
      headers: { ..._corsHeaders(), 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        ok: true, copied, failed: jobs.length - copied,
        results: jobs.map(({ from, to, ok, url, error }) => ({ from, to, ok, url, error })),
      }),
    };
  } catch (err) {
    context.log.error('[copyBlobs] Error:', err.message);
    context.res = { status: 500, headers: _corsHeaders(), body: JSON.stringify({ ok: false, error: 'Failed to copy blobs.', detail: err.message }) };
  }
};

function _corsHeaders() {
  return {
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
