import "dotenv/config";

import path from "path";
import { assertConnectedToLocalServer, assertLocalDatabaseUrl } from "../server/databaseTarget";
import { Pool } from "pg";
import {
  ensureEmptyDirectory,
  requireEnv,
  sameDatabaseTarget,
  type BackupEvidence,
  type BackupInventoryItem,
} from "./backup-utils";
import { verifyBackupArchive } from "./restore-verify-archive";
import { assertRestoredCounts, assertSchemaReady, insertArchiveRows, RESTORE_TABLES } from "./restore-db";

async function main() {
  const archiveArg = process.argv[2];
  if (!archiveArg) {
    throw new Error("Usage: pnpm restore:verify <archive.tar.gz>");
  }

  const databaseUrlTest = requireEnv("DATABASE_URL_TEST");
  // The verification target is truncated (inside a rolled-back transaction): local only
  assertLocalDatabaseUrl(databaseUrlTest, "use DATABASE_URL_TEST for restore verification");
  const prodDatabaseUrl = process.env.DATABASE_URL;
  if (prodDatabaseUrl && sameDatabaseTarget(prodDatabaseUrl, databaseUrlTest)) {
    throw new Error("Refusing to run restore verification against the production DATABASE_URL");
  }

  const restoreUploadsDir = path.resolve(process.cwd(), requireEnv("RESTORE_UPLOADS_DIR"));
  await ensureEmptyDirectory(restoreUploadsDir);

  const { manifest, items, evidence } = await verifyBackupArchive({
    archivePath: path.resolve(process.cwd(), archiveArg),
    restoreUploadsDir,
  });

  await verifyDatabaseRestore(databaseUrlTest, items, evidence);

  console.log("PASS: backup archive restored and verified successfully.");
  console.log(
    `Verified ${manifest.itemCount} item(s), ${evidence.photos.length} photo record(s) ` +
      `(${manifest.unassignedPhotoCount ?? 0} not linked to an item), ` +
      `${evidence.captureSessions.length} capture session(s), and ${manifest.downloadedImageCount} image file(s).`
  );
}

async function verifyDatabaseRestore(
  databaseUrlTest: string,
  items: BackupInventoryItem[],
  evidence: BackupEvidence
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrlTest });
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await assertConnectedToLocalServer(client, "run restore verification");
    await assertSchemaReady(client, "DATABASE_URL_TEST");
    await client.query("BEGIN");
    inTransaction = true;
    await client.query(`TRUNCATE TABLE ${RESTORE_TABLES.join(", ")}`);
    await insertArchiveRows(client, items, evidence);
    await assertRestoredCounts(client, items, evidence);
  } finally {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
