<professional_slides>
This reference applies when the user picks the **Professional** theme, asks for a board / investor / exec / quarterly / strategy / IR deck, attaches a memo-style document, or the topic otherwise reads as a serious business deck. It overrides the more decorative defaults in `SKILL.md` — read it end-to-end before drafting the outline or writing any slide.

Professional decks are not "minimalism as decoration." They are dense, content-first documents that happen to be projected. The goal: a director, partner, or board member should be able to read the deck cold, without the speaker, and walk away with the argument.

## Mental model

Three references shape the form:

- **The Pyramid Principle** (Minto). Each slide makes ONE claim. Bullets underneath support that claim. The deck reads top-down: answer first, then justification.
- **Storytelling with Data** (Knaflic). Strip decoration. Direct the eye with contrast and weight, not color or shapes.
- **Tufte data-ink ratio.** Every pixel on the page must do work. If you can remove an element without losing meaning, remove it.

If a design decision conflicts with these, the design decision loses.

## Defaults (apply unless the user overrides)

| Dimension | Default |
| --- | --- |
| Background | Off-white (`#FAFAFA`–`#FFFFFF`) or very dark (`#0A0A0A`–`#111827`). Pick one and hold it across every slide. |
| Accent color | ONE accent, used sparingly. Match the user's brand if `extractBranding` returns one. Otherwise pick a deep, restrained tone with intent — forest, oxblood, charcoal, deep teal, terracotta, burgundy, slate, ochre, plum are all valid; navy is fine too but **do not default to it** — the most common "AI-generated professional deck" tell is reflexive blue. Vary the accent across decks. |
| Typography | One neutral sans-serif family across the deck. Source Sans 3, Inter, IBM Plex Sans, Helvetica Neue, or the company's brand font. A serif (Source Serif, Tinos, EB Garamond) is acceptable as a single-family choice; do not mix display + body. |
| Type weights | Two weights only — regular + bold. Three at most. No light/thin weights; they don't survive projection or print. |
| Imagery | None by default. Add only when it directly carries the argument (e.g. a product screenshot in a roadmap review, a site photo in a real-estate memo). No stock photography. No decorative imagery. No background photos. |
| Charts | Yes, when the slide makes a quantitative claim. See "Charts" below. |
| Tables | Yes, for any structured comparison of 3+ rows or columns. |
| Slide count | Match the user's request. Otherwise default to 8–12. Board decks routinely run 20+ — do not artificially shorten. |
| Density | Each content slide should be readable without the speaker. 6–10 lines of substantive text per slide is normal. Empty slides feel unfinished, not "elegant." |

If the slide skill's defaults conflict with these, this file wins. In particular:

- Ignore "title slide should always include a high-quality generated image" — for professional decks, the title slide is text-only (company name, deck title, date, audience, optional confidentiality marker).
- Ignore "roughly 1 in every 4-5 slides should use a full-bleed image" — professional decks rarely use full-bleed images at all.
- Ignore "rich visual material elevates a deck" — for this mode, restraint elevates the deck.

## Action titles (the most important rule)

Every content slide's title is a complete sentence stating the slide's conclusion. This is called an action title or governing thought.

**Yes:**

- `Revenue grew 38% YoY, led by mid-market expansion`
- `Three of the five risks have mitigations in place`
- `Cash runway extends through Q3 2027 at current burn`

**No:**

- `Revenue` (topic, not a claim)
- `Q3 Update` (chapter heading, not a claim)
- `The numbers` (says nothing)
- `Why Q3 changes everything` (punchline, not a claim — see anti-patterns)

The reader of the title bar alone should be able to reconstruct the deck's argument. After drafting titles, read the titles top-to-bottom in isolation. If the argument doesn't flow, rewrite titles before writing slides.

Pick ONE grammatical form and hold it — past-tense declarative (`Revenue grew 38%`), present-tense declarative (`Three risks have mitigations`), or noun-phrase summary (`38% YoY revenue growth, driven by mid-market`). Mixing forms is the clearest tell of LLM authorship.

## Slide anatomy

A professional content slide has four zones:

1. **Action title** at the top — left-aligned, bold, ~3.2vw. This is the slide's claim.
2. **Body** — the supporting evidence: 3–6 bullets, OR a chart with annotations, OR a 2×N table, OR a comparison framework. ~2.6–3vw body text.
3. **Source / footnote** at the bottom-left — data sources, "as of" dates, sample size, methodology caveats. ~2.2–2.4vw, muted (60% opacity).
4. **Slide number + deck name** at the bottom-right — same scale as the source line. Optional but recommended for IR / board decks.

