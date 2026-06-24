# Quiver AI

Proxy requests to Quiver AI via Replit-managed billing.

## Callback

Use `externalApi__quiver_ai` in `code_execution`.

## Allowed operations

- `POST` `/svgs/generations` - Generate SVGs from a text prompt (JSON or SSE response).
- `POST` `/svgs/vectorizations` - Vectorize a raster image to SVG (JSON or SSE response).
- `GET` `/models{/:model_id}?` - List models or fetch a single model.

Authorization is handled automatically by Replit. Do not pass an `Authorization` header.

## Quickstart

1. Call the callback with a supported `path` and `method`.
2. Put URL params in `query` and inspect `result.body`.

## Example

```javascript
const result = await externalApi__quiver_ai({
  path: '/svgs/generations',
  method: 'POST',
  query: {},
})

console.log(result.status)
console.log(result.body)
```
