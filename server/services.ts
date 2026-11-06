/**
 * Service Container & Dependency Injection (Architecture Refactoring)
 *
 * This module implements the AppServices container pattern for backend services.
 * It provides:
 * - Type-safe configuration via AppConfig
 * - Production service factory (createProdServices)
 * - Test service factory (createTestServices)
 * - Dependency injection for all route handlers
 *
 * All services are constructor-injected to enable testing.
 */

import path from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import type { Response } from "express";
import type { EvidenceSnapshot, IStorage } from "./storage";
import type { IObjectStorage } from "./objectStorage";
import type {
  IAnalyzer,
  IdentificationResult,
  ValuationInput,
  ValuationResult,
} from "./analyzer";
import type { IItemService } from "./itemService";
import { PhotoService } from "./photoService";
import { openaiCheap, openaiPremium } from "./openai";
import type {
  BatchContext,
  CaptureBatch,
  CaptureSession,
  InsertPhoto,
  InventoryItem,
  InsertInventoryItem,
  ItemPhoto,
  Photo,
} from "@shared/schema";

/**
 * Application configuration loaded from environment variables
 */
export interface AppConfig {
  /** PostgreSQL connection string (required) */
  databaseUrl: string;

  /** OpenAI API key for image analysis (required) */
  openaiApiKey: string;

  /** OpenAI API base URL (optional, defaults to OpenAI API) */
  openaiBaseUrl: string;

  /** OpenAI Project ID (required for project-scoped keys starting with sk-proj-*) */
  openaiProjectId: string | undefined;

  /** Node environment mode */
  nodeEnv: "development" | "production" | "test";

  /** Server port */
  port: number;

  /** Local storage directory for uploaded files */
  localStorageDir: string;

  /** Analyzer provider: 'openai' | 'mock' */
  analyzerProvider: "openai" | "mock";
}

/**
 * Load and validate application configuration from environment variables
 *
 * @throws {Error} If required environment variables are missing
 * @returns {AppConfig} Validated configuration object
 */
export function loadAppConfig(): AppConfig {
  // Required variables
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is required. " +
        "Please set it to your PostgreSQL connection string."
    );
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const openaiBaseUrl =
    process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const openaiProjectId = process.env.OPENAI_PROJECT_ID;

  // Server configuration
  const nodeEnv = (process.env.NODE_ENV || "development") as
    | "development"
    | "production"
    | "test";
  const port = parseInt(process.env.PORT || "5000", 10);

  // Local storage directory (development: ./uploads, Railway: /app/uploads)
  const localStorageDir =
    process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), "uploads");

  // Analyzer selection (default: openai)
  const analyzerProviderRaw = process.env.ANALYZER_PROVIDER || "openai";
  if (!["openai", "mock"].includes(analyzerProviderRaw)) {
    throw new Error(
      `Invalid ANALYZER_PROVIDER: ${analyzerProviderRaw}. Use 'openai' or 'mock'.`
    );
  }
  const analyzerProvider = analyzerProviderRaw as "openai" | "mock";

  return {
    databaseUrl,
    openaiApiKey,
    openaiBaseUrl,
    openaiProjectId,
    nodeEnv,
    port,
    localStorageDir,
    analyzerProvider,
  };
}

/**
 * Container for all backend services with dependency injection
 *
 * This interface defines all services used by route handlers.
 * Production code uses createProdServices() to instantiate real implementations.
 * Tests use createTestServices() to inject fakes for deterministic testing.
 */
export interface AppServices {
  /** Database access layer for inventory items */
  storage: IStorage;

  /** Object storage service (local filesystem or cloud) */
  objectStorage: IObjectStorage;

  /** AI image analyzer */
  analyzer: IAnalyzer;

  /** Item business logic service */
  itemService: IItemService;

  /** Capture evidence: photo ingestion, registration, and listing */
  photoService: PhotoService;

  /** OpenAI client for cheap/fast models (gpt-4o-mini) */
  openaiCheap: import("openai").default;

  /** OpenAI client for premium models (gpt-4o) */
  openaiPremium: import("openai").default;
}

