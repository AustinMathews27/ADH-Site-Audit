# Shopify Code Templates

These are reference snippets. Adapt them to the app's routing, framework, and state patterns.

For end-to-end catalog seeding, prefer copying the known-good `./seed-products.mjs` golden script (it wires the snippets below together in the correct order with the required `@idempotent` directives and re-run safety) rather than hand-assembling the sequence from these snippets.

Admin setup scripts are orchestration only and should not run during integration onboarding. Only create products/inventory after the user explicitly asks for catalog setup. Scripts should resolve publication and location IDs dynamically, check every mutation's `userErrors`, and write only stable mapping data (handles, product IDs, variant IDs) after Shopify confirms success. Every Admin API call must go through the OpenInt proxy helper; do not call Shopify Admin endpoints directly or handle Admin tokens in generated app code.

## Create, price, stock, and publish a product

Use `shopify-admin-api.mjs` through the OpenInt proxy.

Do not replace this helper with a direct `https://{shop_domain}/admin/...` request, Shopify Admin SDK client, or custom OAuth/token flow. OpenInt owns Shopify Admin authentication.

Make seed scripts safe to re-run: `productCreate` does **not** support the `@idempotent` directive, so look the product up by its stable `handle` first and reuse the existing product/variant/inventoryItem IDs instead of creating a duplicate. Only call `productCreate` when the handle does not already exist.

```graphql
query ProductByHandle($handle: String!) {
  productByHandle(handle: $handle) {
    id
    variants(first: 1) { nodes { id inventoryItem { id } } }
  }
}
```

```bash
node shopify-admin-api.mjs '{
  "query": "mutation ProductCreate($product: ProductCreateInput!) { productCreate(product: $product) { product { id title handle } userErrors { field message } } }",
  "variables": {
    "product": {
      "title": "Example T-shirt",
      "handle": "example-t-shirt",
      "descriptionHtml": "<p>Soft cotton shirt.</p>",
      "status": "ACTIVE"
    }
  }
}'
```

After product creation, query variants and inventory item IDs. The variant ID is the cart `merchandiseId`; the inventory item ID is needed to set stock:

```graphql
query ProductVariants($productId: ID!) {
  product(id: $productId) {
    variants(first: 20) {
      nodes {
        id
        title
        price
        availableForSale
        inventoryItem { id }
      }
    }
  }
}
```

Set price and inventory before publishing. Use `productVariantsBulkUpdate` for prices:

```graphql
mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id price }
    userErrors { field message }
  }
}
```

For inventory, run three steps in order before any quantity write — newly created products are not tracked or activated at a location by default, so `inventorySetQuantities` against an inert inventory item silently leaves storefront stock unenforced or returns `userErrors`.

1. Enable tracking on the inventory item so quantity changes have effect:

```graphql
mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
  inventoryItemUpdate(id: $id, input: $input) {
    inventoryItem { id tracked }
    userErrors { field message }
  }
}
```

Variables (one call per inventory item):

```json
{ "id": "<inventoryItem.id>", "input": { "tracked": true } }
```

1. Activate the inventory item at the resolved location so a stock level exists there. Shopify **requires** the `@idempotent` directive on this mutation — attach it at the **field** level (on `inventoryActivate`, not on the operation) with a stable per-item key so a retried seed does not double-apply or get rejected with `The @idempotent directive is required for this mutation but was not provided`:

```graphql
mutation InventoryActivate($inventoryItemId: ID!, $locationId: ID!) {
  inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId)
    @idempotent(key: "activate-<stable-per-item-key>") {
    inventoryLevel { id }
    userErrors { field message }
  }
}
```

1. Set the actual quantity with a compare-and-set adjustment. Read the current `available` level first, then apply the delta with `inventoryAdjustQuantities`, which **requires** the `@idempotent` directive at the **field** level with a stable per-item key. The per-change `changeFromQuantity` is the CAS field — pass the value you just read so a concurrent change fails loudly instead of silently clobbering (pass `null` to skip the check):

```graphql
query InventoryLevel($id: ID!, $locationId: ID!) {
  inventoryItem(id: $id) {
    inventoryLevel(locationId: $locationId) {
      quantities(names: ["available"]) { name quantity }
    }
  }
}
```

```graphql
mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input)
    @idempotent(key: "setqty-<stable-per-item-key>") {
    inventoryAdjustmentGroup { id }
    userErrors { field message }
  }
}
```

Variables (one change per inventory item; `delta = target - current`):

```json
{
  "input": {
    "name": "available",
    "reason": "correction",
    "changes": [
      {
        "inventoryItemId": "<inventoryItem.id>",
        "locationId": "<location.id>",
        "delta": 100,
        "changeFromQuantity": 0
      }
    ]
  }
}
```

`inventorySetQuantities` is an alternative that sets an absolute value, but on API version `2026-04` it dropped `ignoreCompareQuantity` and requires a per-item `changeFromQuantity` (pass `null` to skip the CAS check) plus the same `@idempotent` directive — prefer the `inventoryAdjustQuantities` delta form above.

Use a stable key derived from the item (e.g. the product handle), not a random value, so re-running the seed is safe. Always inspect `userErrors` on each of these and stop on the first non-empty array; the activation step in particular can fail if `read_locations` / `write_inventory` scopes are missing or the location ID does not belong to the store.

Resolve the publication ID at runtime; the connection payload does not expose one. Prefer the Replit-owned channel: the installed Replit Sales Channel App is a channel app, so its own publication is authoritative — resolve it directly via `currentAppInstallation` (this is how the Replit `shopify-store` connector identifies it):

```graphql
query AppPublication {
  currentAppInstallation {
    publication { id }
  }
}
```

