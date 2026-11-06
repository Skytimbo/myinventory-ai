# Development handoff

Checkpoint: end of Milestone 1, 2026-10-24. Branch `development` at `5d65f18` before this document's commit.

## Product vision

MyInventory is an easy-to-use system for capturing, organizing, finding, and eventually managing physical possessions.

**Capture quickly. Preserve evidence. Interpret provisionally. Organize progressively. Retrieve intelligently.**

Users should encounter minimal friction, with deeper inquiry available at their discretion.

Guiding principles in force:

- Photos are evidence. They have their own identities, original bytes, and recorded hashes, independent of any inventory item. One photo may support several items, or none yet.
- AI output is provisional. User-entered and user-confirmed details are assertions that AI never silently overwrites; differing AI values become suggestions.
- Identification and valuation are independent. An unknown value is not zero; nonmarketable objects get no invented price; no comparable-sales evidence is claimed unless actually retrieved; stale and legacy estimates do not count as current.
- Capture does not force cataloguing: uploads can stay unsorted.
- Keep a simple modular monolith. No microservices, governance frameworks, or general knowledge graphs without a concrete need.
- Production changes only by explicit, reviewed release. All other work stays local on `development`.

Long-term direction (not started): multi-object photos, room captures, video, better recognition, grouping, labelled containers, location hierarchies, natural-language retrieval, decluttering help, and evidence-preserving exports usable by QuantaIQ.

## Branches and production

| Ref | Commit | Meaning |
|---|---|---|
| `main`, `origin/main` | `d6a6207` | Production. Railway deploys every push to GitHub `main`. Frozen. |
| `development` | this checkpoint | All unreleased work. Local only; never pushed. |

## Status

**Milestone 0, safe local development: complete** (`3e1e9e9`). Local PostgreSQL `myinventory_dev`, `.env.development`, mock AI, photos in `uploads-dev/`, fail-closed guards that refuse any non-local database before connecting.

**Milestone 1, capture evidence and user assertions: complete.**

| Stage | Commit | Delivered |
|---|---|---|
| 1. Evidence foundation | `bbdf444` | Migration 0004 (additive): `capture_sessions`, `capture_batches`, `photos`, `item_photos`, item `notes` and `user_assertions`; registration of existing photos in place |
| 2. Batch capture | `46aaf30` | Multi-photo upload into sessions with optional context, Unsorted photos tray, items created from selected photos |
| 3. Editing and confirmation | `4e44a45` | Edit dialog with provenance labels, one-click confirm, AI suggestions with one-click Use, re-identify preserves assertions |
| 4. Backup and restore | `5d65f18` | Archive `0004_capture_evidence` with all evidence and every photo (including unassigned), hash and relationship checks, `pnpm restore:local` |

Also on `development` and unreleased: valuation-v4 (`c39ad38`).

## Local development

```bash
pnpm dev:setup              # create .env.development, myinventory_dev, schema, synthetic seed
pnpm dev:local              # start the app
open http://localhost:5001  # 5001: macOS AirPlay Receiver holds 5000
pnpm dev:reset              # wipe local rows and uploads-dev photos, re-seed
pnpm dev:reset --empty      # wipe without re-seeding (before a restore)
pnpm restore:local <archive.tar.gz>   # restore into the empty local database
pnpm test:server && pnpm test:client && pnpm exec tsc && pnpm build
```

Details: `docs/LOCAL-DEVELOPMENT.md` (workflow, guards, the old `.env`) and `docs/BACKUP-RESTORE.md`.

At this checkpoint `myinventory_dev` holds a restored copy of synthetic data (11 items, 20 photos, 6 unassigned). The disposable database `mi_m1_restorecheck` (migrated through 0004, empty) remains. The older `mi_*` rehearsal databases contain production copies and must not be deleted or used for development.

## Test results (at `5d65f18`)

- Server: 338/338 passed. Client: 61/61 passed. Type check and production build pass. No new lint warnings.
- Workflow test (`server/tests/backupEndpoint.spec.ts`): batch upload with context → several items → edit and confirm → re-identify keeps confirmations → original bytes served → backup → restore verification.
- Live local run with synthetic data and mock AI:
  - The in-app backup (11 items, 20 photos, 6 unassigned) passed `pnpm restore:verify` into `mi_m1_restorecheck`.
  - `pnpm restore:local` refused while the database had rows. After `dev:reset --empty` it restored the collection, and a second run refused.
  - A backup taken after the restore matched the original exactly (inventory JSON, manifest, CSV, all 20 image files).
- Browser: the restored collection, the Unsorted tray with context, and the edit dialog's provenance labels and suggestions were checked visually on desktop width only.

## Outstanding verification

1. **Real-browser usability.** Not yet done by a person: batch capture with real phone photos (HEIC/large JPEGs, 25+ files), the Unsorted tray, edit, confirm, and Use on a phone-width screen and on desktop. Check that labels and the confirm button read clearly and that nothing feels like a verification chore.
2. **Live 0003 backup compatibility.** Covered by unit tests only. Not yet run: restoring an actual `0003_identify_valuation` archive with `pnpm restore:local`, including the photo registration step that follows. Use an archive made from synthetic data by the `d6a6207` backup script, never a production archive.
3. Playwright end-to-end tests have not been run against Milestone 1.
4. Known gap: files in the uploads folder that no database row refers to are not backed up (2 leftover test files in `uploads-dev`).

## Next recommended task

Run outstanding verification items 1 and 2 as one bounded session before any new feature work.

1. Run `pnpm dev:reset`, then use the app in a real browser, desktop and phone width (`pnpm dev:mobile` for a phone on the same network), with your own non-sensitive test photos. Record usability problems.
2. Make a `0003_identify_valuation` archive from synthetic data: check out `d6a6207` in a separate worktree, then run its `pnpm backup` against a local 0003 database. Restore it with `pnpm dev:reset --empty` and `pnpm restore:local`, and confirm that items, images, and registered photos appear.
3. Fix whatever these turn up, then decide between preparing a production release and starting Milestone 2.

## Production release dependencies (not performed)

A release of `development` to production requires, in order, and only with explicit approval:

1. A pre-migration production backup with the backup script as of `d6a6207` (current `pnpm backup` requires 0004), verified with `pnpm restore:verify` into a local database.
2. Migration `migrations/0004_capture_evidence.sql` applied through the Neon SQL Editor. It is additive (new columns and tables only), and `d6a6207` ignores the new objects, so it can run before the deploy.
3. Merge `development` into `main` and push, which deploys to Railway. This also releases valuation-v4 (`c39ad38`).
4. Once after deploy: signed in, `POST /api/photos/register-existing` to give existing item photos evidence identities (idempotent, files untouched).
5. A post-release backup with the current `pnpm backup` or Download Backup, verified with `pnpm restore:verify` against a local database migrated through 0004.
6. Rollback: redeploy `d6a6207`. Migration 0004 can stay in place, since the old code does not read the new tables or columns. Data entered after the release in notes, assertions, and capture tables would be ignored, not lost.
