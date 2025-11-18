import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// Check if running on Replit or locally
const isReplit = process.env.REPL_ID !== undefined;

export const objectStorageClient = isReplit ? new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
}) : null as any;

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/**
 * ObjectStorageService
 *
 * Environment-agnostic storage abstraction supporting dual backends:
 * - Local filesystem (development)
 * - Google Cloud Storage via Replit sidecar (production)
 *
 * FOUNDATION: This service is designed for multi-file scenarios. Methods accept
 * arbitrary file paths, enabling future multi-image uploads (PRD 0004+).
 * See FOUNDATION.md Principle 2 for extension patterns.
 */
export class ObjectStorageService {
  constructor() {}

  // Get local storage directory for development
  getLocalStorageDir(): string {
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
    const parts = objectPath.split("/").filter(p => p);
    for (const part of parts) {
      if (part === "." || part === "..") {
        return false;
      }
    }

    return true;
  }

  getPublicObjectSearchPaths(): Array<string> {
    if (!isReplit) {
      // For local development, use local uploads directory
      return [this.getLocalStorageDir()];
    }

    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    if (!isReplit) {
      // For local development, return local uploads directory
      return this.getLocalStorageDir();
    }

    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadLocalObject(filePath: string, res: Response, cacheTtlSec: number = 3600) {
    try {
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
        ext === '.png' ? 'image/png' :
        ext === '.gif' ? 'image/gif' :
        ext === '.webp' ? 'image/webp' :
        'application/octet-stream';

      res.set({
        "Content-Type": contentType,
        "Content-Length": stats.size.toString(),
        "Cache-Control": `public, max-age=${cacheTtlSec}`,
      });

      const readStream = (await import('fs')).createReadStream(filePath);

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

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      const [metadata] = await file.getMetadata();
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";

      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });

      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getLocalObjectFile(objectPath: string): Promise<string> {
    // Validate path to prevent traversal attacks
    if (!this.validateObjectPath(objectPath)) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

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
   * Save file to local filesystem storage
   *
   * NOTE: This method supports arbitrary file paths, enabling future multi-image
   * scenarios. Path structure: uploads/{relativePath} where relativePath can be
   * items/{uuid}.jpg or items/{uuid}/0.jpg for multi-image support.
   *
   * @param relativePath - Path relative to uploads directory (e.g., "items/uuid.jpg")
   * @param buffer - File content as Buffer
   */
  async saveLocalFile(relativePath: string, buffer: Buffer): Promise<void> {
    const fullPath = path.join(this.getLocalStorageDir(), relativePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write file
    await fs.writeFile(fullPath, buffer);
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
  
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
  
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
  
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
  
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}