/**
 * Factory function to create the appropriate analyzer based on config
 *
 * @param config - Application configuration with analyzerProvider
 * @param openaiCheap - OpenAI client for cheap models
 * @param openaiPremium - OpenAI client for premium models
 * @returns IAnalyzer implementation based on config.analyzerProvider
 */
async function createAnalyzer(
  config: AppConfig,
  openaiCheap: import("openai").default,
  openaiPremium: import("openai").default
): Promise<IAnalyzer> {
  const { OpenAIAnalyzer, MockAnalyzer } = await import("./analyzer");

  switch (config.analyzerProvider) {
    case "mock":
      console.log("Using MockAnalyzer (ANALYZER_PROVIDER=mock)");
      return new MockAnalyzer();
    case "openai":
    default:
      return new OpenAIAnalyzer(openaiCheap, openaiPremium);
  }
}

/**
 * Create production services with real implementations
 *
 * This factory instantiates all backend services for production use.
 * Services will use real database connections, file storage, and AI APIs.
 *
 * @param config - Validated application configuration
 * @returns {AppServices} Container with production service instances
 */
export async function createProdServices(
  config: AppConfig
): Promise<AppServices> {
  // Dynamically import services to avoid circular dependencies
  const { DatabaseStorage } = await import("./storage");
  const { ObjectStorageService } = await import("./objectStorage");
  const { ItemService } = await import("./itemService");

  // Instantiate services in dependency order
  const storage = await DatabaseStorage.create();
  const objectStorage = new ObjectStorageService();
  const analyzer = await createAnalyzer(config, openaiCheap, openaiPremium);
  const itemService = new ItemService(storage, objectStorage, analyzer);
  const photoService = new PhotoService(storage, objectStorage);

  return {
    storage,
    objectStorage,
    analyzer,
    itemService,
    photoService,
    openaiCheap,
    openaiPremium,
  };
}

// ============================================================
// Test Fakes
// ============================================================

/**
 * Fake in-memory storage implementation for testing
 *
 * This class implements IStorage using an in-memory Map for deterministic testing.
 * All data is lost when the process exits. Useful for unit tests and E2E tests.
 */
export class FakeDatabaseStorage implements IStorage {
  private items: Map<string, InventoryItem> = new Map();
  private sessions: Map<string, CaptureSession> = new Map();
  private batches: Map<string, CaptureBatch> = new Map();
  private photoRecords: Map<string, Photo> = new Map();
  private links: ItemPhoto[] = [];

  async createCaptureSession(input: { title: string; notes?: string | null; createdAt: string }): Promise<CaptureSession> {
    const session = { id: randomUUID(), title: input.title, notes: input.notes ?? null, createdAt: input.createdAt };
    this.sessions.set(session.id, session);
    return session;
  }

  async getCaptureSession(id: string): Promise<CaptureSession | undefined> {
    return this.sessions.get(id);
  }

  async createCaptureBatch(input: { sessionId: string; context: BatchContext; createdAt: string }): Promise<CaptureBatch> {
    if (!this.sessions.has(input.sessionId)) {
      throw new Error("capture_batches.session_id foreign key violation");
    }
    const batch = { id: randomUUID(), ...input };
    this.batches.set(batch.id, batch);
    return batch;
  }

  async createPhoto(photo: InsertPhoto): Promise<Photo> {
    if (Array.from(this.photoRecords.values()).some((p) => p.objectPath === photo.objectPath)) {
      throw new Error("photos.object_path unique violation");
    }
    const created: Photo = {
      id: photo.id ?? randomUUID(),
      batchId: photo.batchId ?? null,
      objectPath: photo.objectPath,
      sha256: photo.sha256,
      bytes: photo.bytes,
      mimeType: photo.mimeType,
      originalFilename: photo.originalFilename ?? null,
      source: photo.source,
      createdAt: photo.createdAt ?? new Date().toISOString(),
    };
    this.photoRecords.set(created.id, created);
    return created;
  }

  async getPhotos(ids: string[]): Promise<Photo[]> {
    return ids.map((id) => this.photoRecords.get(id)).filter((p): p is Photo => Boolean(p));
  }

  async findPhotoByObjectPath(objectPath: string): Promise<Photo | undefined> {
    return Array.from(this.photoRecords.values()).find((p) => p.objectPath === objectPath);
  }

