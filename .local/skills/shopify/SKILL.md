---
name: shopify
description: Build production Shopify storefronts on Replit for physical products, merch, inventory, stock, variants, shipping, and fulfillment. Covers Shopify Store connection setup, Storefront API for buyers, Admin API for catalog setup, Go Live transfer, and merchant-owned compliance boundaries.
---

IMPORTANT: Use Shopify when the user wants to sell physical products, manage inventory, or build a Shopify-hosted storefront/checkout. Do NOT ask the user for Shopify API keys — propose the Shopify Store integration and fetch the Repl-scoped connection yourself. Shopify is the system of record for products, inventory, carts, checkout, and orders; the generated app is only the storefront UI + catalog/cart client. Execute the steps below directly.

## Routing

Default to Shopify, not Stripe, when the user mentions physical products, merch, merchandise, swag, apparel, inventory, stock, shipping, fulfillment, product variants, sizes, colors, Shopify checkout, or selling tangible goods. A concrete tangible product noun counts as a physical-goods signal even when the user never says "physical" — e.g. pens, shirts, mugs, books, ceramics, jewelry, candles, posters, stickers, or apparel. "Build an ecommerce site for selling pens with checkout and payments" is a Shopify request.

Use Stripe instead when the user explicitly asks for custom payment processing, SaaS subscriptions, digital/downloadable goods, donations, invoices, or a non-Shopify checkout — a digital/download cue (e.g. "downloadable poster prints") overrides the product noun. A bare "store"/"storefront"/"checkout"/"ecommerce" with no physical-goods, inventory, shipping, or fulfillment cue is ambiguous: ask one short clarification before choosing Shopify vs Stripe. Do not pivot to Stripe just because a Shopify step (token minting, publication, checkout preview) is blocked — surface the Shopify blocker and continue.

## Helper scripts — write these first

Two reference files do all Shopify I/O. Write them to the project root from `./references/` and run via `shell_exec` (NOT `code_execution` — `process.env` connector vars are unavailable there). The OpenInt proxy injects Admin auth; never handle Admin tokens yourself.

- **shopify-admin-api.mjs** (source: `./references/shopify-admin-api.mjs`) — one-off Admin GraphQL calls through the OpenInt proxy, for catalog setup only:

  ```bash
  node shopify-admin-api.mjs '{"query":"query { shop { name myshopifyDomain } }"}'
  ```

- **shopifyStorefrontClient.ts** (source: `./references/shopifyStorefrontClient.ts`) — server-side Storefront API client for buyer flows. It fetches the connection from OpenInt, extracts `shop_domain` + `storefront_access_token`, pins the API version, and exposes `shopifyStorefrontRequest<T>()`. Put it behind API routes / server actions / SSR-only modules; never read connector env vars from browser code.

## Step 1: Connect

1. Propose the Shopify Store integration if this Repl has no Shopify Store connection assigned (reference the `integrations` skill). The `shopify-store` connector is **app-scoped** — a connection belongs to exactly one Repl.
2. `listConnections('shopify-store')` in `code_execution`, then select only a connection assigned to the current Repl/app. A connection on another Repl is NOT connected for this Repl — create a fresh one instead of reusing its ID; do not suggest switching providers.
3. Fetch settings from `/api/v2/connection?include_secrets=true&connector_names=shopify-store&refresh_policy=none` with `X_REPLIT_TOKEN`. Read only `shop_domain` and `storefront_access_token` from `items[0].settings` for app code (Shopify treats the Storefront token as public buyer-facing auth). Do not surface `shop_id`, Admin tokens, or `pending_transfer` (Go Live status only) in app UI. The payload has no publication ID, claim link, or dev-store flag — resolve those at runtime.

If the merchant asks to transfer/claim the store (whether at connect time or later), do not attempt it from app code — direct them to the Shopify integration's management surface in the workspace: open the **Integrations** tab, go to **Shopify** and click **Manage**. (Navigate by UI surface rather than emitting a `replit.com` URL — that surface is environment-correct in dev/staging/prod, whereas a hardcoded host would send staging/local sessions to the wrong environment.) See Step 5 for the full Go Live flow.

## Step 2: Stop after connect

Onboarding is done once all three hold: the connection is assigned to this Repl, the app renders a static empty/connected storefront state from placeholders, and you have asked the user what they want to sell. Do NOT, as part of onboarding: query Storefront/Admin APIs, scaffold a catalog/products route, or seed demo products/collections/inventory/publications. Everything below is explicit follow-up work, triggered only when the user asks.

