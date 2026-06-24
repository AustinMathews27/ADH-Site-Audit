# Tripo3D

Proxy requests to Tripo3D via Replit-managed billing.

## Callback

Use `externalApi__tripo3d` in `code_execution`.

## Allowed operations

- `POST` `/task` - Submit a Tripo3D generation task. Cost is read from data.consumed_credit on GET /v2/openapi/task/{task_id} after the task reaches a terminal status. Covers every billable body.type uniformly.
- `GET` `/task/:task_id` - Poll a previously submitted task by id. Free — Tripo does not charge for status queries.

Authorization is handled automatically by Replit. Do not pass an `Authorization` header.

## Quickstart

1. Call the callback with a supported `path` and `method`.
2. Put URL params in `query` and inspect `result.body`.

## Example

```javascript
const result = await externalApi__tripo3d({
  path: '/task',
  method: 'POST',
  query: {},
})

console.log(result.status)
console.log(result.body)
```
