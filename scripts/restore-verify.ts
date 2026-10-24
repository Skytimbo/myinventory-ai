import "dotenv/config";

import path from "path";
import { assertConnectedToLocalServer, assertLocalDatabaseUrl } from "../server/databaseTarget";
import { Pool } from "pg";
import {
  ensureEmptyDirectory,
  requireEnv,
  sameDatabaseTarget,
  type BackupInventoryItem,
} from "./backup-utils";
import { verifyBackupArchive } from "./restore-verify-archive";

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

  const { manifest, items } = await verifyBackupArchive({
    archivePath: path.resolve(process.cwd(), archiveArg),
    restoreUploadsDir,
  });

  await verifyDatabaseRestore(databaseUrlTest, items, manifest.itemCount);

  console.log("PASS: backup archive restored and verified successfully.");
  console.log(
    `Verified ${manifest.itemCount} item(s) and ${manifest.downloadedImageCount} image file(s).`
  );
}

async function verifyDatabaseRestore(
  databaseUrlTest: string,
  items: BackupInventoryItem[],
  expectedItemCount: number
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrlTest });
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await assertConnectedToLocalServer(client, "run restore verification");
    await assertSchemaReady(client);
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("TRUNCATE TABLE inventory_items");

    for (const item of items) {
      await client.query(
        `INSERT INTO inventory_items (
          id,
          name,
          description,
          category,
          tags,
          image_url,
          image_urls,
          barcode_data,
          estimated_value,
          value_confidence,
          value_rationale,
          location,
          analysis_metadata,
          identification,
          valuation,
          notes,
          user_assertions,
          created_at
        ) VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5::text[],
          $6,
          $7::text[],
          $8,
          $9,
          $10,
          $11,
          $12,
          $13::jsonb,
          $14::jsonb,
          $15::jsonb,
          $16,
          $17::jsonb,
          $18
        )`,
        [
          item.id,
          item.name,
          item.description,
          item.category,
          item.tags,
          item.imageUrl,
          item.imageUrls,
          item.barcodeData,
          item.estimatedValue,
          item.valueConfidence,
          item.valueRationale,
          item.location,
          item.analysisMetadata ? JSON.stringify(item.analysisMetadata) : null,
          item.identification ? JSON.stringify(item.identification) : null,
          item.valuation ? JSON.stringify(item.valuation) : null,
          item.notes,
          item.userAssertions ? JSON.stringify(item.userAssertions) : null,
          item.createdAt,
        ]
      );
    }

    const countResult = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM inventory_items"
    );
    const restoredCount = Number(countResult.rows[0]?.count ?? "0");
    if (restoredCount !== expectedItemCount) {
      throw new Error(
        `Restored item count mismatch: expected=${expectedItemCount}, actual=${restoredCount}`
      );
    }
  } finally {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    client.release();
    await pool.end();
  }
}

async function assertSchemaReady(client: {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}): Promise<void> {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'inventory_items'`
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  const requiredColumns = [
    "id",
    "name",
    "description",
    "category",
    "tags",
    "image_url",
    "image_urls",
    "barcode_data",
    "estimated_value",
    "value_confidence",
    "value_rationale",
    "location",
    "analysis_metadata",
    "identification",
    "valuation",
    "notes",
    "user_assertions",
    "created_at",
  ];
  const missingColumns = requiredColumns.filter((column) => !columns.has(column));

  if (missingColumns.length > 0) {
    throw new Error(
      `DATABASE_URL_TEST is missing expected inventory_items column(s): ${missingColumns.join(", ")}. Apply migrations before running restore verification.`
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
