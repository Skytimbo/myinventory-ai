import { spawn } from "child_process";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = "0002_analysis_metadata";
export const PROJECT_NAME = "myinventory-ai";

export interface BackupAnalysisMetadata {
  model?: string;
  timestamp?: string;
  version?: string;
  imageHash?: string;
  latencyMs?: number;
  note?: string | null;
}

export interface BackupInventoryItem {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  imageUrl: string;
  imageUrls: string[] | null;
  barcodeData: string;
  estimatedValue: string | null;
  valueConfidence: string | null;
  valueRationale: string | null;
  location: string | null;
  analysisMetadata: BackupAnalysisMetadata | null;
  createdAt: string;
}

export interface InventoryBackupPayload {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  items: BackupInventoryItem[];
}

export interface BackupImageManifestEntry {
  objectPath: string;
  archivePath: string;
  sha256: string;
  bytes: number;
  itemIds: string[];
}

export interface BackupManifest {
  backupFormatVersion: typeof BACKUP_FORMAT_VERSION;
  project: typeof PROJECT_NAME;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  createdAt: string;
  sourceAppUrl: string;
  itemCount: number;
  dbImageReferenceCount: number;
  uniqueImageReferenceCount: number;
  downloadedImageCount: number;
  missingImageReferences: string[];
  orphanFileAudit: {
    status: "not_checked";
    reason: string;
  };
  images: BackupImageManifestEntry[];
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function normalizeAppUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function getImageObjectPaths(item: BackupInventoryItem): string[] {
  const paths = item.imageUrls?.length ? item.imageUrls : [item.imageUrl];
  return [...new Set(paths.filter(Boolean))];
}

export function objectPathToArchivePath(objectPath: string): string {
  return path.posix.join("images", objectPathToStorageRelativePath(objectPath));
}

export function objectPathToStorageRelativePath(objectPath: string): string {
  if (!objectPath.startsWith("/objects/")) {
    throw new Error(`Invalid object path: ${objectPath}`);
  }
  if (objectPath.includes("..") || objectPath.includes("\0")) {
    throw new Error(`Unsafe object path: ${objectPath}`);
  }

  const relativePath = objectPath.slice("/objects/".length);
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("//")) {
    throw new Error(`Invalid object path: ${objectPath}`);
  }

  return relativePath;
}

export function archivePathToFilesystemPath(rootDir: string, archivePath: string): string {
  const normalized = path.posix.normalize(archivePath);
  if (normalized.startsWith("../") || normalized === ".." || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe archive path: ${archivePath}`);
  }
  return path.join(rootDir, ...normalized.split("/"));
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export function inventoryItemsToCsv(items: BackupInventoryItem[]): string {
  const headers = [
    "Name",
    "Description",
    "Category",
    "Tags",
    "Estimated Value",
    "Barcode",
    "Created At",
  ];
  const rows = items.map((item) => [
    item.name,
    item.description,
    item.category,
    item.tags.join("; "),
    item.estimatedValue || "",
    item.barcodeData,
    item.createdAt,
  ]);

  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ].join("\n");
}

export async function createTarGz(sourceDir: string, archivePath: string): Promise<void> {
  await runTar(["-czf", archivePath, "-C", sourceDir, "."]);
}

export async function extractTarGz(archivePath: string, destinationDir: string): Promise<void> {
  await runTar(["-xzf", archivePath, "-C", destinationDir]);
}

export async function ensureEmptyDirectory(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    if (entries.length > 0) {
      throw new Error(`${dir} must be empty for restore verification`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function copyFileEnsuringDir(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

export function sameDatabaseTarget(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.protocol === rightUrl.protocol &&
      leftUrl.hostname === rightUrl.hostname &&
      normalizePort(leftUrl) === normalizePort(rightUrl) &&
      leftUrl.username === rightUrl.username &&
      leftUrl.pathname === rightUrl.pathname
    );
  } catch {
    return left === right;
  }
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function normalizePort(url: URL): string {
  if (url.port) {
    return url.port;
  }
  return url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "";
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `tar exited with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`
        )
      );
    });
  });
}
