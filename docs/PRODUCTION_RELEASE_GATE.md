# Rumi Wawqi POS — production provenance and release gate

Status as of 2026-11-04: **PRODUCTION RELEASE BLOCKED; GITHUB CODE RECONCILED**.

## Verified evidence

- Vercel project: `rumi-wawqi-pos`; production deployment `dpl_FHAfT1iHcQRamQAtFgk621ebdSzB`, reported READY.
- Deployment metadata references repository commit `187236e63fa459adc14d7f68df0abb1caf9bec1a`, but the actual Vercel CLI-uploaded file tree contains `src/index.html`, `src/service-worker.js`, `src/manifest.webmanifest`, and three `src/icons/*.png` files.
- Those `src/` application files are absent from the inspected GitHub branches, including the referenced commit. The deployed file contents are **not fully recovered** in this repository.
- `main` at `6bb5f1c298753d8a0ec675164a707c0a6e32f7f9` and the referenced deployment commit diverged. The reconciled branch merges the deployment commit with PR #6, preserving the `lib/shift-core.mjs` domain engine, privacy guard, browser tests, and item timestamp fix.
- Reconciled CI: 39 Node tests on Node 20, 39 on Node 22, two Playwright Chromium tests, publication guard. This tests the **repository** code, **not** the unrecovered live PWA.

## Consequence

**Never assume that pushing `main` or deploying the repository's `app/` directory reproduces the existing iPad POS.** A new deployment from this tree could replace the operating PWA with a distinct reference UI. Users may also depend on device-local offline storage or service-worker caches; changing origins, paths or storage keys may interrupt operations or appear to erase history.

## Mandatory release conditions

1. Recover the exact production PWA sources (`src/` including binary icons) from the original local deployment directory or an authorized Vercel source export. Verify file count and cryptographic checksums against the deployed artifact where obtainable.
2. Add the recovered application source to a protected Git branch without mixing it up with `app/`. Determine the exact Vercel root directory, build/output settings and the release command.
3. Inspect deployed browser persistence: storage mechanism (IndexedDB/localStorage), database names/keys, schema, service-worker update and cache behavior. Document a non-destructive migration, or prove that none is required.
4. Obtain and verify a restorable offline backup from a **non-production test device/profile** before performing migration tests. Never copy or publish real customer data or personal identifiers into GitHub.
5. Reproduce the existing deployed behavior in a preview, compare its source and routes with production, and run end-to-end sales, kitchen, offline reload, history and backup/restore tests against the **actual** PWA.
6. Apply the `creadoEn` correction only to the actual PWA implementation after a failing regression has demonstrated the omission there. The repository reference UI fix alone does not prove the live PWA is repaired.
7. Stage a production-targeted build without changing the live alias; perform smoke and data-retention checks. Promote only after explicit operational approval, with an identified rollback deployment and verified device backup.

## Current safe actions

- Review/merge code-only reconciliation PR into GitHub once repository checks are green; this does not authorize a production release.
- Keep the existing production Vercel alias and deployment intact.
- Locate original `src/index.html` and `src/service-worker.js` on the machine that ran the Vercel CLI deployment, or use a permitted complete-source export from Vercel.

## Blockers

Vercel's file-content connector provided only a truncated copy of the large `src/index.html`; authenticated URL fetch returned HTTP 403. Treat both as incomplete evidence and obtain the original source through the account owner. Do not attempt to reconstruct a production cash register from a truncated artifact.
