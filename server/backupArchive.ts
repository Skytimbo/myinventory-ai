import { createHash } from "crypto";
import { createReadStream } from "fs";
import { Writable } from "stream";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  PROJECT_NAME,
  emptyEvidence,
  getImageObjectPaths,
  inventoryItemsToCsv,
  objectPathToArchivePath,
  type BackupEvidence,
  type BackupImageManifestEntry,
  type BackupInventoryItem,
  type BackupManifest,
  type InventoryBackupPayload,
} from "../scripts/backup-utils";
import type { InventoryItem } from "../shared/schema";
import type { EvidenceSnapshot } from "./storage";

const TAR_BLOCK_SIZE = 512;

export interface BackupImageReference {
  objectPath: string;
  itemIds: Set<string>;
  photoId?: string;
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

/** Every inventory_items column must appear here, or backups silently lose data */
export function toBackupInventoryItem(item: InventoryItem): BackupInventoryItem {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    tags: Array.isArray(item.tags) ? item.tags : [],
    imageUrl: item.imageUrl,
    imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls : null,
    barcodeData: item.barcodeData,
    estimatedValue: item.estimatedValue ?? null,
    valueConfidence: item.valueConfidence ?? null,
    valueRationale: item.valueRationale ?? null,
    location: item.location ?? null,
    analysisMetadata: item.analysisMetadata ?? null,
    identification: item.identification ?? null,
    valuation: item.valuation ?? null,
    notes: item.notes ?? null,
    userAssertions: item.userAssertions ?? null,
    createdAt: item.createdAt,
  };
}

/** Every evidence column must appear here, or backups silently lose data */
export function toBackupEvidence(snapshot: EvidenceSnapshot): BackupEvidence {
  return {
    captureSessions: snapshot.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      notes: session.notes ?? null,
      createdAt: session.createdAt,
    })),
    captureBatches: snapshot.batches.map((batch) => ({
      id: batch.id,
      sessionId: batch.sessionId,
      context: batch.context ?? {},
      createdAt: batch.createdAt,
    })),
    photos: snapshot.photos.map((photo) => ({
      id: photo.id,
      batchId: photo.batchId ?? null,
      objectPath: photo.objectPath,
      sha256: photo.sha256,
      bytes: photo.bytes,
      mimeType: photo.mimeType,
      originalFilename: photo.originalFilename ?? null,
      source: photo.source,
      createdAt: photo.createdAt,
    })),
    itemPhotos: snapshot.itemPhotos.map((link) => ({
      itemId: link.itemId,
      photoId: link.photoId,
      position: link.position,
      createdAt: link.createdAt,
    })),
  };
}

/**
 * Every file the archive must contain: images referenced by items, plus every
 * registered photo, including photos not linked to any item.
 */
export function collectImageReferences(
  items: BackupInventoryItem[],
  evidence: BackupEvidence = emptyEvidence()
): BackupImageReference[] {
  const references = new Map<string, BackupImageReference>();
  const reference = (objectPath: string) => {
    let entry = references.get(objectPath);
    if (!entry) {
      entry = { objectPath, itemIds: new Set() };
      references.set(objectPath, entry);
    }
    return entry;
  };

  for (const item of items) {
    for (const objectPath of getImageObjectPaths(item)) {
      reference(objectPath).itemIds.add(item.id);
    }
  }

  const photoPaths = new Map<string, string>();
  for (const photo of evidence.photos) {
    reference(photo.objectPath).photoId = photo.id;
    photoPaths.set(photo.id, photo.objectPath);
  }
  for (const link of evidence.itemPhotos) {
    const objectPath = photoPaths.get(link.photoId);
    if (objectPath) reference(objectPath).itemIds.add(link.itemId);
  }

  return Array.from(references.values());
}

export function countDbImageReferences(items: BackupInventoryItem[]): number {
  return items.reduce((count, item) => count + getImageObjectPaths(item).length, 0);
}

export async function createBackupArchivePlan({
  items,
  evidence = emptyEvidence(),
  imageFiles,
  sourceAppUrl,
  createdAt = new Date().toISOString(),
}: {
  items: BackupInventoryItem[];
  evidence?: BackupEvidence;
  imageFiles: BackupImageFile[];
  sourceAppUrl: string;
  createdAt?: string;
}): Promise<BackupArchivePlan> {
  const imageReferences = collectImageReferences(items, evidence);
  const photosById = new Map(evidence.photos.map((photo) => [photo.id, photo]));
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
      const photo = reference.photoId ? photosById.get(reference.photoId) : undefined;
      // Photos are evidence: their bytes must still be what was recorded at capture
      if (photo && (photo.sha256 !== hash.sha256 || photo.bytes !== hash.bytes)) {
        throw new BackupIntegrityError(
          `Photo file no longer matches its recorded hash: ${reference.objectPath}`
        );
      }
      return {
        objectPath: reference.objectPath,
        archivePath: objectPathToArchivePath(reference.objectPath),
        sha256: hash.sha256,
        bytes: hash.bytes,
        itemIds: Array.from(reference.itemIds).sort(),
        ...(reference.photoId ? { photoId: reference.photoId } : {}),
        filePath: image.filePath,
      };
    })
  );

  const inventory: InventoryBackupPayload = {
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: createdAt,
    items,
    evidence,
  };
  const linkedPhotoIds = new Set(evidence.itemPhotos.map((link) => link.photoId));

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
    photoCount: evidence.photos.length,
    unassignedPhotoCount: evidence.photos.filter((photo) => !linkedPhotoIds.has(photo.id)).length,
    missingImageReferences: [],
    orphanFileAudit: {
      status: "not_checked",
      reason:
        "Backup includes every image referenced by item rows and every registered photo, including photos not linked to an item. It does not list the full uploads volume, so files no database row refers to are outside this audit.",
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
