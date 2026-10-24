import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  BACKUP_FORMAT_VERSION,
  PROJECT_NAME,
  SUPPORTED_BACKUP_SCHEMA_VERSIONS,
  archivePathToFilesystemPath,
  copyFileEnsuringDir,
  extractTarGz,
  getImageObjectPaths,
  objectPathToStorageRelativePath,
  readJsonFile,
  sha256Buffer,
  type BackupInventoryItem,
  type BackupManifest,
  type InventoryBackupPayload,
} from "./backup-utils";

/**
 * Archive-level restore checks shared by `pnpm restore:verify` and tests.
 * Extracts the archive, validates manifest and inventory, restores images into
 * restoreUploadsDir, and checks every image hash. Does not touch a database.
 */
export async function verifyBackupArchive({
  archivePath,
  restoreUploadsDir,
}: {
  archivePath: string;
  restoreUploadsDir: string;
}): Promise<{ manifest: BackupManifest; items: BackupInventoryItem[] }> {
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
    // Older archives predate some columns; restore those as null
    const items = inventoryPayload.items.map((item) => ({
      ...item,
      identification: item.identification ?? null,
      valuation: item.valuation ?? null,
      notes: item.notes ?? null,
      userAssertions: item.userAssertions ?? null,
    }));
    assertCounts(manifest, items);

    const restoredImageHashes = await restoreImages({
      extractDir,
      restoreUploadsDir,
      manifest,
    });

    assertImageHashes(manifest, restoredImageHashes);
    assertAnalysisMetadataHashes(items, restoredImageHashes);

    return { manifest, items };
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
  if (!SUPPORTED_BACKUP_SCHEMA_VERSIONS.includes(manifest.schemaVersion)) {
    throw new Error(`Unsupported archive schema version: ${manifest.schemaVersion}`);
  }
  if (manifest.missingImageReferences.length > 0) {
    throw new Error("Archive manifest contains missing image references");
  }
}

function validateInventoryPayload(payload: InventoryBackupPayload): void {
  if (payload.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported inventory format version: ${payload.formatVersion}`);
  }
  if (!SUPPORTED_BACKUP_SCHEMA_VERSIONS.includes(payload.schemaVersion)) {
    throw new Error(`Unsupported inventory schema version: ${payload.schemaVersion}`);
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
