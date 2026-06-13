import "dotenv/config";

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { getPgPoolFromUrl } from "./_db";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  PROJECT_NAME,
  archivePathToFilesystemPath,
  copyFileEnsuringDir,
  ensureEmptyDirectory,
  extractTarGz,
  getImageObjectPaths,
  objectPathToStorageRelativePath,
  readJsonFile,
  requireEnv,
  sameDatabaseTarget,
  sha256Buffer,
  type BackupInventoryItem,
  type BackupManifest,
  type InventoryBackupPayload,
} from "./backup-utils";

async function main() {
  const archiveArg = process.argv[2];
  if (!archiveArg) {
    throw new Error("Usage: pnpm restore:verify <archive.tar.gz>");
  }

  const databaseUrlTest = requireEnv("DATABASE_URL_TEST");
  const prodDatabaseUrl = process.env.DATABASE_URL;
  if (prodDatabaseUrl && sameDatabaseTarget(prodDatabaseUrl, databaseUrlTest)) {
    throw new Error("Refusing to run restore verification against the production DATABASE_URL");
  }

  const restoreUploadsDir = path.resolve(process.cwd(), requireEnv("RESTORE_UPLOADS_DIR"));
  await ensureEmptyDirectory(restoreUploadsDir);

  const archivePath = path.resolve(process.cwd(), archiveArg);
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), "myinventory-restore-verify-"));

  try {
    await extractTarGz(archivePath, extractDir);

    const manifest = await readJsonFile<BackupManifest>(
      path.join(extractDir, "manifest.json")
    );
    const inventoryPayload = await readJsonFile<InventoryBackupPayload>(
      path.join(extractDir, "inventory.json")
    );

    validateManifest(manifest);
    validateInventoryPayload(inventoryPayload);
    assertCounts(manifest, inventoryPayload.items);

    const restoredImageHashes = await restoreImages({
      extractDir,
      restoreUploadsDir,
      manifest,
    });

    assertImageHashes(manifest, restoredImageHashes);
    assertAnalysisMetadataHashes(inventoryPayload.items, restoredImageHashes);

    await verifyDatabaseRestore(databaseUrlTest, inventoryPayload.items, manifest.itemCount);

    console.log("PASS: backup archive restored and verified successfully.");
    console.log(
      `Verified ${manifest.itemCount} item(s) and ${manifest.downloadedImageCount} image file(s).`
    );
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
  }
}

function validateManifest(manifest: BackupManifest): void {
  if (manifest.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version: ${manifest.backupFormatVersion}`);
  }
  if (manifest.project !== PROJECT_NAME) {
    throw new Error(`Archive project mismatch: ${manifest.project}`);
  }
  if (manifest.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`Archive schema version mismatch: ${manifest.schemaVersion}`);
  }
  if (manifest.missingImageReferences.length > 0) {
    throw new Error("Archive manifest contains missing image references");
  }
}

function validateInventoryPayload(payload: InventoryBackupPayload): void {
  if (payload.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported inventory format version: ${payload.formatVersion}`);
  }
  if (payload.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`Inventory schema version mismatch: ${payload.schemaVersion}`);
  }
}

function assertCounts(manifest: BackupManifest, items: BackupInventoryItem[]): void {
  if (items.length !== manifest.itemCount) {
    throw new Error(
      `Item count mismatch: manifest=${manifest.itemCount}, inventory=${items.length}`
    );
  }

  const dbImageReferenceCount = items.reduce(
    (count, item) => count + getImageObjectPaths(item).length,
    0
  );
  if (dbImageReferenceCount !== manifest.dbImageReferenceCount) {
    throw new Error(
      `Image reference count mismatch: manifest=${manifest.dbImageReferenceCount}, inventory=${dbImageReferenceCount}`
    );
  }

  if (manifest.images.length !== manifest.downloadedImageCount) {
    throw new Error(
      `Manifest image list mismatch: downloadedImageCount=${manifest.downloadedImageCount}, images=${manifest.images.length}`
    );
  }
}

async function restoreImages({
  extractDir,
  restoreUploadsDir,
  manifest,
}: {
  extractDir: string;
  restoreUploadsDir: string;
  manifest: BackupManifest;
}): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  for (const image of manifest.images) {
    const source = archivePathToFilesystemPath(extractDir, image.archivePath);
    const destination = path.join(
      restoreUploadsDir,
      ...objectPathToStorageRelativePath(image.objectPath).split("/")
    );
    await copyFileEnsuringDir(source, destination);
    hashes.set(image.objectPath, sha256Buffer(await fs.readFile(destination)));
  }

  return hashes;
}

function assertImageHashes(
  manifest: BackupManifest,
  restoredImageHashes: Map<string, string>
): void {
  for (const image of manifest.images) {
    const restoredHash = restoredImageHashes.get(image.objectPath);
    if (restoredHash !== image.sha256) {
      throw new Error(
        `Image hash mismatch for ${image.objectPath}. If this only fails against /objects/* downloads, confirm whether production serves transformed images instead of canonical bytes.`
      );
    }
  }
}

function assertAnalysisMetadataHashes(
  items: BackupInventoryItem[],
  restoredImageHashes: Map<string, string>
): void {
  for (const item of items) {
    const expectedHash = item.analysisMetadata?.imageHash;
    if (!expectedHash) {
      continue;
    }

    const primaryImageHash = restoredImageHashes.get(item.imageUrl);
    if (primaryImageHash && primaryImageHash !== expectedHash) {
      throw new Error(
        `analysisMetadata.imageHash mismatch for item ${item.id}. This may indicate /objects/* is serving transformed bytes instead of canonical uploaded bytes.`
      );
    }
  }
}

async function verifyDatabaseRestore(
  databaseUrlTest: string,
  items: BackupInventoryItem[],
  expectedItemCount: number
): Promise<void> {
  const pool = getPgPoolFromUrl(databaseUrlTest);
  const client = await pool.connect();
  let inTransaction = false;

  try {
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
          $14
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