If `currentAppInstallation.publication` is absent, fall back to the publication named exactly `Online Store` so the storefront is not empty:

```graphql
query Publications {
  publications(first: 20) {
    nodes { id name }
  }
}
```

Match the **exact** name `Online Store` — do not match a broad `Sales Channel` substring (it catches unrelated channels like `Google & YouTube Sales Channel`). On a transferred live merchant store, publishing to `Online Store` makes products visible on their existing storefront, so gate that case behind explicit user confirmation. If neither publication exists, skip publishing and tell the user the Sales Channel publication is not provisioned yet.

Then publish with `publishablePublish`, after price and inventory are configured:

```graphql
mutation Publish($productId: ID!, $publicationId: ID!) {
  publishablePublish(id: $productId, input: [{ publicationId: $publicationId }]) {
    publishable { publishedOnPublication(publicationId: $publicationId) }
    userErrors { field message }
  }
}
```

If no suitable publication exists, skip publishing and tell the user the Shopify Sales Channel publication is not yet provisioned for this connection.

Resolve inventory location dynamically; do not hardcode location IDs:

```graphql
query Locations {
  locations(first: 1) {
    nodes { id name }
  }
}
```

## Query products in app code

The helper fetches the Shopify Store connection from OpenInt with `include_secrets=true`, extracts only `shop_domain` and `storefront_access_token` from `items[0].settings`, pins the Storefront API version in code, and calls Shopify Storefront API directly with the connector-provided Storefront token. Keep this helper server-side behind API routes, server actions, SSR-only modules, or setup scripts; browser UI should call your server boundary. App code should not ask the user to paste tokens or route buyer Storefront traffic through OpenInt by default.

```ts
import { shopifyStorefrontRequest } from "./shopifyStorefrontClient";

const PRODUCTS_QUERY = `#graphql
  query Products {
    products(first: 12) {
      nodes {
        id
        title
        handle
        featuredImage { url altText }
        priceRange { minVariantPrice { amount currencyCode } }
        variants(first: 10) { nodes { id title availableForSale } }
      }
    }
  }
`;

export async function getProducts() {
  return shopifyStorefrontRequest<{
    products: { nodes: Array<unknown> };
  }>(PRODUCTS_QUERY);
}
```

## Create a cart and redirect to Shopify checkout

The `variantId` below is the Shopify ProductVariant GID from the Storefront product query (`products.nodes[].variants.nodes[].id`) or from Admin GraphQL after creating the product. It is the value Shopify expects as `merchandiseId`.

```ts
import { shopifyStorefrontRequest } from "./shopifyStorefrontClient";

const CART_CREATE = `#graphql
  mutation CartCreate($variantId: ID!, $quantity: Int!) {
    cartCreate(input: { lines: [{ merchandiseId: $variantId, quantity: $quantity }] }) {
      cart { id checkoutUrl }
      userErrors { field message }
    }
  }
`;

export async function createCheckoutUrl(
  variantId: string,
  quantity = 1,
  // `useDevStorePreview` is caller-controlled. The Shopify Store connection
  // does not expose a dev-store flag; pass true when running against a
  // Vibe/dev preview environment and false (default) for live storefronts.
  options: { useDevStorePreview?: boolean } = {},
) {
  const data = await shopifyStorefrontRequest<{
    cartCreate: {
      cart: { checkoutUrl: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(CART_CREATE, { variantId, quantity });

  const error = data.cartCreate.userErrors[0];
  if (error) {
    throw new Error(error.message);
  }

  if (!data.cartCreate.cart?.checkoutUrl) {
    throw new Error("Shopify did not return a checkout URL");
  }

  const checkoutUrl = new URL(data.cartCreate.cart.checkoutUrl);
  if (options.useDevStorePreview) {
    // Vibe-created development stores are password protected. Shopify's Vibe
    // docs recommend this preview parameter so checkout links work before the
    // merchant claims/transfers the store. Disable this for live stores.
    checkoutUrl.searchParams.set("channel", "online_store");
  }

  return checkoutUrl.toString();
}
```

Do not replace Storefront cart checkout with Admin API draft orders. Admin API is for setup/product writes; buyers should use Storefront cart + Shopify-hosted checkout.

If opening `checkoutUrl` hits the dev-store password page, keep the real cart and add `channel=online_store`. If `cartCreate` itself returns 401/403, refetch the Shopify Store connection settings once and retry with the direct Shopify Storefront API helper above; do not ask the user to paste a token.

## Go Live behavior

Do not bake transfer or launch steps into generated storefront code. Go Live is an integration-management workflow:

- The merchant explicitly clicks/asks for Go Live.
- The connection payload does not expose a claim link. Direct the merchant to Replit's Shopify integration management surface by UI navigation rather than a `replit.com` URL: open the **Integrations** tab, go to **Shopify** and click **Manage**, and initiate the transfer there. (That surface is environment-correct in dev/staging/prod; a hardcoded host would send staging/local sessions to the wrong environment.) Do not have generated app code call an OpenInt connector RPC directly to mint a claim link. Surface `pending_transfer` status from the connection if useful.
- If the merchant provides first and last name, the Go Live surface can pass them along with the transfer request; otherwise Replit/OpenInt may derive a minimal display name from the email for Shopify's transfer API. Do not collect or persist raw Shopify credentials in generated app code.
- The generated app keeps reading the same Shopify connection. Dev-store preview behavior (`channel=online_store`) is caller-controlled — toggle it off once the app is targeting the live storefront.
- If Shopify Admin actions start returning reauthorization-required status after transfer, ask the merchant to reconnect Shopify rather than creating a new connection.
- Taxes, payments KYC, plan selection, and storefront password removal stay merchant-owned actions in Shopify.
