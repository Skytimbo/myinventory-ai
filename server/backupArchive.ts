import { createHash } from "crypto";
import { createReadStream } from "fs";
import { Writable } from "stream";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  PROJECT_NAME,
  getImageObjectPaths,
  inventoryItemsToCsv,
  objectPathToArchivePath,
  type BackupImageManifestEntry,
  type BackupInventoryItem,
  type BackupManifest,
  type InventoryBackupPayload,
} from "../scripts/backup-utils";

const TAR_BLOCK_SIZE = 512;

export interface BackupImageReference {
  objectPath: string;
  itemIds: Set<string>;
}

export interface BackupImageFile {
  objectPath: string;
  filePath: string;
  itemIds: string[];
}

export interface BackupArchivePlan {
  archiveName: string;
  createdAt: string;
  inventory: InventoryBackupPayload;
  csv: string;
  manifest: BackupManifest;
  imageFiles: Array<BackupImageManifestEntry & { filePath: string }>;
}

export class BackupCompletenessError extends Error {
  constructor(readonly missingImageReferences: string[]) {
    super(
      `Backup completeness audit failed. Missing image reference(s): ${missingImageReferences.join(", ")}`
    );
    this.name = "BackupCompletenessError";
  }
}

export class BackupIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupIntegrityError";
  }
}

export function createBackupArchiveName(createdAt: string): string {
  return `myinventory-backup-${createdAt.replace(/[:.]/g, "-")}.tar.gz`;
}

export function collectImageReferences(
  items: BackupInventoryItem[]
): BackupImageReference[] {
  const references = new Map<string, Set<string>>();

  for (const item of items) {
    for (const objectPath of getImageObjectPaths(item)) {
      if (!references.has(objectPath)) {
        references.set(objectPath, new Set());
      }
      references.get(objectPath)?.add(item.id);
    }
  }

  return Array.from(references.entries()).map(([objectPath, itemIds]) => ({
    objectPath,
    itemIds,
  }));
}

export function countDbImageReferences(items: BackupInventoryItem[]): number {
  return items.reduce((count, item) => count + getImageObjectPaths(item).length, 0);
}

export async function createBackupArchivePlan({
  items,
  imageFiles,
  sourceAppUrl,
  createdAt = new Date().toISOString(),
}: {
  items: BackupInventoryItem[];
  imageFiles: BackupImageFile[];
  sourceAppUrl: string;
  createdAt?: string;
}): Promise<BackupArchivePlan> {
  const imageReferences = collectImageReferences(items);
  const imageFileByObjectPath = new Map(
    imageFiles.map((image) => [image.objectPath, image])
  );
  const missingImageReferences = imageReferences
    .filter((reference) => !imageFileByObjectPath.has(reference.objectPath))
    .map((reference) => reference.objectPath);

  if (missingImageReferences.length > 0) {
    throw new BackupCompletenessError(missingImageReferences);
  }

  const manifestImages = await Promise.all(
    imageReferences.map(async (reference) => {
      const image = imageFileByObjectPath.get(reference.objectPath);
      if (!image) {
        throw new BackupCompletenessError([reference.objectPath]);
      }

      const hash = await hashFile(image.filePath);
      return {
        objectPath: reference.objectPath,
        archivePath: objectPathToArchivePath(reference.objectPath),
        sha256: hash.sha256,
        bytes: hash.bytes,
        itemIds: Array.from(reference.itemIds).sort(),
        filePath: image.filePath,
      };
    })
  );

  const inventory: InventoryBackupPayload = {
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
    sourceAppUrl,
    itemCount: items.length,
    dbImageReferenceCount: countDbImageReferences(items),
    uniqueImageReferenceCount: imageReferences.length,
    downloadedImageCount: manifestImages.length,
    missingImageReferences: [],
    orphanFileAudit: {
      status: "not_checked",
      reason:
        "Backup includes every image referenced by database rows. It does not list the full uploads volume, so unreferenced volume files are outside this audit.",
    },
    images: manifestImages.map(({ filePath: _filePath, ...image }) => image),
  };

  return {
    archiveName: createBackupArchiveName(createdAt),
    createdAt,
    inventory,
    csv: `${inventoryItemsToCsv(items)}\n`,
    manifest,
    imageFiles: manifestImages,
  };
}

