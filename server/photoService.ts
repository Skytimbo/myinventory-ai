/**
 * PhotoService - capture evidence (Milestone 1)
 *
 * Photos are evidence with identities independent of inventory items:
 * - stored once, by photo id (photos/<id>.<ext>), with original bytes intact
 * - recorded with SHA-256, size, detected type, original filename, and source
 * - linked to zero, one, or many items; never deleted when an item is deleted
 *
 * Interpretation (identification, valuation) lives elsewhere and can change;
 * the photo record does not.
 */

import { createHash, randomUUID } from "crypto";
import type { BatchContext, Photo, PhotoSource } from "@shared/schema";
import { getMimeTypeFromBuffer } from "./fileValidation";
import type { IObjectStorage } from "./objectStorage";
import type { IStorage } from "./storage";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface IncomingPhoto {
  buffer: Buffer;
  originalFilename?: string | null;
}

/** A photo with where it came from and what it currently supports */
export interface PhotoView extends Photo {
  itemIds: string[];
  sessionId: string | null;
  sessionTitle: string | null;
  context: BatchContext | null;
}

export interface RegistrationResult {
  registered: number;
  linked: number;
  alreadyRegistered: number;
  /** Object paths referenced by items whose files could not be read */
  missing: string[];
}

export class InvalidPhotoError extends Error {
  constructor(filename: string | null | undefined) {
    super(`${filename || "A file"} is not a supported image (JPEG, PNG, or WebP).`);
    this.name = "InvalidPhotoError";
  }
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export class PhotoService {
  constructor(
    private storage: IStorage,
    private objectStorage: IObjectStorage
  ) {}

  /**
   * Store photos as evidence. Every file is validated before any is saved, so
   * an invalid file rejects the whole set instead of leaving a partial batch.
   */
  async ingest(
    files: IncomingPhoto[],
    options: { batchId: string | null; source: PhotoSource }
  ): Promise<Photo[]> {
    const checked = files.map((file) => {
      const mimeType = getMimeTypeFromBuffer(file.buffer);
      if (!mimeType || !EXTENSIONS[mimeType]) {
        throw new InvalidPhotoError(file.originalFilename);
      }
      return { ...file, mimeType };
    });

    const stored: Photo[] = [];
    for (const file of checked) {
      const id = randomUUID();
      const relativePath = `photos/${id}.${EXTENSIONS[file.mimeType]}`;
      await this.objectStorage.save(relativePath, file.buffer);
      stored.push(
        await this.storage.createPhoto({
          id,
          batchId: options.batchId,
          objectPath: `/objects/${relativePath}`,
          sha256: sha256(file.buffer),
          bytes: file.buffer.length,
          mimeType: file.mimeType,
          originalFilename: file.originalFilename?.slice(0, 255) || null,
          source: options.source,
          createdAt: new Date().toISOString(),
        })
      );
    }
    return stored;
  }

  /**
   * Register photos that items already reference (created before Milestone 1)
   * as evidence records, in place: files are read to hash them but never
   * moved or rewritten. Safe to run repeatedly.
   */
  async registerExistingItemPhotos(): Promise<RegistrationResult> {
    const result: RegistrationResult = { registered: 0, linked: 0, alreadyRegistered: 0, missing: [] };
    const now = new Date().toISOString();
    const before = await this.storage.getEvidenceSnapshot();
    const existingLinks = new Set(before.itemPhotos.map((link) => `${link.itemId}:${link.photoId}`));

    for (const item of await this.storage.getItems()) {
      const paths = item.imageUrls?.length ? item.imageUrls : [item.imageUrl];
      const photoIds: string[] = [];
      for (const objectPath of paths) {
        let photo = await this.storage.findPhotoByObjectPath(objectPath);
        if (photo) {
          result.alreadyRegistered += 1;
        } else {
          let buffer: Buffer;
          try {
            buffer = await this.objectStorage.read(objectPath);
          } catch {
            if (!result.missing.includes(objectPath)) result.missing.push(objectPath);
            continue;
          }
          photo = await this.storage.createPhoto({
            batchId: null,
            objectPath,
            sha256: sha256(buffer),
            bytes: buffer.length,
            mimeType: getMimeTypeFromBuffer(buffer) ?? "application/octet-stream",
            originalFilename: null,
            source: "legacy_registration",
            createdAt: now,
          });
          result.registered += 1;
        }
        photoIds.push(photo.id);
      }
      const newLinks = photoIds.filter((id) => !existingLinks.has(`${item.id}:${id}`));
      if (newLinks.length) {
        await this.storage.linkPhotos(item.id, newLinks, now);
        newLinks.forEach((id) => existingLinks.add(`${item.id}:${id}`));
        result.linked += newLinks.length;
      }
    }
    return result;
  }

  /** Photos with their source batch context and linked items */
  async listPhotos(filter: { unassigned?: boolean } = {}): Promise<PhotoView[]> {
    const snapshot = await this.storage.getEvidenceSnapshot();
    const batches = new Map(snapshot.batches.map((batch) => [batch.id, batch]));
    const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]));
    const views = snapshot.photos.map((photo) => {
      const batch = photo.batchId ? batches.get(photo.batchId) : undefined;
      const session = batch ? sessions.get(batch.sessionId) : undefined;
      return {
        ...photo,
        itemIds: snapshot.itemPhotos.filter((link) => link.photoId === photo.id).map((link) => link.itemId),
        sessionId: session?.id ?? null,
        sessionTitle: session?.title ?? null,
        context: batch?.context ?? null,
      };
    });
    return filter.unassigned ? views.filter((view) => view.itemIds.length === 0) : views;
  }
}
