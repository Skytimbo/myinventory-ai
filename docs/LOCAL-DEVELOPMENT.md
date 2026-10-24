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

`pnpm dev:reset` removes all local rows and `uploads-dev/items`, then re-seeds.

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
