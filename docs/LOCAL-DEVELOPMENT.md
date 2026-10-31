# Local development

MyInventory runs on this Mac against a local PostgreSQL database with synthetic data, generated images, and mock AI. Nothing in this workflow can reach production.

## Branches

- **`main`**: what production runs. Railway deploys every push to GitHub `main`.
- **`development`**: where new work happens. Local until a release is explicitly approved; Railway never deploys it.

## One-time setup

Requirements: PostgreSQL running locally (Homebrew `postgresql@17`), `pnpm install` done.

```bash
pnpm dev:setup     # creates .env.development, database myinventory_dev, schema, synthetic seed
pnpm dev:local     # starts the app with .env.development
```

Open **http://localhost:5001**. Port 5001 is used because macOS AirPlay Receiver occupies port 5000; to use 5000, turn off *System Settings › General › AirDrop & Handoff › AirPlay Receiver* and set `PORT=5000` in `.env.development`.

- `.env.development` is created from `.env.development.example` and is git-ignored. It contains no secrets: a local database URL, `ANALYZER_PROVIDER=mock`, a placeholder OpenAI key that is never used, and a development session secret. Sign-in is off locally (`INVENTORY_PASSWORD` unset).
- Photos are stored in `uploads-dev/` (git-ignored), separate from `uploads/`.
- The seed contains 9 synthetic items covering every valuation state: item estimate (untested), category baseline, nonmarketable, insufficient information, legacy amount, legacy 0.00 placeholder, Quick Capture, stale estimate, and a three-photo item whose estimate has no recorded basis.

`pnpm dev:reset` removes all local rows and `uploads-dev/items` and `uploads-dev/photos`, then re-seeds. `pnpm dev:reset --empty` does the same without re-seeding (used before `pnpm restore:local`). `pnpm dev:setup` also registers existing item photos as photo evidence (idempotent).

## Capture, editing, and confirmation (Milestone 1)

Photos are evidence in their own right, independent of inventory items (`photos`, `capture_sessions`, `capture_batches`, `item_photos`; migration 0004). A photo can be linked to several items, or to none.

- **Batch capture** (header button): choose or name a capture session, add up to 25 photos per upload (more are sent in chunks), and optionally record context: location, container, category, purpose. Uploading creates no inventory entries.
- **Unsorted photos** tray: photos not yet linked to an item, with their context. Select the photos that show one thing (up to 10), optionally name it, optionally tick *Identify with AI now*, and create the item. *Show all photos* lets you reuse an already-linked photo for another item.
- Context becomes item details marked *From capture*: category → category, location and container → location (`Garage › Blue bin`), purpose → notes (`Purpose: donate`). A typed name is recorded as yours.
- **Edit** (pencil next to the name): name, description, category, tags, location, notes. Each field shows who supplied it: *Confirmed by you*, *From capture*, or *AI suggested*. Saving records only the changed fields as yours.
- **Looks right — confirm** (card footer, shown when AI-supplied details are unconfirmed): one click records the current AI values as yours. A check mark next to the name means it is confirmed.
- **Re-identify** never overwrites details you entered or confirmed, or capture context. When the AI disagrees, its value appears under the field in Edit as *AI suggests: … Use*; *Use* applies it and records it as your choice.
- Changing name, description, or category marks a current estimate stale (`user_edited`); location and notes do not.
- Original photos are served unchanged at their `/objects/photos/<id>.<ext>` paths (hash recorded at capture).

API: `GET/POST /api/capture-sessions`, `POST /api/capture-sessions/:id/batches`, `GET /api/photos[?unassigned=true]`, `POST /api/items/from-photos`, `PATCH /api/items/:id` (`fields`, `confirm`, `acceptSuggestions`), `POST /api/photos/register-existing`.

## Backup and restore locally

With `pnpm dev:local` running:

```bash
curl -s -o backups/local.tar.gz http://localhost:5001/api/backup   # or Download Backup in the app
pnpm dev:reset --empty                                            # empties myinventory_dev and uploads-dev
pnpm restore:local backups/local.tar.gz                           # loads the archive back
```

`pnpm restore:local` reads only `.env.development`, refuses a non-local or non-empty database and any photo file that already exists, verifies every hash and relationship first, and inserts all rows in one transaction. Reload the app to see the restored collection. See `docs/BACKUP-RESTORE.md`.

## Production protection (fail-closed)

All of these refuse any database that is not PostgreSQL on this machine, **before connecting**, with no override:

| Command | Purpose |
|---|---|
| `pnpm dev`, `pnpm dev:local` (any non-production start) | app start |
| `pnpm dev:setup`, `pnpm dev:reset` | local database setup |
| `pnpm db:reset`, `scripts/reset-inventory.ts` | destructive resets |
| `pnpm db:seed` | seeding |
| `scripts/run-migration.ts` | migrations |
| `pnpm db:push` (drizzle-kit) | schema push |
| `pnpm restore:verify` (`DATABASE_URL_TEST`) | restore verification target |
| `pnpm restore:local` (`.env.development` only; empty database only) | local restore |

Local means `localhost`, `127.0.0.1`, `::1`, or a local Unix socket. After connecting, the server itself must also report a loopback address and must not be Neon, which catches an SSH tunnel or hosts-file entry that makes a remote server look local. Refusal messages show only host, port, and database name, never the connection string.

Production schema changes are made only through reviewed procedures in the Neon SQL Editor (see `docs/AI-IDENTIFY-VALUATION.md`). `scripts/backup.ts` intentionally still reads production (read-only SELECT) for pre-migration backups.

The production app (`NODE_ENV=production` on Railway) is unchanged: it keeps the Neon HTTP driver. Locally, a `localhost` database uses the node-postgres driver.

## The old `.env`

`.env` predates this setup and holds production-pointing values (a production `DATABASE_URL`, OpenAI credentials, a session secret). `dev:local` does not load it, and every command in the table above refuses its database. What still reads it:

- `pnpm dev` and `pnpm dev:mobile`: load it, then refuse its database.
- `pnpm backup`: reads `DATABASE_URL` if set; the pre-migration backup procedure passes credentials explicitly instead.
- `pnpm restore:verify`: uses `DATABASE_URL` only to refuse a target equal to it; the target must now be local anyway.
- `pnpm ai:eval` does not read `.env` at all.

So the production values in `.env` are no longer needed for development. Removing them (or the whole file) is recommended; production credentials belong in Railway and your password manager.
