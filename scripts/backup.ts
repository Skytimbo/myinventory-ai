import "dotenv/config";

import { createWriteStream } from "fs";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { getPgPoolFromUrl } from "./_db";
import {
  archivePathToFilesystemPath,
  normalizeAppUrl,
  objectPathToArchivePath,
  requireEnv,
  type BackupInventoryItem,
} from "./backup-utils";
import {
  collectImageReferences,
  createBackupArchivePlan,
  writeBackupArchive,
  type BackupImageFile,
  type BackupImageReference,
} from "../server/backupArchive";

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const appUrl = normalizeAppUrl(requireEnv("APP_URL"));
  const inventoryPassword = requireEnv("INVENTORY_PASSWORD");
  const backupDir = path.resolve(process.cwd(), process.env.BACKUP_DIR || "backups");
  const createdAt = new Date().toISOString();
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
    const imageFiles = await downloadImages({
      appUrl,
      cookie,
      imageReferences,
      stagingDir,
    });

    const plan = await createBackupArchivePlan({
      items,
      imageFiles,
      sourceAppUrl: appUrl,
      createdAt,
    });
    const archivePath = path.join(backupDir, plan.archiveName);
    await writeBackupArchive(plan, createWriteStream(archivePath));
    console.log(`Backup complete: ${archivePath}`);
    console.log(
      `Archived ${plan.manifest.itemCount} item(s) and ${plan.manifest.downloadedImageCount} image file(s).`
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
        identification,
        valuation,
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
      identification: item.identification ?? null,
      valuation: item.valuation ?? null,
    }));
  } finally {
    client.release();
    await pool.end();
  }
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
  imageReferences: BackupImageReference[];
  stagingDir: string;
}): Promise<BackupImageFile[]> {
  const imageFiles: BackupImageFile[] = [];

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

    imageFiles.push({
      objectPath: reference.objectPath,
      filePath: destination,
      itemIds: Array.from(reference.itemIds).sort(),
    });
  }

  return imageFiles;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
