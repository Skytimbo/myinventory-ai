# Backup and Restore

MyInventory AI backup v1 is a manual disaster-recovery workflow. It is not the same as the in-app CSV/PDF export: backup v1 creates a local archive with lossless inventory JSON and the actual image files needed to reconstruct the inventory.

Run backups from your laptop, not inside Railway. A Railway-side archive still lives on the app box or mounted volume; a laptop-run backup pulls records from Neon and images from the authenticated deployed app, then writes the archive off-box.

## Backup

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
- `inventory.json`: lossless source of truth for restore verification.
- `inventory.csv`: human-readable convenience export. Do not use this for restore.
- `images/`: image files downloaded from authenticated `/objects/*` URLs.

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

If `analysisMetadata.imageHash` mismatches but manifest hashes match, the archive is internally consistent and the mismatch may mean the production `/objects/*` endpoint served transformed bytes instead of canonical upload bytes. Investigate before trusting the backup for real recovery.

## Production Restore Runbook

This runbook is intentionally manual for v1. Practice it against a disposable Railway/Neon environment before relying on it for a real incident.

1. Provision a fresh Neon/Postgres database.
2. Apply the current schema and migrations, including `migrations/0002_analysis_metadata.sql`.
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

- Backup v1 is manual. It only protects changes made before the last time you ran it.
- Backup v1 does not enumerate Railway volume orphan files that are not referenced by the database.
- Backup v1 does not upload archives to cloud storage. Copy archives to a backed-up destination after creation.
