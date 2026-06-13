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
  createTarGz,
  getImageObjectPaths,
  inventoryItemsToCsv,
  normalizeAppUrl,
  objectPathToArchivePath,
  requireEnv,
  sha256Buffer,
  writeJsonFile,
  type BackupImageManifestEntry,
  type BackupInventoryItem,
  type BackupManifest,
  type InventoryBackupPayload,
} from "./backup-utils";

interface ImageReference {
  objectPath: string;
  itemIds: Set<string>;
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const appUrl = normalizeAppUrl(requireEnv("APP_URL"));
  const inventoryPassword = requireEnv("INVENTORY_PASSWORD");
  const backupDir = path.resolve(process.cwd(), process.env.BACKUP_DIR || "backups");
  const createdAt = new Date().toISOString();
  const archiveName = `myinventory-backup-${createdAt.replace(/[:.]/g, "-")}.tar.gz`;
  const archivePath = path.join(backupDir, archiveName);
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "myinventory-backup-"));

  try {
    await fs.mkdir(backupDir, { recursive: true });

    console.log("Reading inventory records...");
    const items = await loadInventoryItems(databaseUrl);
    const imageReferences = collectImageReferences(items);
    console.log(
      `Found ${items.length} item(s) and ${imageReferences.length} unique image reference(s).`
    );

    const cookie = await login(appUrl, inventoryPassword);
    const imageManifest = await downloadImages({
      appUrl,
      cookie,
      imageReferences,
      stagingDir,
    });

    const missingImageReferences = imageReferences
      .filter((reference) => !imageManifest.some((image) => image.objectPath === reference.objectPath))
      .map((reference) => reference.objectPath);

    if (missingImageReferences.length > 0) {
      throw new Error(
        `Backup completeness audit failed. Missing image reference(s): ${missingImageReferences.join(", ")}`
      );
    }

    const inventoryPayload: InventoryBackupPayload = {
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: createdAt,
      items,
    };

    const manifest: BackupManifest = {
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      project: PROJECT_NAME,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt,
      sourceAppUrl: appUrl,
      itemCount: items.length,
      dbImageReferenceCount: countDbImageReferences(items),
      uniqueImageReferenceCount: imageReferences.length,
      downloadedImageCount: imageManifest.length,
      missingImageReferences,
      orphanFileAudit: {
        status: "not_checked",
        reason:
          "Backup v1 downloads images referenced by database rows over /objects/*. It does not list the Railway volume, so unreferenced volume files are outside this audit.",
      },
      images: imageManifest,
    };

    await writeJsonFile(path.join(stagingDir, "inventory.json"), inventoryPayload);
    await fs.writeFile(
      path.join(stagingDir, "inventory.csv"),
      `${inventoryItemsToCsv(items)}\n`,
      "utf8"
    );
    await writeJsonFile(path.join(stagingDir, "manifest.json"), manifest);

    await createTarGz(stagingDir, archivePath);
    console.log(`Backup complete: ${archivePath}`);
    console.log(
      `Archived ${manifest.itemCount} item(s) and ${manifest.downloadedImageCount} image file(s).`
    );
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

async function loadInventoryItems(databaseUrl: string): Promise<BackupInventoryItem[]> {
  const pool = getPgPoolFromUrl(databaseUrl);
  const client = await pool.connect();

  try {
    const result = await client.query<BackupInventoryItem>(`
      SELECT
        id::text AS "id",
        name,
        description,
        category,
        COALESCE(tags, ARRAY[]::text[]) AS "tags",
        image_url AS "imageUrl",
        image_urls AS "imageUrls",
        barcode_data AS "barcodeData",
        estimated_value::text AS "estimatedValue",
        value_confidence AS "valueConfidence",
        value_rationale AS "valueRationale",
        location,
        analysis_metadata AS "analysisMetadata",
        created_at AS "createdAt"
      FROM inventory_items
      ORDER BY created_at DESC, name ASC
    `);

    return result.rows.map((item) => ({
      ...item,
      tags: Array.isArray(item.tags) ? item.tags : [],
      imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls : null,
      estimatedValue: item.estimatedValue ?? null,
      valueConfidence: item.valueConfidence ?? null,
      valueRationale: item.valueRationale ?? null,
      location: item.location ?? null,
      analysisMetadata: item.analysisMetadata ?? null,
    }));
  } finally {
    client.release();
    await pool.end();
  }
}

function collectImageReferences(items: BackupInventoryItem[]): ImageReference[] {
  const references = new Map<string, Set<string>>();

  for (const item of items) {
    for (const objectPath of getImageObjectPaths(item)) {
      if (!references.has(objectPath)) {
        references.set(objectPath, new Set());
      }
      references.get(objectPath)?.add(item.id);
    }
  }

  return [...references.entries()].map(([objectPath, itemIds]) => ({
    objectPath,
    itemIds,
  }));
}

function countDbImageReferences(items: BackupInventoryItem[]): number {
  return items.reduce((count, item) => count + getImageObjectPaths(item).length, 0);
}

async function login(appUrl: string, password: string): Promise<string> {
  const loginUrl = new URL("/api/auth/login", appUrl);
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw new Error(`Login failed with HTTP ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Login succeeded but did not return a session cookie");
  }

  return setCookie.split(";")[0];
}

async function downloadImages({
  appUrl,
  cookie,
  imageReferences,
  stagingDir,
}: {
  appUrl: string;
  cookie: string;
  imageReferences: ImageReference[];
  stagingDir: string;
}): Promise<BackupImageManifestEntry[]> {
  const imageManifest: BackupImageManifestEntry[] = [];

  for (const reference of imageReferences) {
    const imageUrl = new URL(reference.objectPath, appUrl);
    const response = await fetch(imageUrl, {
      headers: { Cookie: cookie },
    });

    if (response.status === 404) {
      console.error(`Missing image: ${reference.objectPath}`);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Image download was not authorized for ${reference.objectPath}`);
    }
    if (!response.ok) {
      throw new Error(
        `Image download failed for ${reference.objectPath} with HTTP ${response.status}`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const archivePath = objectPathToArchivePath(reference.objectPath);
    const destination = archivePathToFilesystemPath(stagingDir, archivePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer);

    imageManifest.push({
      objectPath: reference.objectPath,
      archivePath,
      sha256: sha256Buffer(buffer),
      bytes: buffer.length,
      itemIds: [...reference.itemIds].sort(),
    });
  }

  return imageManifest;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