  async linkPhotos(itemId: string, photoIds: string[], createdAt: string): Promise<void> {
    if (!this.items.has(itemId)) throw new Error("item_photos.item_id foreign key violation");
    const existing = this.links.filter((link) => link.itemId === itemId);
    let position = existing.length ? Math.max(...existing.map((link) => link.position)) + 1 : 0;
    for (const photoId of photoIds) {
      if (!this.photoRecords.has(photoId)) throw new Error("item_photos.photo_id foreign key violation");
      if (existing.some((link) => link.photoId === photoId)) continue;
      this.links.push({ itemId, photoId, position, createdAt });
      position += 1;
    }
  }

  async getEvidenceSnapshot(): Promise<EvidenceSnapshot> {
    return {
      sessions: Array.from(this.sessions.values()),
      batches: Array.from(this.batches.values()),
      photos: Array.from(this.photoRecords.values()),
      itemPhotos: [...this.links].sort((a, b) => a.itemId.localeCompare(b.itemId) || a.position - b.position),
    };
  }

  async getItems(): Promise<InventoryItem[]> {
    const allItems = Array.from(this.items.values());

    // Sort by createdAt descending (newest first) to match production behavior
    allItems.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    // Lazy migration: populate imageUrls from imageUrl if null (PRD 0004 - backwards compatibility)
    return allItems.map((item) => {
      if (!item.imageUrls) {
        item.imageUrls = [item.imageUrl];
      }
      return item;
    });
  }

  async getItem(id: string): Promise<InventoryItem | undefined> {
    const item = this.items.get(id);

    if (!item) {
      return undefined;
    }

    // Lazy migration: populate imageUrls from imageUrl if null (PRD 0004 - backwards compatibility)
    if (!item.imageUrls) {
      item.imageUrls = [item.imageUrl];
    }

    return item;
  }

  async createItem(item: InsertInventoryItem): Promise<InventoryItem> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const newItem = {
      id,
      createdAt,
      analysisMetadata: null,
      identification: null,
      valuation: null,
      notes: null,
      userAssertions: null,
      ...item,
    } as InventoryItem;

    this.items.set(id, newItem);
    return newItem;
  }

  async deleteItem(id: string): Promise<boolean> {
    // Links cascade like the database; photos are kept as evidence
    this.links = this.links.filter((link) => link.itemId !== id);
    return this.items.delete(id);
  }

  async updateItem(
    id: string,
    updates: Partial<InsertInventoryItem>,
  ): Promise<InventoryItem | null> {
    const existing = this.items.get(id);
    if (!existing) {
      return null;
    }

    const updated = {
      ...existing,
      ...updates,
    } as InventoryItem;

    this.items.set(id, updated);
    return updated;
  }

  /**
   * Test helper: Clear all items from storage
   * Useful for resetting state between tests
   */
  clear(): void {
    this.items.clear();
    this.sessions.clear();
    this.batches.clear();
    this.photoRecords.clear();
    this.links = [];
  }

  /**
   * Test helper: Seed storage with initial items
   * Useful for setting up test fixtures
   */
  seed(items: InventoryItem[]): void {
    for (const item of items) {
      this.items.set(item.id, item);
    }
  }
}

/**
 * Fake in-memory object storage implementation for testing
 *
 * Implements IObjectStorage interface for deterministic testing.
 * Files are stored in memory and lost when the process exits.
 */
export class FakeObjectStorageService implements IObjectStorage {
  private files: Map<string, Buffer> = new Map();
  private storageDir: string = "/tmp/fake-uploads";

  getLocalStorageDir(): string {
    return this.storageDir;
  }

  /**
   * Test helper: Set where getLocalObjectFile() materializes files on disk
   */
  setLocalStorageDir(dir: string): void {
    this.storageDir = dir;
  }

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

