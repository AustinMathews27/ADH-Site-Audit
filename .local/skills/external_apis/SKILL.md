---
name: external_apis
description: "Access external APIs through Replit-managed billing"
---

# External APIs

This skill provides access to external APIs through Replit-managed
passthrough billing. Requests are proxied through OpenInt with
managed credentials.

## Recommended workflow

1. Open the connector reference for request and response details.
2. Call `externalApi__<connector_name>` from `code_execution`.
3. Use `query` for URL parameters and parse `result.body`.
4. For media URLs, save files under `attached_assets/` and present them.

## Available APIs

- [Brave](references/brave.md) - Search real web image results through Brave passthrough billing.
- [Browserbase](references/browserbase.md)
- [ElevenLabs](references/elevenlabs.md)
- [Exa](references/exa.md)
- [fal.ai](references/falai.md)
- [Firecrawl](references/firecrawl.md)
- [LlamaIndex](references/llamaindex.md)
- [Mindee](references/mindee.md)
- [Nano Banana](references/nano_banana.md)
- [Quiver AI](references/quiver_ai.md)
- [Shotstack](references/shotstack.md)
- [Tripo3D](references/tripo3d.md)
- [X (Twitter)](references/x.md)
