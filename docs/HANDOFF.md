# Handoff — read this first, update it before you stop

## Last session
- **Date:** 2026-09-18
- **Device:** Claude Code web (cloud session)
- **Branch:** `feature/company-profiles` (8 commits ahead of `main`, no PR yet)
- **Summary:** Reconstructed pending work from commits after a Windows chat was
  lost. Added `CLAUDE.md` + this handoff so every future session reads/writes it.

## Pending
- [ ] **Company profiles slice 2+** — slice 1 only gates import buttons per
      company (`COMPANY_PROFILES` in `index.html`). Decide and build what else a
      profile controls (branding, PDF defaults, project types, etc.).
- [ ] **Real AML logo** — `logos/aml.svg` is a temporary wordmark. PDF branding
      entry still uses id `adh` / `logos/adh.png` because stored logos are keyed by it.
- [ ] **Docs stale** — `docs/FULL-GUIDE.md` still lists ADH instead of AML and
      neither guide mentions company profiles or Entra sign-in (README does).
- [ ] **Version bump** — code still says v8.53; `main` shipped v8.54. Bump
      `index.html` version + `sw.js` cache name before merging this branch.
- [ ] **Entra sign-in is staging-only** — set `ALLOWED_EMAIL_DOMAINS` on the
      Static Web App before enabling on prod; `scripts/*.mjs` stop working
      anonymously once auth is on (see README "Sign-in").
- [ ] **Open a PR** for `feature/company-profiles` → `main` when ready.
- [ ] **Stale PR #3 "task 1"** (`hardening/deps-offline`, July) — close or rebase.

## Done (recent)
- `ece9678` Entra ID sign-in with offline-first identity (staging)
- `73c54b8` AML temporary SVG wordmark
- `96dfe2b` Rename company ADH → AML (legacy id `adh` kept)
- `dc2064a` Company profiles slice 1 (per-company import buttons, companyId stamp)
- `ff0f28c` Staging: configurable Cosmos DB name + seed script

## Decisions
- 2026-09-18 — Every session must read/update this file and push (see `CLAUDE.md`).
- 2026-09-12 — AMI is the only company on Innergy; others import from spreadsheet or manual entry.
- 2026-09-12 — Everyone shares ONE workspace; Entra only identifies who is on the device.