export async function writeBackupArchive(
  plan: BackupArchivePlan,
  output: Writable
): Promise<void> {
  const gzip = createGzip();
  // pipeline() tears down gzip if the output closes early (e.g. client disconnect),
  // so pending writes reject instead of waiting forever for a "drain" event.
  const outputFinished = pipeline(gzip, output);
  outputFinished.catch(() => undefined);

  try {
    await writeBufferEntry(
      gzip,
      "manifest.json",
      Buffer.from(`${JSON.stringify(plan.manifest, null, 2)}\n`, "utf8"),
      plan.createdAt
    );
    await writeBufferEntry(
      gzip,
      "inventory.json",
      Buffer.from(`${JSON.stringify(plan.inventory, null, 2)}\n`, "utf8"),
      plan.createdAt
    );
    await writeBufferEntry(
      gzip,
      "inventory.csv",
      Buffer.from(plan.csv, "utf8"),
      plan.createdAt
    );

    for (const image of plan.imageFiles) {
      await writeImageEntry(gzip, image, plan.createdAt);
    }

    await writeToStream(gzip, Buffer.alloc(TAR_BLOCK_SIZE * 2));
    gzip.end();
    await outputFinished;
  } catch (error) {
    gzip.destroy(error instanceof Error ? error : undefined);
    throw error;
  }
}

async function hashFile(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;

  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    bytes += buffer.length;
  }

  return {
    sha256: hash.digest("hex"),
    bytes,
  };
}

async function writeBufferEntry(
  output: Writable,
  name: string,
  value: Buffer,
  createdAt: string
): Promise<void> {
  await writeToStream(output, createTarHeader(name, value.length, createdAt));
  await writeToStream(output, value);
  await writePadding(output, value.length);
}

/**
 * Streams an image into the archive using the size and hash recorded in the
 * manifest. If the file changed after the plan was created, the archive would
 * no longer match its manifest, so the write fails instead.
 */
async function writeImageEntry(
  output: Writable,
  image: BackupArchivePlan["imageFiles"][number],
  createdAt: string
): Promise<void> {
  await writeToStream(output, createTarHeader(image.archivePath, image.bytes, createdAt));

  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(image.filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > image.bytes) {
      throw new BackupIntegrityError(
        `Image changed while the backup was being written: ${image.objectPath}`
      );
    }
    hash.update(buffer);
    await writeToStream(output, buffer);
  }

  if (bytes !== image.bytes || hash.digest("hex") !== image.sha256) {
    throw new BackupIntegrityError(
      `Image changed while the backup was being written: ${image.objectPath}`
    );
  }

  await writePadding(output, image.bytes);
}

async function writePadding(output: Writable, size: number): Promise<void> {
  const remainder = size % TAR_BLOCK_SIZE;
  if (remainder === 0) {
    return;
  }
  await writeToStream(output, Buffer.alloc(TAR_BLOCK_SIZE - remainder));
}

async function writeToStream(output: Writable, chunk: Buffer): Promise<void> {
  if (output.destroyed) {
    throw new Error("Backup stream closed before the archive was complete");
  }
  if (!output.write(chunk)) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        output.off("drain", onDrain);
        output.off("error", onError);
        output.off("close", onClose);
      };
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Backup stream closed before the archive was complete"));
      };
      output.once("drain", onDrain);
      output.once("error", onError);
      output.once("close", onClose);
    });
  }
}

function createTarHeader(name: string, size: number, createdAt: string): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  const splitPath = splitTarPath(name);
  const mode = 0o644;
  const mtime = Math.floor(new Date(createdAt).getTime() / 1000);

  writeString(header, splitPath.name, 0, 100);
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, mtime, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, splitPath.prefix, 345, 155);

  let checksum = 0;
  for (let index = 0; index < header.length; index += 1) {
    checksum += header[index];
  }

  const checksumValue = checksum.toString(8).padStart(6, "0");
  header.write(checksumValue, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

function splitTarPath(filePath: string): { name: string; prefix: string } {
  if (Buffer.byteLength(filePath) <= 100) {
    return { name: filePath, prefix: "" };
  }

  const parts = filePath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join("/");
    const name = parts.slice(index).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }

  throw new Error(`Archive path is too long for tar header: ${filePath}`);
}

function writeString(
  buffer: Buffer,
  value: string,
  offset: number,
  length: number
): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) {
    throw new Error(`Value is too long for tar header: ${value}`);
  }
  bytes.copy(buffer, offset);
}

function writeOctal(
  buffer: Buffer,
  value: number,
  offset: number,
  length: number
): void {
  const valueString = value.toString(8).padStart(length - 1, "0");
  if (valueString.length >= length) {
    throw new Error(`Value is too large for tar header: ${value}`);
  }
  buffer.write(valueString, offset, length - 1, "ascii");
}