## Step 3: Catalog setup (Admin API, only when the user asks to add products)

Run setup through `shopify-admin-api.mjs`. Setup/seed scripts are orchestration only (which products to create, which local mapping file to write); every Admin request must go through the proxy helper with `Connector-Name: shopify-store`. Do not call `https://{shop_domain}/admin/...` directly, use Admin SDK clients, or read Admin tokens. For the whole sequence, prefer copying the known-good `./references/seed-products.mjs` golden script (replace its `PRODUCTS` array, run it) rather than hand-assembling the mutations — it already implements the order, idempotency, and error handling below.

See `./references/code-templates.md` → "Create, price, stock, and publish a product" for the exact GraphQL. The required order and the mutations to copy:

1. Look the product up by `handle` (`productByHandle`) first and reuse its IDs if it exists; otherwise `productCreate` → product `id` (set `status: "ACTIVE"`). `productCreate` is not idempotent, so the handle check keeps re-runs from duplicating products.
2. Query `product.variants` for the variant `id` (this is the Storefront cart `merchandiseId` — persist/render it, never invent IDs) and `inventoryItem { id }`.
3. `productVariantsBulkUpdate` to set price.
4. Inventory, in this exact order or stock is silently unenforced: `inventoryItemUpdate({ tracked: true })` → `inventoryActivate(inventoryItemId, locationId)` → read the current `available` level, then `inventoryAdjustQuantities` with a per-change `changeFromQuantity` compare-and-set. Resolve the location with `locations(first: 1)`; never hardcode it. Shopify requires the `@idempotent(key: ...)` directive at the **field** level (stable per-item key, e.g. the handle) on `inventoryActivate` and `inventoryAdjustQuantities`; omitting it fails with `The @idempotent directive is required for this mutation but was not provided`. (`inventorySetQuantities` also works but on `2026-04` dropped `ignoreCompareQuantity` and requires a per-item `changeFromQuantity`.)
5. Resolve the Replit-owned publication via `currentAppInstallation { publication { id } }` (the connection payload has none) — this is the authoritative Replit Sales Channel, the same lookup the `shopify-store` connector uses. If absent, fall back to the publication named exactly `Online Store` (match the exact name, not a broad `Sales Channel` substring that would catch unrelated channels like `Google & YouTube Sales Channel`); on a transferred live store, gate that fallback behind explicit user confirmation since it exposes products on the merchant's existing storefront. Then `publishablePublish`. If neither exists, skip publishing and tell the user the Sales Channel publication is not provisioned yet.

Inspect `userErrors` on every mutation and stop on the first non-empty array. Products are invisible to the Storefront API until active AND published to a storefront-visible publication. For batches >20 items use `bulkOperationRunMutation`, and throttle on `extensions.cost.throttleStatus` (the helper does not auto-throttle).

## Step 4: Buyer storefront (Storefront API)

Use `shopifyStorefrontRequest` from `shopifyStorefrontClient.ts` directly for buyer flows — do NOT route buyer traffic through OpenInt. See `./references/code-templates.md`:

- "Query products in app code" → product/variant lists for catalog/product pages.
- "Create a cart and redirect to Shopify checkout" → `cartCreate` with a ProductVariant `id` as `merchandiseId`, then `cartLinesAdd`/`Update`/`Remove`, then send the buyer to `cart.checkoutUrl`. Checkout and payment happen on Shopify — do not implement custom payment collection.

Cache product responses (Storefront API allows ~60 req/min/IP); don't call it from a hot client render loop. On a 401/403, refetch the connection settings once and retry (the helper does this); if still failing, stop and report that the connector-provided `storefront_access_token` may need recreating — do not pivot to Admin draft orders, cart permalinks, or disabling the store password.