Hold this anatomy across every content slide. Variation comes from the body zone, not from moving the title around. Footer height, slide-counter position, and source-line wrapping behavior must be identical on every slide — pick one wrapping policy (always one line, or always two) and hold it, anchor the slide counter to the footer's bottom baseline (never to the top of a wrapping source line), and keep the counter format and denominator (= total content-slide count) identical across the deck.

## Layouts to use

Pick 3–4 layouts and rotate them across the deck. Professional decks are valued for consistency, not visual variety.

- **Title + bullets** — workhorse layout. Action title, 3–6 supporting bullets. Each bullet is one line or two; never a paragraph.
- **Title + chart** — action title states the takeaway, chart shows it. Annotate the chart inline (callout, label on the relevant bar/line). Source line at bottom.
- **Title + table** — for comparisons, KPIs, scorecards, financials. Right-align numbers; left-align labels. Bold the column or row the argument hinges on.
- **Two-column** — for before/after, options/recommendation, comparison of two paths. Equal column widths. Each column has a sub-header in the same style.
- **Three-column** — for three options, three workstreams, three quarters. Same rules as two-column.
- **Section divider** — for decks 12+ slides. Single bold word or phrase ("Financials", "Risks", "Recommendation"). Centered. Same background as content slides — no inverse color.
- **Executive summary** — slide 2 of any board / investor deck. Three to five sentences, each on its own line, stating the entire deck's argument. The most important slide; write it last, after the deck is built.

Layouts NOT to use in professional mode: hero photo slides, big-quote slides without context, single-stat slides without a chart, image-text splits, full-bleed anything.

## Charts

Charts are the single highest-leverage element in a professional deck. They earn their space when they:

- Show change over time (line chart, column chart).
- Show composition (stacked bar, sometimes a 100% stacked bar — never a pie if there are more than 3 segments).
- Show ranking (horizontal bar, sorted).
- Show distribution (histogram, box plot).
- Show correlation (scatter — rare in board decks, common in analyst memos).

Use `recharts` (already permitted by `<constraints>`). Configure with:

