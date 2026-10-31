/* scripts/restore-local.ts
 *
 *   pnpm restore:local <archive.tar.gz>
 *
 * Restores a backup archive into the local development database and photo
 * folder from .env.development, so the restored collection can be examined in
 * the app. Refuses unless the database is local and empty and no restored
 * photo would overwrite an existing file: it never deletes or replaces data.
 * Start from `pnpm dev:reset --empty`.
 */
import { existsSync, promises as fs, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import { copyFileEnsuringDir, objectPathToStorageRelativePath } from './backup-utils';
import { connectLocalDatabase, exitWithSafeError } from './_localDb';
import { registerPhotos } from './_registerPhotos';
import { assertRestoredCounts, assertSchemaReady, countRows, insertArchiveRows } from './restore-db';
import { verifyBackupArchive } from './restore-verify-archive';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_FILE = path.join(ROOT, '.env.development');

async function main() {
  const archiveArg = process.argv[2];
  if (!archiveArg) {
    throw new Error('Usage: pnpm restore:local <archive.tar.gz>');
  }
  if (!existsSync(ENV_FILE)) {
    throw new Error('.env.development not found. Run `pnpm dev:setup` first.');
  }
  // Only .env.development: never the shell's or .env's DATABASE_URL
  const env = dotenv.parse(readFileSync(ENV_FILE));
  const uploadsDir = path.resolve(ROOT, env.LOCAL_STORAGE_DIR || './uploads-dev');
  if (path.relative(ROOT, uploadsDir) === 'uploads') {
    throw new Error('LOCAL_STORAGE_DIR must not be ./uploads; use a separate development folder such as ./uploads-dev.');
  }

  const { pool, client, database } = await connectLocalDatabase(env.DATABASE_URL, 'restore a backup locally');
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'myinventory-restore-local-'));
  let restored: Awaited<ReturnType<typeof verifyBackupArchive>>;
  try {
    await assertSchemaReady(client, `"${database}"`);
    const existing = Object.entries(await countRows(client)).filter(([, count]) => count > 0);
    if (existing.length > 0) {
      throw new Error(
        `"${database}" is not empty (${existing.map(([table, count]) => `${table}: ${count}`).join(', ')}). ` +
          'Restore only loads into an empty database; run `pnpm dev:reset --empty` first.'
      );
    }

    // Checks manifest, relationships, and every hash before anything is written
    restored = await verifyBackupArchive({
      archivePath: path.resolve(process.cwd(), archiveArg),
      restoreUploadsDir: stagingDir,
    });
    const { manifest, items, evidence } = restored;

    const destinations = manifest.images.map((image) => {
      const relative = objectPathToStorageRelativePath(image.objectPath);
      return { from: path.join(stagingDir, ...relative.split('/')), to: path.join(uploadsDir, ...relative.split('/')) };
    });
    const clashes = destinations.filter(({ to }) => existsSync(to));
    if (clashes.length > 0) {
      throw new Error(
        `${clashes.length} photo file(s) already exist in ${path.relative(ROOT, uploadsDir)}/ and would be overwritten. ` +
          'Run `pnpm dev:reset --empty` first.'
      );
    }

    await client.query('BEGIN');
    try {
      await insertArchiveRows(client, items, evidence);
      await assertRestoredCounts(client, items, evidence);
      for (const { from, to } of destinations) {
        await copyFileEnsuringDir(from, to);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log(
      `✓ Restored ${items.length} item(s), ${evidence.photos.length} photo record(s) ` +
        `(${manifest.unassignedPhotoCount ?? 0} not linked to an item), ${evidence.captureSessions.length} capture session(s), ` +
        `and ${destinations.length} image file(s) into "${database}" and ${path.relative(ROOT, uploadsDir)}/`
    );
  } finally {
    client.release();
    await pool.end();
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  // Archives from before photo evidence (0002/0003): give their photos identities
  if (restored.evidence.photos.length === 0 && restored.items.length > 0) {
    await registerPhotos(env.DATABASE_URL, env.LOCAL_STORAGE_DIR || './uploads-dev');
  }
  console.log('\nNext: pnpm dev:local, then open http://localhost:' + (env.PORT || '5000'));
}

main().catch(exitWithSafeError);
