---
name: image-search
description: Find real web images, logos, and public photos for brand work, reports, and artifacts. Use when you need a few relevant results with a title and image URL you can inspect, present, or download.
---

# Image Search

Search the public web for real images.

## When to Use

- You need real logos, transparent PNGs, or brand assets from the web
- You need real-world photos or reference images from the public web

## When NOT to Use

- Generating new images or illustrations (use the `media-generation` skill)
- General fact lookup or webpage text retrieval (use the `web-search` skill)
- Extracting brand colors, fonts, and other official tokens from a website (use `extractBranding` first)

## Available Function

### `imageSearch({ query, count })`

Search for public web images and return the raw provider response body.

**Parameters:**

- `query` (str, required): Search text for the desired images
- `count` (int, optional): Maximum number of results to return

**Returns:** Dict with optional `results` list. For each result, rely on `result.title` and `result.properties?.url`; other provider-specific fields may also be present.

**Example response:**

```json
{
  "type": "images",
  "query": {
    "original": "mid-century chair",
    "spellcheck_off": false,
    "show_strict_warning": false
  },
  "results": [
    {
      "type": "image_result",
      "title": "Mid-century chair in walnut",
      "url": "https://example.com/chairs",
      "source": "example.com",
      "page_fetched": "2026-04-17T23:51:41Z",
      "thumbnail": {
        "src": "https://imgs.example.com/thumb.jpg",
        "width": 500,
        "height": 333
      },
      "properties": {
        "url": "https://imgs.example.com/full.jpg",
        "placeholder": "https://imgs.example.com/placeholder.jpg",
        "width": 1200,
        "height": 800
      },
      "meta_url": {
        "scheme": "https",
        "netloc": "example.com",
        "hostname": "example.com",
        "favicon": "https://example.com/favicon.ico",
        "path": "› chairs"
      },
      "confidence": "high"
    }
  ],
  "extra": {
    "might_be_offensive": false
  }
}
```

**Example:**

```javascript
const response = await imageSearch({
  query: "vintage travel posters",
  count: 6,
})

const items = response.results ?? []
for (const item of items.slice(0, 4)) {
  console.log(item.title, item.properties?.url)
}
```

## Present Results

When showing image results to the user:

1. Pick up to 4 strong results
2. Download each image URL into `attached_assets/image_search/`
3. Call `presentAsset({awaitUserInput: false})` for each saved file

```javascript
const fs = await import('node:fs/promises')
const path = await import('node:path')

const response = await imageSearch({
  query: "mid-century chair",
  count: 4,
})

const items = (response.results ?? []).slice(0, 4)
await fs.mkdir('attached_assets/image_search', {recursive: true})

for (const [index, item] of items.entries()) {
  const imageUrl = item.properties?.url
  if (!imageUrl) continue

  const download = await fetch(imageUrl)
  if (!download.ok) continue

  const filePath = path.join(
    'attached_assets/image_search',
    'result_' + String(index + 1) + '.jpg',
  )

  await fs.writeFile(filePath, Buffer.from(await download.arrayBuffer()))

  await presentAsset({
    filePath,
    title: item.title ?? 'Image search result',
    awaitUserInput: false,
  })
}
```

## When called from the slides skill

The slides skill runs `imageSearch` as part of its brand-research steps in `../slides/references/brand_research.md`. That reference owns the order (run `extractBranding` first, use `imageSearch` for the logo only when the first step's logo is missing or low quality, and use `imageSearch` for real-world photos like product / team / venue shots) and the budget (at most 4 `imageSearch` calls per deck).

**Specific real subjects have a special rule.** If `imageSearch` cannot find a clean image of a logo, a named person, a specific real product, a real team, a real venue, or a real event, leave the slot empty and surface the gap to the user. **Do NOT auto-generate a stand-in via `media-generation` without explicit user approval** — a fabricated logo or fake "real" photo for a named entity is exactly the failure mode the research steps exist to prevent. The `media-generation` fallback applies only to **generic, non-specific** visuals (abstract backgrounds, mood imagery, anonymous skylines, generic illustrations). In named-entity decks (product launches, founder profiles, company overviews) the deck subject often makes product, team, and venue slots specific — treat those as real subjects and leave them empty until the user approves a stand-in. Align with `../slides/references/brand_research.md` → "Failures".

Follow these steps rather than improvising the order — these are billable passthrough calls.

## Best Practices

1. Use `imageSearch`, not provider-specific passthrough callbacks, so the implementation can change underneath without changing your code.
2. For logos, search `"<company> logo png"` or `"<company> logo transparent"` and prefer official domains, press kits, or brand asset pages.
3. Present a small shortlist of the best results instead of dumping the full response body.
4. Use `extractBranding` first for official brand tokens, then fall back to `imageSearch` only when the logo is missing, low quality, or clearly wrong.
5. Keep `count` small when you are manually reviewing results. `4` to `8` is usually enough.
6. Save chosen image URLs into `attached_assets/` before presenting or reusing them elsewhere.
7. Remember that `count` is the maximum number of results, not the total number of results. When presenting to the user, there may be less results presented than how many you requested.
