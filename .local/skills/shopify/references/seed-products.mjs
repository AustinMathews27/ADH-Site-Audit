// Golden, runnable Shopify catalog seed script.
//
// Copy this file (and `shopify-admin-api.mjs`) to the project root, replace the
// PRODUCTS array with the real catalog, and run it inside the Repl shell:
//
//   node seed-products.mjs
//
// Every Shopify Admin GraphQL call goes through `shopify-admin-api.mjs` (the
// OpenInt proxy boundary). This script is orchestration only: it decides which
// products to create and which mapping file to write. It never talks to the
// Shopify Admin endpoint directly and never handles Admin tokens.
//
// It is safe to re-run: products are looked up by `handle` before creation, and
// the inventory mutations carry the `@idempotent` directive Shopify requires.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ADMIN_HELPER = "shopify-admin-api.mjs";
const MAPPING_FILE = "shopify-products.json";

// Replace with the real catalog. `handle` must be unique and stable per product
// — it is the idempotency key for re-runs.
const PRODUCTS = [
  {
    handle: "example-t-shirt",
    title: "Example T-shirt",
    descriptionHtml: "<p>Soft cotton shirt.</p>",
    price: "29.00",
    quantity: 25,
  },
];

function adminGraphQL(query, variables = {}) {
  const result = spawnSync("node", [ADMIN_HELPER, JSON.stringify({ query, variables })], {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Failed to run ${ADMIN_HELPER}: ${result.error.message}`);
  }
  const stdout = result.stdout || "";
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Non-JSON response from ${ADMIN_HELPER}:\n${stdout}\n${result.stderr || ""}`);
  }
  // The helper exits non-zero on top-level `errors` or nested `userErrors`.
  // Surface the actual Shopify message rather than just the exit code.
  if (result.status !== 0) {
    const topLevel = Array.isArray(parsed?.errors) ? parsed.errors : [];
    const messages = topLevel.map((e) => e.message).filter(Boolean);
    throw new Error(`Shopify Admin error: ${messages.join("; ") || stdout}`);
  }
  // Cost-based throttling: back off when the bucket is nearly drained.
  const throttle = parsed?.extensions?.cost?.throttleStatus;
  if (throttle && throttle.currentlyAvailable < throttle.maximumAvailable * 0.2) {
    const restoreMs = (throttle.maximumAvailable - throttle.currentlyAvailable) / throttle.restoreRate * 1000;
    spawnSync("sleep", [String(Math.ceil(restoreMs / 1000))]);
  }
  return parsed.data;
}

function firstUserError(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node.userErrors) && node.userErrors.length > 0) {
    const e = node.userErrors[0];
    return e.message || JSON.stringify(e);
  }
  return null;
}

function resolveLocationId() {
  const data = adminGraphQL(`query Locations { locations(first: 1) { nodes { id name } } }`);
  const location = data.locations.nodes[0];
  if (!location) throw new Error("No Shopify location found; cannot set inventory.");
  return location.id;
}

function resolvePublicationId() {
  // Prefer the Replit-owned channel: the installed Replit Sales Channel App is a
  // channel app, so its own publication is authoritative. Resolve it directly via
  // currentAppInstallation — the same lookup the Replit shopify-store connector
  // uses.
  const installData = adminGraphQL(
    `query AppPublication { currentAppInstallation { publication { id } } }`,
  );
  const appPublicationId = installData.currentAppInstallation?.publication?.id;
  if (appPublicationId) return appPublicationId;

  // Fallback: publish to "Online Store" so the storefront is never empty. Match
  // the exact channel name only (not a broad "Sales Channel" substring, which
  // would catch unrelated channels like "Google & YouTube Sales Channel"). On a
  // live merchant store this makes products visible on their existing
  // storefront — acceptable for the Replit/Vibe dev-store seed flow this script
  // targets; gate it behind user confirmation for a transferred live store.
  const data = adminGraphQL(`query Publications { publications(first: 20) { nodes { id name } } }`);
  const nodes = data.publications.nodes || [];
  const onlineStore = nodes.find((p) => p.name === "Online Store");
  return onlineStore ? onlineStore.id : null;
}

function findExisting(handle) {
  const data = adminGraphQL(
    `query ProductByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        id
        variants(first: 1) { nodes { id inventoryItem { id } } }
      }
    }`,
    { handle },
  );
  const product = data.productByHandle;
  if (!product) return null;
  const variant = product.variants.nodes[0];
  return {
    productId: product.id,
    variantId: variant?.id ?? null,
    inventoryItemId: variant?.inventoryItem?.id ?? null,
  };
}

