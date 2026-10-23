# Backup and Restore

MyInventory AI backup v1 is a manual disaster-recovery workflow. It is not the same as the CSV/PDF export: a backup is an archive with lossless inventory JSON and the actual image files needed to reconstruct the inventory.

There are two ways to create the same archive format. Both produce an archive that `pnpm restore:verify` accepts. Either way, the archive is written off-box (your browser's download folder or your laptop), not left on Railway.

## In-App Backup

Sign in and click **Download Backup** on the home page. The browser downloads `myinventory-backup-<timestamp>.tar.gz`.

- The download is served by `GET /api/backup`, which requires a signed-in session. Signed-out requests get `401`.
- The server reads records through the app's normal database connection and images directly from the uploads volume. No credentials are written into the archive.
- If any database-referenced image is missing from the volume, the server returns a JSON error (`BACKUP_INCOMPLETE`) listing the missing paths and no archive is downloaded.
- If an image changes while the archive is streaming, or the connection drops, the download is aborted rather than finishing with an archive that does not match its manifest. Retry the download.
- Requests are rate limited to 10 per hour per client (`BACKUP_RATE_LIMITED`).
- The browser holds the whole archive in memory before saving it. For very large image libraries, prefer the script below.

## Script Backup

Run script backups from your laptop, not inside Railway. The script pulls records from Neon and images from the authenticated deployed app, then writes the archive off-box.

Required environment variables:

```bash
export DATABASE_URL='postgresql://...'
export APP_URL='https://your-app.up.railway.app'
export INVENTORY_PASSWORD='your inventory login password'
```

Optional:

```bash
export BACKUP_DIR='./backups'
```

Run:

```bash
pnpm backup
```

The script writes:

```text
backups/myinventory-backup-<timestamp>.tar.gz
```

Archive contents:

- `manifest.json`: backup metadata, schema version, counts, image hashes, and completeness audit results.
- `inventory.json`: lossless source of truth for restore verification, including the `identification` and `valuation` columns (archive schema version `0003_identify_valuation`).
- `inventory.csv`: human-readable convenience export with value status, estimate range, staleness, evidence basis, and any legacy estimate in separate columns. Do not use this for restore.
- `images/`: image files referenced by the database (downloaded from authenticated `/objects/*` URLs by the script, or read from the uploads volume by the in-app backup).

The backup fails if any database image reference cannot be downloaded. Backup v1 audits database-referenced images only; it does not list the Railway volume, so unreferenced orphan files on the volume are outside this check.

After creating a backup, copy the archive somewhere that is itself backed up, such as Time Machine, an external drive, or cloud file storage. `./backups/` is intentionally gitignored.

## Restore Verification

Restore verification proves that an archive can be loaded into a test database and that image bytes still match the backup manifest.

Required environment variables:

```bash
export DATABASE_URL='postgresql://...'       # production DB; used only to refuse unsafe targets
export DATABASE_URL_TEST='postgresql://...'  # test DB only
export RESTORE_UPLOADS_DIR='/tmp/myinventory-restore-uploads'
```

`DATABASE_URL_TEST` must not point at the same database as `DATABASE_URL`. The verifier refuses to run if they match.

`RESTORE_UPLOADS_DIR` must be empty or absent. The verifier copies restored images into this directory using the same relative layout the app expects under `uploads/`.

Run:

```bash
pnpm restore:verify backups/myinventory-backup-<timestamp>.tar.gz
```

What verification does:

- extracts the archive to a temporary directory;
- validates `manifest.json` and `inventory.json`;
- copies archive images into `RESTORE_UPLOADS_DIR`;
- compares restored image SHA256 hashes against the manifest;
- compares `analysisMetadata.imageHash` where older/newer records provide it;
- inserts inventory records into `DATABASE_URL_TEST` inside a transaction;
- checks restored item count;
- rolls back the transaction so the test database is not left changed.

Restore verification accepts `0003_identify_valuation` archives and older `0002_analysis_metadata` archives; the latter restore `identification` and `valuation` as null. `DATABASE_URL_TEST` must have migration 0003 applied.

The archive-level checks (everything except the database insert) live in `scripts/restore-verify-archive.ts`. The server test suite runs them against archives built from synthetic data, including archives downloaded from `GET /api/backup`, so format regressions are caught without a database.

If `analysisMetadata.imageHash` mismatches but manifest hashes match, the archive is internally consistent and the mismatch may mean the production `/objects/*` endpoint served transformed bytes instead of canonical upload bytes. Investigate before trusting the backup for real recovery.

## Production Restore Runbook

This runbook is intentionally manual for v1. Practice it against a disposable Railway/Neon environment before relying on it for a real incident.

1. Provision a fresh Neon/Postgres database.
2. Apply the current schema and migrations, including `migrations/0002_analysis_metadata.sql` and `migrations/0003_identify_valuation.sql`.
3. Extract the backup archive locally:

   ```bash
   mkdir -p /tmp/myinventory-restore
   tar -xzf backups/myinventory-backup-<timestamp>.tar.gz -C /tmp/myinventory-restore
   ```

4. Load `inventory.json` into the fresh database using a purpose-built restore script or SQL import adapted from `scripts/restore-verify.ts`. Use `inventory.json`; do not restore from CSV.
5. Restore image files from `/tmp/myinventory-restore/images/items/...` onto the app volume under `uploads/items/...` or Railway's mounted `/app/uploads/items/...`.
6. Deploy the app with the restored `DATABASE_URL`, `LOCAL_STORAGE_DIR=/app/uploads`, `SESSION_SECRET`, and `INVENTORY_PASSWORD`.
7. Sign in and confirm item list, image loading, and a sample item detail view.
8. Run a fresh backup and `pnpm restore:verify` against the restored environment to prove the recovery path.

## Limitations

- Backup v1 is manual. It only protects changes made before the last time you ran it or downloaded it in-app.
- Backup v1 does not enumerate Railway volume orphan files that are not referenced by the database.
- Backup v1 does not upload archives to cloud storage. Copy archives to a backed-up destination after creation.
