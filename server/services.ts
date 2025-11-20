/**
 * Service Container & Dependency Injection (PRD 0005)
 *
 * This module implements the AppServices container pattern for backend services.
 * It provides:
 * - Type-safe configuration via AppConfig
 * - Production service factory (createProdServices)
 * - Test service factory (createTestServices)
 * - Dependency injection for all route handlers
 *
 * See FOUNDATION.md Principle 8 for architecture details.
 */

import path from 'path';
import { randomUUID } from 'crypto';
import type { IStorage } from './storage';
import type { ObjectStorageService } from './objectStorage';
import type { InventoryItem, InsertInventoryItem } from '@shared/schema';

/**
 * Application configuration loaded from environment variables
 */
export interface AppConfig {
  /** PostgreSQL connection string (required) */
  databaseUrl: string;

  /** OpenAI API key for image analysis (required) */
  openaiApiKey: string;

  /** OpenAI API base URL (required) */
  openaiBaseUrl: string;

  /** Whether running on Replit (auto-detected from REPL_ID) */
  isReplit: boolean;

  /** Node environment mode */
  nodeEnv: 'development' | 'production' | 'test';

  /** Server port */
  port: number;

  /** Storage backend configuration */
  storageConfig: {
    /** Private object storage directory (Replit only) */
    privateObjectDir?: string;

    /** Public object search paths (Replit only) */
    publicObjectSearchPaths?: string[];

    /** Local storage directory (local dev, default: ./uploads) */
    localStorageDir: string;
  };
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
      'DATABASE_URL environment variable is required. ' +
      'Please set it to your PostgreSQL connection string.'
    );
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const openaiBaseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

  // Auto-detect environment
  const isReplit = process.env.REPL_ID !== undefined;
  const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
  const port = parseInt(process.env.PORT || '5000', 10);

  // Storage configuration
  const storageConfig = {
    privateObjectDir: process.env.PRIVATE_OBJECT_DIR,
    publicObjectSearchPaths: process.env.PUBLIC_OBJECT_SEARCH_PATHS
      ? process.env.PUBLIC_OBJECT_SEARCH_PATHS.split(',').map(p => p.trim())
      : undefined,
    localStorageDir: process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), 'uploads'),
  };

  // Validate Replit-specific configuration
  if (isReplit) {
    if (!storageConfig.privateObjectDir) {
      throw new Error(
        'PRIVATE_OBJECT_DIR environment variable is required when running on Replit. ' +
        'Please create a bucket in Object Storage and set this variable.'
      );
    }
    if (!storageConfig.publicObjectSearchPaths || storageConfig.publicObjectSearchPaths.length === 0) {
      throw new Error(
        'PUBLIC_OBJECT_SEARCH_PATHS environment variable is required when running on Replit. ' +
        'Please set it to a comma-separated list of public object paths.'
      );
    }
  }

  return {
    databaseUrl,
    openaiApiKey,
    openaiBaseUrl,
    isReplit,
    nodeEnv,
    port,
    storageConfig,
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

  /** Object storage service (local filesystem or GCS) */
  objectStorage: ObjectStorageService;

  // Note: Image analysis is handled directly via analyzeImagePolicy() in modelPolicy.ts
  // The service container pattern is not used for AI analysis
}

/**
 * Create production services with real implementations
 *
 * This factory instantiates all backend services for production use.
 * Services will use real database connections, file storage, and AI APIs.
 *
 * @param _config - Validated application configuration (reserved for future use)
 * @returns {AppServices} Container with production service instances
 */
export async function createProdServices(_config: AppConfig): Promise<AppServices> {
  // Dynamically import services to avoid circular dependencies
  const { DatabaseStorage } = await import('./storage');
  const { ObjectStorageService } = await import('./objectStorage');

  // Instantiate production services
  // Note: Current implementations read env vars directly from process.env
  // This is acceptable for now; future refactor can pass config explicitly
  const storage = new DatabaseStorage();
  const objectStorage = new ObjectStorageService();

  return {
    storage,
    objectStorage,
  };
}

/**
 * Fake in-memory storage implementation for testing
 *
 * This class implements IStorage using an in-memory Map for deterministic testing.
 * All data is lost when the process exits. Useful for unit tests and E2E tests.
 */
export class FakeDatabaseStorage implements IStorage {
  private items: Map<string, InventoryItem> = new Map();

  async getItems(): Promise<InventoryItem[]> {
    const allItems = Array.from(this.items.values());

    // Sort by createdAt descending (newest first) to match production behavior
    allItems.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    // Lazy migration: populate imageUrls from imageUrl if null (PRD 0004 - backwards compatibility)
    return allItems.map(item => {
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

    const newItem: InventoryItem = {
      id,
      createdAt,
      ...item,
    };

    this.items.set(id, newItem);
    return newItem;
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  /**
   * Test helper: Clear all items from storage
   * Useful for resetting state between tests
   */
  clear(): void {
    this.items.clear();
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
 * This class provides a minimal fake of ObjectStorageService for deterministic testing.
 * Files are stored in memory and lost when the process exits.
 */
export class FakeObjectStorageService {
  private files: Map<string, Buffer> = new Map();
  private storageDir: string = '/tmp/fake-uploads';

  getLocalStorageDir(): string {
    return this.storageDir;
  }

  getPrivateObjectDir(): string {
    return this.storageDir;
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

  async saveLocalFile(relativePath: string, buffer: Buffer): Promise<void> {
    this.files.set(relativePath, buffer);
  }

  async getLocalObjectFile(objectPath: string): Promise<string> {
    // Validate path to prevent traversal attacks
    if (!this.validateObjectPath(objectPath)) {
      const { ObjectNotFoundError } = await import('./objectStorage');
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      const { ObjectNotFoundError } = await import('./objectStorage');
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");

    if (!this.files.has(entityId)) {
      const { ObjectNotFoundError } = await import('./objectStorage');
      throw new ObjectNotFoundError();
    }

    // Return a fake path - the actual buffer is in memory
    return `${this.storageDir}/${entityId}`;
  }

  async downloadLocalObject(filePath: string, res: any, cacheTtlSec: number = 3600): Promise<void> {
    // Extract relative path from fake path
    const relativePath = filePath.replace(`${this.storageDir}/`, '');

    const buffer = this.files.get(relativePath);
    if (!buffer) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    // Determine content type from file extension
    const ext = filePath.split('.').pop()?.toLowerCase();
    const contentType =
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'png' ? 'image/png' :
      ext === 'gif' ? 'image/gif' :
      ext === 'webp' ? 'image/webp' :
      'application/octet-stream';

    res.set({
      "Content-Type": contentType,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": `public, max-age=${cacheTtlSec}`,
    });

    res.send(buffer);
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
 * Create test services with fake implementations
 *
 * This factory instantiates all backend services using in-memory fakes.
 * Services are fast, deterministic, and require no external dependencies.
 * Ideal for unit tests, integration tests, and E2E tests.
 *
 * Note: Image analysis is tested by mocking OpenAI clients directly in test files,
 * not through this service container.
 *
 * @param _config - Validated application configuration (reserved for future use)
 * @returns {AppServices} Container with fake service instances
 */
export async function createTestServices(_config: AppConfig): Promise<AppServices> {
  const storage = new FakeDatabaseStorage();
  const objectStorage = new FakeObjectStorageService();

  return {
    storage,
    objectStorage,
  };
}
