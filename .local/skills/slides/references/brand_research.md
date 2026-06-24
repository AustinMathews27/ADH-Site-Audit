# Brand Research — Real and Real-Sounding Entities

Run this path before drafting an outline whenever the deck names a real or real-sounding company, product, organization, or public figure. **A name that *sounds* like a real company triggers research even if you do not recognize it** — your training data is incomplete and stale. Never invent brand tokens, revenue, headcount, dates, or product facts for a named entity.

## Triggers

Run the path when the prompt names:

- A company, product, organization, or brand (Stripe, Notion, Anthropic, Patagonia).
- Anything that *reads* like a real company even if unfamiliar (Acme Cloud, Lumen Labs, Mercury, Apollo). Verify with a real lookup; do not assume "I haven't heard of it" means "it isn't real".
- A public figure — a notable person with publicly documented work (CEO, athlete, author, politician, musician).

Do **not** trigger for:

- Generic topics or verticals: "a deck about dogs", "pitch deck for a fintech", "slides about coffee".
- Private people (friends, family, internal teammates). If unsure, treat as private.
- URLs used as content sources (Wikipedia, news, blog posts). `webFetch` them for facts; do not run `extractBranding`.

A URL only triggers brand research when it's the brand's own official site **and** the deck is about that brand.

## Source precedence

User-attached assets are the highest-priority source of truth — above every research tool. Use them verbatim. Do not run `extractBranding`, `imageSearch`, `webFetch`, or `webSearch` to "double-check" or "find a better version" of anything the user supplied.

Skip only the steps an attachment actually covers:

- Brand guide / hex codes / fonts → skip step 1.
- Logo file → skip step 2b.
- Per-slide content or script → skip step 3 for facts already in the copy.
- Explicit opt-out ("don't look anything up", "just use what I gave you") → skip every step.
- Editing or importing an existing deck → skip the full path; re-run only the specific steps needed when the user asks for refreshed data ("update with latest revenue", "add a recent-news slide").

## Research order

Run in order. Stop as soon as the outline has enough.

- **Step 0 — Confirm the official URL.** A user-supplied URL only becomes the confirmed brand URL when it is clearly the named entity's own official site (matching domain, e.g. `tesla.com` for a Tesla deck) **or** the user explicitly framed it as the brand source ("use this as the brand site", "branding from <url>"). If the supplied URL is a news article, Wikipedia page, blog post, or other third-party page — even when the prompt also names a brand — keep it in the content-research path (`webFetch` it for facts only, do **not** run `extractBranding` or branded fetches against it) and run a 1–2 query `webSearch` to find the brand's actual official site. If no URL was supplied, run the same 1–2 query `webSearch`. If two candidates look equally plausible (Mercury bank vs Mercury browser, Apollo GraphQL vs Apollo mission, etc.), **ask the user** before any branded fetch.
- **Step 1 — `extractBranding`** on the confirmed URL. One call. Returns colors, fonts, logo, positioning.
- **Step 2a — `webFetch`** on up to 3 pages from homepage + about + product/pricing for real tagline and 2–3 verifiable facts.
- **Step 2b — `imageSearch`** for a clean logo *only* if step 1's logo was missing, low-res, or a favicon placeholder. Prefer the company's own domain or a reputable press kit. Save to `attached_assets/`.
- **Step 3 — `webSearch`** for facts the company doesn't publish (third-party stats, market data, recent news). One batched call, 3–5 queries max. If a stat doesn't surface from a reputable source, omit it or mark `[unverified]`.
- **Step 4 — `imageSearch`** for hero / product / team / press photos when the outline calls for real-world imagery. Counts against the 4-call total below.
- **Step 5 — `media-generation`** only for generic, abstract, or stylized visuals (backgrounds, mood imagery, generic illustrations). **Never** generate a company logo or any specific real person/product/place/event without explicit user approval.

### Public-figure variant

Skip step 1 and step 2b (a person has no logo). Run step 0 only if the name is ambiguous, then step 2a (official site, Wikipedia, pressroom) + step 3 + an optional step 4 for a press photo.

## Budget caps

Soft caps per deck — billable passthrough calls. If the outline is accurate after steps 1 + 2a, stop.

| Tool | Cap |
| --- | --- |
| `extractBranding` | 1 |
| `webFetch` | 3 |
| `webSearch` | 1 batched fact call (3–5 queries) + optional 1–2 query step-0 disambiguation |
| `imageSearch` | 4 total (logo + image slides combined) |

## Failures

Fall through, never silently substitute invented content.

- `extractBranding` fails → step 2a for positioning, step 2b for the logo, step 3 only as a last resort for brand colors.
- `webFetch` returns 404 / empty → try one alternate path (`/about`, `/company`, `/products`), then step 3.
- `webSearch` returns nothing useful → surface to the user; use generic copy for the affected slides.
- `imageSearch` fails for a **logo or any specific real subject** (named person, product, venue, event) → leave the slot empty and surface. **Do not** fall through to `media-generation`.
- `imageSearch` fails for a **generic** non-logo visual (abstract texture, anonymous skyline) → fall through to step 5.

## Surface gaps to the user

If a mandatory step failed for a named entity, the user must hear about it before the deck is built. Pick the channel for your path and wait for a response:

- Outline path → add a short note to the `proposeSlideContent` prompt.
- Skipped-outline path (per-slide content supplied, opt-out, etc.) → post a short chat message before writing slides.
- Edit / import refresh → same chat-message rule before writing the new content.

Example notes:

> "I couldn't pull live brand data from stripe.com. Colors and positioning here are my best guess — attach a brand guide or correct anything off."
>
> "I couldn't find a clean logo for <company>. I left it empty on slides 1 and 8 — drop a logo file in or tell me to generate a stand-in."
>
> "<company>'s revenue isn't published; I marked those slides `[unverified]`. Confirm or I'll drop them."

This is the safety valve. Hide the gap and the user ships a deck with hallucinated facts.