- **No 3D, no shadows, no gradients on bars.** Flat fills, one color per series. Use a single accent for the series the slide is about; use neutral gray for everything else (call this "data direction" — Knaflic's term).
- **Direct labels over legends** when there are ≤4 series. The reader should not have to bounce between a legend and the chart.
- **Annotate the takeaway in the chart.** Add a callout or label on the bar / point the action title refers to. The chart should make the title self-evident.
- **Axes labeled with units** ($M, %, customers, weeks). Format large numbers ($12.4M, not $12,400,000).
- **Source line below the chart.** "Source: Internal finance, as of Mar 31 2026" or "Source: Gartner Magic Quadrant 2026."
- **No chartjunk.** No drop shadows, no rotated axis labels, no gridlines unless they aid reading, no decorative icons inside the plot area.

If the data point is a single number (`38%`, `$2.1B`, `12 customers`), a chart adds nothing — put the number large with context underneath instead. Reserve charts for ≥3 data points where the relationship matters.

## Tables

Tables are underused in professional decks. They are often the right answer for KPI scorecards, option comparisons, and financial summaries.

- Header row in bold, slightly tinted background (`#F3F4F6` on light backgrounds).
- Right-align all numbers; left-align labels and text.
- Use consistent decimal places within a column.
- Highlight the row or cell the slide's argument depends on (light accent tint behind the cell, or bold text — not both).
- Show units in the header (`Revenue ($M)`), not repeated in every cell.
- Footnotes referenced by superscript number; resolve them in the source line.

## Color

One background, one body text color, one muted text color, one accent. That's the whole palette.

- Background and text must hit WCAG AA contrast (4.5:1 for body, 3:1 for headlines).
- The accent appears only on: bolded keywords in titles where genuinely needed (use sparingly — bold weight alone usually suffices), chart series that carry the argument, table cell highlights, and a thin top/bottom rule on the title slide if used.
- No color-coding bullets. No traffic-light schemes inside paragraphs. If status matters, build a status table — don't paint individual bullets red/yellow/green.

Greens and reds are acceptable in financial charts (up/down, gain/loss) but use them only there.

## Typography

- **Headlines / action titles:** 3–3.6vw, bold, left-aligned.
- **Body bullets:** 2.6–3vw, regular. Aim for the high end of this range — these decks get presented in conference rooms, and body text must be readable from the back row.
- **Sub-headers / column heads:** 2.3–2.6vw, bold.
- **Source / footnote:** 2.2–2.4vw, regular, 60% opacity.
- These ranges are intentionally denser than the default deck scale, and they are the documented exception to the visual-QA body floor: professional body bullets may run down to 2.6vw (never lower), and nothing on any slide renders below 2.2vw.
- **Line height:** 1.35–1.45 on body bullets — looser than the slide-skill default. Dense decks need breathing room within lines, not between sections.
- **No all-caps body text.** All-caps is acceptable on a single label (`CONFIDENTIAL`, section dividers) and nothing else.
- **No italics for emphasis.** Bold or restate. Italics are for titles of works only.

## Anti-patterns — reject on sight

These are the AI-deck patterns that read as slop the moment a serious reviewer opens the file. If you see yourself reaching for any of them, stop.

- **Hero gradients** behind text. No purple-to-pink, no blue-to-cyan, no animated mesh. Solid backgrounds only.
- **Glassmorphism**, frosted blur cards, soft drop shadows on every container. Decorative depth has no place here.
- **Emoji or pictograph icons** in slide bodies (📈 🎯 ✨ 🚀 💡). Use a sparse icon set (`lucide-react`) when an icon genuinely labels a thing — `lucide-react` icons in muted accent color, ~2.2vw, max one icon per bullet. Default to none.
- **Three-feature triplets with circular icons** above each. This is the AI-generated landing-page layout; it has nothing to do with a board deck.
- **Numbered "big stat" walls** ("3X faster", "10X cheaper", "95% retention") with no chart, no source, and no comparison baseline. A stat without a source line is a guess.
- **Punchline titles** ("The moment everything changed", "Why this matters", "Rethinking how we…"). Action titles only.
- **One-word slides** ("Growth.", "Why?", "Risk."). Use a section divider instead, with at most a one-line subtitle.
- **Quote slides without context.** A customer quote can land — if it's followed by who said it, what role, what company, and what year. A floating quote with no attribution is decoration.
- **Pie charts with more than 3 slices.** Convert to a sorted horizontal bar.
- **Right-justified body bullets.** Body copy reads left-to-right, so it left-aligns.
- **"Animated reveals" or any motion.** Professional decks are static. Animation is automatic when the user clicks through — your slide just needs to render.
- **Wordmarks of every company being discussed**, scattered across the slide as decoration. List them in a table or omit.
- **Watermarks, "DRAFT" stamps at low opacity behind text.** If the deck is draft, the title slide says so — don't decorate every page.

## Density and length

Two failure modes, equally bad:

- **Too thin.** A board deck with 5 bullets per slide totaling 30 words. The deck pretends to be a keynote and ends up saying nothing. Real board decks are dense.
- **Too dense.** Paragraphs jammed onto slides as if Word and PowerPoint were the same product. Bullets must be parseable in 2–3 seconds each.

The right density:

- 3–6 bullets per content slide.
- 1–2 lines per bullet, occasionally 3.
- Whole-sentence bullets are OK in professional mode — better than fragments when precision matters. Just keep them short.
- One slide = one claim = roughly 60–120 words of body text.

If a slide has more than ~150 words of body text, split it. If it has fewer than ~30 words and isn't a section divider or executive summary, ask whether the slide is earning its place in the deck.

## What "professional" decks deliberately don't do

- They don't try to be beautiful in a visual-design sense. They aim to be **clear, credible, and complete**.
- They don't use the title slide to set a mood. It states what this is, who it's for, and when.
- They don't avoid repetition. The executive summary, the section dividers, and the closing all restate the same argument. Repetition is the point.
- They don't hide assumptions. Footnote them on the slide where they're used.
- They don't surprise the reader. The argument is in the title; the slide just proves it.

## QA — before declaring the deck done

Walk every slide and verify:

1. **Title test.** Read only the titles, top-to-bottom. Do they tell the full argument? Are they all the same grammatical form? Rewrite any title that isn't a complete claim.
2. **Source test.** Every quantitative claim has a source line. No source = either delete the number or add the source.
3. **Density test.** Each content slide carries 60–120 words. None below 30 (except dividers / title / closing). None above 150.
4. **One-accent test.** The accent color appears only on intentional callouts. If you can see 4+ uses of accent on a single slide, you're decorating.
5. **Chart test.** Every chart's takeaway is restated in either the action title or an inline annotation. The chart never stands alone.
6. **Consistency test.** Same fonts, same background, same title position on every slide. Footer height, slide-counter position, and source-line wrapping must be identical across the deck — fix any slide where the counter orphans on a wrap or the footer height drifts. Variation in body content only.
7. **Boardroom test.** Imagine this deck printed and handed to a non-technical board member. Could they read it without the speaker? If no, the deck isn't professional yet.

Only when all seven pass do you tell the user the deck is ready. Then run the standard `references/visual_qa.md` checklist on top — the platform invariants apply here too.
</professional_slides>