    const pathRegex = /^\/objects\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_\-./]+$/;
    return pathRegex.test(objectPath);
  }

  async save(relativePath: string, buffer: Buffer): Promise<void> {
    this.files.set(relativePath, buffer);
  }

  async read(objectPath: string): Promise<Buffer> {
    // Validate path
    if (!this.validateObjectPath(objectPath)) {
      const { ObjectNotFoundError } = await import("./objectStorage");
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      const { ObjectNotFoundError } = await import("./objectStorage");
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");

    const buffer = this.files.get(entityId);
    if (!buffer) {
      const { ObjectNotFoundError } = await import("./objectStorage");
      throw new ObjectNotFoundError();
    }

    return buffer;
  }

  async download(objectPath: string, res: Response): Promise<void> {
    try {
      const buffer = await this.read(objectPath);

      // Determine content type from file extension
      const ext = objectPath.split(".").pop()?.toLowerCase();
      const contentType =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "png"
            ? "image/png"
            : ext === "gif"
              ? "image/gif"
              : ext === "webp"
                ? "image/webp"
                : "application/octet-stream";

      res.set({
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=3600",
      });

      res.send(buffer);
    } catch (error) {
      res.status(404).json({ error: "File not found" });
    }
  }

  // Legacy method aliases for backwards compatibility
  async saveLocalFile(relativePath: string, buffer: Buffer): Promise<void> {
    return this.save(relativePath, buffer);
  }

  async readFile(objectPath: string): Promise<Buffer> {
    return this.read(objectPath);
  }

  async getLocalObjectFile(objectPath: string): Promise<string> {
    // Validate and return fake path
    if (!this.validateObjectPath(objectPath)) {
      const { ObjectNotFoundError } = await import("./objectStorage");
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      const { ObjectNotFoundError } = await import("./objectStorage");
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");

    const buffer = this.files.get(entityId);
    if (!buffer) {
      const { ObjectNotFoundError } = await import("./objectStorage");
      throw new ObjectNotFoundError();
    }

    // Callers expect a real file, so write the in-memory bytes to disk on demand
    const filePath = path.join(this.storageDir, entityId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);

    return filePath;
  }

  async downloadLocalObject(
    filePath: string,
    res: Response,
    _cacheTtlSec: number = 3600
  ): Promise<void> {
    const relativePath = filePath.replace(`${this.storageDir}/`, "");
    const objectPath = `/objects/${relativePath}`;
    return this.download(objectPath, res);
  }

  /**
   * Test helper: Clear all files from storage
   */
  clear(): void {
    this.files.clear();
  }

  /**
   * Test helper: Get file buffer for assertions
   */
  getFile(relativePath: string): Buffer | undefined {
    return this.files.get(relativePath);
  }
}

/**
 * Fake analyzer for testing - returns deterministic results
 */
export class FakeAnalyzer implements IAnalyzer {
  readonly capabilities = {
    supportsMultiItem: false,
  };

  async identify(_images: Buffer[]): Promise<IdentificationResult> {
    return {
      name: "Test Item",
      description: "Test description",
      category: "Test",
      tags: ["test"],
      confidence: 1.0,
      notes: null,
      alternatives: [],
      model: "fake",
      promptVersion: "identify-test",
      raw: null,
    };
  }

  async estimateValue(_input: ValuationInput): Promise<ValuationResult> {
    return {
      status: "estimated",
      marketability: "marketable",
      marketabilityReason: "Test marketability",
      low: "5.00",
      likely: "10.00",
      high: "15.00",
      confidence: "medium",
      rationale: "Test valuation",
      missingInformation: [],
      scope: "item",
      assumptions: ["visible_condition_only"],
      model: "fake",
      promptVersion: "valuation-test",
      raw: null,
    };
  }
}

/**
 * Create test services with fake implementations
 *
 * This factory instantiates all backend services using in-memory fakes.
 * Services are fast, deterministic, and require no external dependencies.
 * Ideal for unit tests, integration tests, and E2E tests.
 *
 * @param _config - Validated application configuration (reserved for future use)
 * @returns {AppServices} Container with fake service instances
 */
export async function createTestServices(
  _config: AppConfig
): Promise<AppServices> {
  const { ItemService } = await import("./itemService");

  const storage = new FakeDatabaseStorage();
  const objectStorage = new FakeObjectStorageService();
  const analyzer = new FakeAnalyzer();
  const itemService = new ItemService(storage, objectStorage, analyzer);
  const photoService = new PhotoService(storage, objectStorage);

  return {
    storage,
    objectStorage,
    analyzer,
    itemService,
    photoService,
    openaiCheap: {} as any,
    openaiPremium: {} as any,
  };
}
