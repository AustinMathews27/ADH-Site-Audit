# ADH Site Audit — rules for every Claude session

Sessions run from many devices (Windows, iPad, Android, web) and none of them
share chat history. The repo is the only memory that travels. So:

## Rule 1 — read the handoff first
Before doing anything else, read `docs/HANDOFF.md`. It lists what was in
progress, what is pending, and what was decided. Treat it as the previous
chat's last words. If the user asks "where were we", answer from it.

## Rule 2 — write the handoff before you stop
Before ending a turn that changed anything (code, docs, config, decisions,
even a plan agreed in chat), update `docs/HANDOFF.md`:
- move finished items to **Done** with the commit hash,
- add anything new or still open to **Pending**,
- record decisions the user made under **Decisions** (one line each),
- update the **Last session** block (date, device if known, branch, summary).
Then commit and push. A handoff that is only in chat, or only on disk, is lost.

## Rule 3 — commit and push often
Push to the working branch after every coherent step, not just at the end.
Anything uncommitted disappears when the session or container goes away.
Use `git push -u origin <branch>`. Never push to `main` directly; work on the
feature branch named in the handoff unless the user says otherwise.

## Rule 4 — keep the handoff short
It is a checklist, not a diary. One line per item, most recent first.
Prune Done items older than two sessions.

## Project notes
- Single-file PWA: `index.html` (app), `sw.js` (service worker), `pdf-export.js`.
  Bump the version string in `index.html` and the cache name in `sw.js` together
  when shipping, or installed devices keep serving the old build.
- Backend is Azure Functions in `api/`; Cosmos + Blob storage; deploys via
  the Static Web Apps workflows in `.github/workflows/`.
- Six company folders: A.S.S.T, AMI, ACD, ACS, AML (was ADH), ACM.