function createProduct(product) {
  const data = adminGraphQL(
    `mutation ProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          handle
          variants(first: 1) { nodes { id inventoryItem { id } } }
        }
        userErrors { field message }
      }
    }`,
    {
      product: {
        title: product.title,
        handle: product.handle,
        descriptionHtml: product.descriptionHtml ?? "",
        status: "ACTIVE",
      },
    },
  );
  const err = firstUserError(data.productCreate);
  if (err) throw new Error(`productCreate failed for ${product.handle}: ${err}`);
  const created = data.productCreate.product;
  const variant = created.variants.nodes[0];
  return {
    productId: created.id,
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem.id,
  };
}

function setPrice(variantId, productId, price) {
  const data = adminGraphQL(
    `mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price }
        userErrors { field message }
      }
    }`,
    { productId, variants: [{ id: variantId, price }] },
  );
  const err = firstUserError(data.productVariantsBulkUpdate);
  if (err) throw new Error(`price update failed: ${err}`);
}

function setInventory(inventoryItemId, locationId, quantity, key) {
  // 1. Track the inventory item so quantity changes take effect.
  let data = adminGraphQL(
    `mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem { id tracked }
        userErrors { field message }
      }
    }`,
    { id: inventoryItemId, input: { tracked: true } },
  );
  let err = firstUserError(data.inventoryItemUpdate);
  if (err) throw new Error(`inventoryItemUpdate failed: ${err}`);

  // 2. Activate the item at the location. @idempotent is REQUIRED at the field
  //    level with a stable key.
  data = adminGraphQL(
    `mutation InventoryActivate($inventoryItemId: ID!, $locationId: ID!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId)
        @idempotent(key: "activate-${key}") {
        inventoryLevel { id }
        userErrors { field message }
      }
    }`,
    { inventoryItemId, locationId },
  );
  err = firstUserError(data.inventoryActivate);
  if (err) throw new Error(`inventoryActivate failed: ${err}`);

  // 3. Set the quantity with a compare-and-set adjustment. Read the current
  //    "available" level first, then apply the delta. @idempotent is REQUIRED
  //    on inventoryAdjustQuantities (2026-04), and `changeFromQuantity` is the
  //    CAS field — pass the value we read so a concurrent change fails loudly
  //    instead of silently clobbering. Skip the write entirely when already
  //    correct so re-runs are no-ops.
  const current = readAvailable(inventoryItemId, locationId);
  const delta = quantity - current;
  if (delta !== 0) {
    data = adminGraphQL(
      `mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input)
          @idempotent(key: "setqty-${key}-${quantity}") {
          inventoryAdjustmentGroup { id }
          userErrors { field message }
        }
      }`,
      {
        input: {
          name: "available",
          reason: "correction",
          changes: [{ inventoryItemId, locationId, delta, changeFromQuantity: current }],
        },
      },
    );
    err = firstUserError(data.inventoryAdjustQuantities);
    if (err) throw new Error(`inventoryAdjustQuantities failed: ${err}`);
  }
}

function readAvailable(inventoryItemId, locationId) {
  const data = adminGraphQL(
    `query InventoryLevel($id: ID!, $locationId: ID!) {
      inventoryItem(id: $id) {
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available"]) { name quantity }
        }
      }
    }`,
    { id: inventoryItemId, locationId },
  );
  const quantities = data.inventoryItem?.inventoryLevel?.quantities ?? [];
  return quantities.find((q) => q.name === "available")?.quantity ?? 0;
}

function publish(productId, publicationId) {
  if (!publicationId) return false;
  const data = adminGraphQL(
    `mutation Publish($productId: ID!, $publicationId: ID!) {
      publishablePublish(id: $productId, input: [{ publicationId: $publicationId }]) {
        publishable { publishedOnPublication(publicationId: $publicationId) }
        userErrors { field message }
      }
    }`,
    { productId, publicationId },
  );
  const err = firstUserError(data.publishablePublish);
  if (err) throw new Error(`publishablePublish failed: ${err}`);
  return true;
}

function main() {
  const locationId = resolveLocationId();
  const publicationId = resolvePublicationId();
  if (!publicationId) {
    console.log(
      "No Replit Sales Channel or Online Store publication found; creating products without publishing. " +
        "Tell the user the Sales Channel publication is not provisioned yet.",
    );
  }

  const mapping = {};
  for (const product of PRODUCTS) {
    const existing = findExisting(product.handle);
    const ids = existing ?? createProduct(product);
    if (existing) {
      console.log(`Reusing existing product ${product.handle}`);
    } else {
      console.log(`Created product ${product.handle}`);
    }

    setPrice(ids.variantId, ids.productId, product.price);
    setInventory(ids.inventoryItemId, locationId, product.quantity, product.handle);
    const published = publish(ids.productId, publicationId);

    mapping[product.handle] = {
      productId: ids.productId,
      variantId: ids.variantId,
      inventoryItemId: ids.inventoryItemId,
      published,
    };
  }

  // Persist only stable mapping data, after Shopify confirms success.
  writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 2));
  console.log(`Seed complete. Wrote ${MAPPING_FILE} with ${Object.keys(mapping).length} product(s).`);
}

main();
