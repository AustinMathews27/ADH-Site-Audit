# LlamaIndex

Proxy requests to LlamaIndex via Replit-managed billing.

## Callback

Use `externalApi__llamaindex` in `code_execution`.

## Allowed operations

- `POST` `/api/v2/parse` - Parse a file via LlamaParse v2. Bills page count × tier rate after polling status to terminal, with an explicit layout/chart add-on surcharge when requested.
- `POST` `/api/v1/beta/files` - Upload a file for a later billable LlamaCloud job. No charge — upload stores file bytes but does not consume document processing credits. File list/read/delete and page asset endpoints are intentionally not allowlisted for global credentials.

Authorization is handled automatically by Replit. Do not pass an `Authorization` header.

## Quickstart

1. Call the callback with a supported `path` and `method`.
2. Put URL params in `query` and inspect `result.body`.

## Example

```javascript
const result = await externalApi__llamaindex({
  path: '/api/v2/parse',
  method: 'POST',
  query: {},
})

console.log(result.status)
console.log(result.body)
```