**Dev-store preview:** Vibe/dev stores are password protected. If `checkoutUrl` hits the password page, keep the real cart and append `channel=online_store` (see `createCheckoutUrl`'s `useDevStorePreview` option in code-templates.md). The connection has no dev-store flag, so this is a caller-controlled option driven by environment — turn it OFF for live stores. Never ask the user to disable password protection.

## Step 5: Go Live (only when the merchant asks)

Do not transfer the store during build/provisioning. When the merchant asks to go live, walk the checklist and use the Shopify Store integration management actions; see `./references/code-templates.md` → "Go Live behavior".

- **Store transfer:** transfer is handled by Replit's Shopify integration management surface, not by app code. When the merchant asks to claim/transfer the store, direct them to it by UI navigation rather than a `replit.com` URL: open the **Integrations** tab, go to **Shopify** and click **Manage**. (That surface is environment-correct in dev/staging/prod; a hardcoded host would send staging/local sessions to the wrong environment.) From there the transfer runs against the existing connection. Do not mint a claim link from app code, collect raw Shopify credentials, or recreate the connection (transfer mutates the existing one). Surface `pending_transfer` if useful.
- **Status/deep-link only (merchant-owned in Shopify):** plan selection, Shopify Payments / gateway KYC (never collect banking/SSN/tax-ID PII), shipping zones/rates (`write_shipping` is intentionally not scoped — you may suggest starter defaults in chat but must not apply them), taxes (tell them to consult a tax professional), custom domain, and removing the storefront password / launching the Online Store.
- **Legal policies:** you may draft first-pass policy text with a lawyer-review disclaimer.
- After transfer, if OpenInt reports `reauthorization_required`, stop Admin writes and tell the user to reconnect via the Integrations tab; the connection ID stays stable. Stop appending the dev-store preview param once targeting the live storefront.

Example response when the merchant asks to claim/transfer the store — explain it's a merchant-owned action, give the UI-navigation steps, and set expectations:

> Claiming/transferring the store isn't something I can do from code — it's a merchant-owned action you start in Replit's Shopify integration surface:
>
> 1. Open the **Integrations** tab in your workspace (left sidebar).
> 2. Find **Shopify** and click **Manage**.
> 3. Start the transfer/claim flow. Shopify will email you to accept ownership of the `<shop>.myshopify.com` store into your own Shopify account.
>
> A few things to know:
>
> - The connection ID stays the same after transfer, so your storefront keeps working with no code changes.
> - Once the store is live (no longer a dev store), the `channel=online_store` checkout-preview param should be turned off — tell me when the transfer is done and I'll flip the dev-store-preview flag.
> - You'll still handle these yourself in the Shopify admin (they need your real identity/banking): pick a plan, set up Shopify Payments (KYC), configure shipping zones/rates, taxes, custom domain, and remove the storefront password to open the Online Store.
> - If Shopify ever asks the integration to reconnect after transfer, go back to the Integrations tab and reconnect — don't delete and recreate the connection.

Shopify webhooks (order created/cancelled, inventory changed) are not wired through this connector in v1 — pull data on user-driven refresh or framework cache revalidation; do not register Shopify webhooks from app code.

## App configuration (for reference)

The installed Sales Channel App is a channel app, so `currentAppInstallation.publication.id` is available via Admin GraphQL at setup time. Scopes: `write_products`, `write_inventory`, `read_locations`, `read_publications`/`write_publications`, `unauthenticated_read_product_listings`, `unauthenticated_read_product_inventory`, `unauthenticated_read_checkouts`/`unauthenticated_write_checkouts`.

If you believe two Repls are the same app but OpenInt reports a different `repl_id`, report the two IDs and ask platform code owners to investigate — do not attach another Repl's connection.

## Rules (these override anything above)

- Treat Shopify as the system of record for products, inventory, carts, checkout, and orders; store only minimal local mappings (handles, product IDs, variant IDs, cart IDs).
- Route every Admin write through `shopify-admin-api.mjs` (OpenInt proxy); never own Admin auth, implement Shopify OAuth, or mint Admin/Storefront tokens in app code.
- Route buyer Storefront calls directly to Shopify via `shopifyStorefrontClient.ts` with the connector-provided public token; never ask the user to paste a token.
- Use Shopify hosted checkout via `cart.checkoutUrl`. Do not build buyer checkout from Admin draft orders unless the user explicitly asks for invoice-style manual orders.
- Do not hardcode publication, location, product, variant IDs, or shop domains — resolve them from Shopify or the connection at runtime.
- Do not seed products/collections/inventory during onboarding; do not query a non-existent Admin `storefrontAccessTokens` root field.
- Do not initiate transfer unless the merchant chooses Go Live; do not recreate the connection on transfer or reauthorization.
- If Admin writes fail because the store was transferred or the app uninstalled, explain Shopify needs reauthorization and stop — do not ask for raw tokens.

## References

- `./references/shopify-admin-api.mjs` — Admin GraphQL helper through the OpenInt proxy.
- `./references/seed-products.mjs` — known-good runnable catalog seed script (create/price/stock/publish; idempotent and safe to re-run).
- `./references/shopifyStorefrontClient.ts` — Storefront API client (`shopifyStorefrontRequest`) for app code.
- `./references/code-templates.md` — copy-ready snippets: product create/price/stock/publish, product queries, cart + checkout redirect, Go Live behavior.
