/**
 * IObjectStorage Interface & Implementation (Architecture Refactoring)
 *
 * This module provides:
 * - IObjectStorage interface for pluggable object storage
 * - ObjectStorageService: Local filesystem implementation
 *
 * Storage-agnostic naming allows future implementations (S3, GCS, etc.)
 * without changing consuming code.
 */

import { Response } from "express";
import { promises as fs } from "fs";
import path from "path";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/**
 * Strategy interface for object storage
 * Implementations can use different backends (local filesystem, S3, GCS, etc.)
 */
export interface IObjectStorage {
  /** Save a buffer to the given path */
  save(path: string, buffer: Buffer): Promise<void>;

  /** Read a file as a buffer */
  read(objectPath: string): Promise<Buffer>;

  /** Stream a file to an HTTP response */
  download(objectPath: string, res: Response): Promise<void>;
}

/**
 * ObjectStorageService - Local Filesystem Implementation
 *
 * Local filesystem storage for uploaded images.
 * Supports both development (./uploads) and Railway (/app/uploads with persistent volume).
 *
 * FOUNDATION: This service is designed for multi-file scenarios. Methods accept
 * arbitrary file paths, enabling future multi-image uploads (PRD 0004+).
 */
export class ObjectStorageService implements IObjectStorage {
  constructor() {}

  /**
   * Get local storage directory
   * - Development: ./uploads (default)
   * - Railway: /app/uploads (set via LOCAL_STORAGE_DIR env var)
   */
  getLocalStorageDir(): string {
    const customDir = process.env.LOCAL_STORAGE_DIR;
    if (customDir) {
      return customDir;
    }
    return path.join(process.cwd(), "uploads");
  }

  /**
   * Validates object path to prevent path traversal attacks
   *
   * @param objectPath - Path to validate (e.g., "/objects/items/uuid.jpg")
   * @returns true if path is valid and safe
   *
   * Security checks:
   * - Must start with /objects/
   * - No parent directory references (..)
   * - No absolute paths or suspicious patterns
   * - Matches expected pattern: /objects/{category}/{filename}
   */
  validateObjectPath(objectPath: string): boolean {
    // Must start with /objects/
    if (!objectPath.startsWith("/objects/")) {
      return false;
    }

    // No parent directory references
    if (objectPath.includes("..")) {
      return false;
    }

    // No null bytes
    if (objectPath.includes("\0")) {
      return false;
    }

    // Must match expected pattern: /objects/{category}/{filename} or /objects/{category}/{id}/{index}.{ext}
    // Valid examples:
    //   Legacy single-image: /objects/items/uuid.jpg
    //   Multi-image (PRD 0004): /objects/items/uuid/0.jpg, /objects/items/uuid/1.jpg
    const pathRegex = /^\/objects\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_\-./]+$/;
    if (!pathRegex.test(objectPath)) {
      return false;
    }

    // Ensure no path components are suspicious
    const parts = objectPath.split("/").filter((p) => p);
    for (const part of parts) {
      if (part === "." || part === "..") {
        return false;
      }
    }

    return true;
  }

  /**
   * Save file to local filesystem storage
   *
   * NOTE: This method supports arbitrary file paths, enabling future multi-image
   * scenarios. Path structure: uploads/{relativePath} where relativePath can be
   * items/{uuid}.jpg or items/{uuid}/0.jpg for multi-image support.
   *
   * @param relativePath - Path relative to uploads directory (e.g., "items/uuid.jpg")
   * @param buffer - File content as Buffer
   */
  async save(relativePath: string, buffer: Buffer): Promise<void> {
    const fullPath = path.join(this.getLocalStorageDir(), relativePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write file
    await fs.writeFile(fullPath, buffer);
  }

  /**
   * Read file from local filesystem storage
   *
   * @param objectPath - Virtual object path (e.g., "/objects/items/uuid.jpg")
   * @returns File content as Buffer
   * @throws ObjectNotFoundError if file doesn't exist
   */
  async read(objectPath: string): Promise<Buffer> {
    const filePath = await this.resolveObjectPath(objectPath);
    return fs.readFile(filePath);
  }

  /**
   * Stream a file to an HTTP response
   *
   * @param objectPath - Virtual object path (e.g., "/objects/items/uuid.jpg")
   * @param res - Express Response object
   */
  async download(objectPath: string, res: Response): Promise<void> {
    const filePath = await this.resolveObjectPath(objectPath);
    await this.streamFile(filePath, res);
  }

  /**
   * Resolve virtual object path to local filesystem path
   * Internal helper used by read() and download()
   *
   * @param objectPath - Virtual object path (e.g., "/objects/items/uuid.jpg")
   * @returns Absolute filesystem path
   * @throws ObjectNotFoundError if path is invalid or file doesn't exist
   */
  private async resolveObjectPath(objectPath: string): Promise<string> {
    // Validate path to prevent traversal attacks
    if (!this.validateObjectPath(objectPath)) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    // Remove "objects" prefix, keep the rest (e.g., "items/uuid.jpg")
    const entityId = parts.slice(1).join("/");
    const localPath = path.join(this.getLocalStorageDir(), entityId);

    // Additional security: ensure resolved path is within uploads directory
    const uploadsDir = path.resolve(this.getLocalStorageDir());
    const resolvedPath = path.resolve(localPath);
    if (!resolvedPath.startsWith(uploadsDir)) {
      throw new ObjectNotFoundError();
    }

    try {
      await fs.access(resolvedPath);
      return resolvedPath;
    } catch {
      throw new ObjectNotFoundError();
    }
  }

  /**
   * Stream a file to the response with proper headers
   * Internal helper used by download()
   */
  private async streamFile(
    filePath: string,
    res: Response,
    cacheTtlSec: number = 3600
  ): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".png"
            ? "image/png"
            : ext === ".gif"
              ? "image/gif"
              : ext === ".webp"
                ? "image/webp"
                : "application/octet-stream";

      res.set({
        "Content-Type": contentType,
        "Content-Length": stats.size.toString(),
        "Cache-Control": `public, max-age=${cacheTtlSec}`,
      });

      const readStream = (await import("fs")).createReadStream(filePath);

      readStream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      readStream.pipe(res);
    } catch (error) {
      console.error("Error downloading local file:", error);
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found" });
      }
    }
  }

  // ============================================================
  // LEGACY METHODS - Deprecated, kept for backwards compatibility
  // These will be removed in a future version
  // ============================================================

  /** @deprecated Use save() instead */
  async saveLocalFile(relativePath: string, buffer: Buffer): Promise<void> {
    return this.save(relativePath, buffer);
  }

  /** @deprecated Use read() instead */
  async readFile(objectPath: string): Promise<Buffer> {
    return this.read(objectPath);
  }

  /** @deprecated Use resolveObjectPath() internally or download() for streaming */
  async getLocalObjectFile(objectPath: string): Promise<string> {
    return this.resolveObjectPath(objectPath);
  }

  /** @deprecated Use download() instead */
  async downloadLocalObject(
    filePath: string,
    res: Response,
    cacheTtlSec: number = 3600
  ): Promise<void> {
    return this.streamFile(filePath, res, cacheTtlSec);
  }

}
