# fal.ai

Proxy requests to fal.ai via Replit-managed billing.

## Callback

Use `externalApi__falai` in `code_execution`.

## Allowed operations

- `POST` `/fal-ai/bria/background/remove{/}?` - Bria RMBG 2.0 background remove (queue submit).
- `GET` | `PUT` `/fal-ai/bria/requests/:request_id{/:action(status|cancel)}?` - Bria queue lifecycle (model-family-scoped): fetch result, poll status, cancel.

Authorization is handled automatically by Replit. Do not pass an `Authorization` header.

## Quickstart

1. Call the callback with a supported `path` and `method`.
2. Put URL params in `query` and inspect `result.body`.

## Example

```javascript
const result = await externalApi__falai({
  path: '/fal-ai/bria/background/remove{/}?',
  method: 'POST',
  query: {},
})

console.log(result.status)
console.log(result.body)
```
