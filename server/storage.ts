import {
  type BatchContext,
  type CaptureBatch,
  type CaptureSession,
  type InsertPhoto,
  type InventoryItem,
  type InsertInventoryItem,
  type ItemPhoto,
  type Photo,
  captureBatches,
  captureSessions,
  inventoryItems,
  itemPhotos,
  photos,
} from "@shared/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { and, asc, eq, desc, inArray, max } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import {
  assertConnectedToLocalServer,
  assertLocalDatabaseUrl,
  isLocalDatabaseUrl,
} from "./databaseTarget";

/**
 * Driver for a connection URL: PostgreSQL on this machine uses node-postgres
 * (local development); everything else keeps the Neon HTTP driver used in
 * production.
 */
export function chooseDatabaseDriver(url: string): "node-postgres" | "neon-http" {
  return isLocalDatabaseUrl(url) ? "node-postgres" : "neon-http";
}

/** Everything needed to back up or inspect capture evidence */
export interface EvidenceSnapshot {
  sessions: CaptureSession[];
  batches: CaptureBatch[];
  photos: Photo[];
  itemPhotos: ItemPhoto[];
}

/**
 * Capture evidence (Milestone 1). Photos are independent of items; links are
 * the only relationship, so deleting an item never deletes a photo.
 */
export interface IEvidenceStore {
  createCaptureSession(input: { title: string; notes?: string | null; createdAt: string }): Promise<CaptureSession>;
  getCaptureSession(id: string): Promise<CaptureSession | undefined>;
  createCaptureBatch(input: { sessionId: string; context: BatchContext; createdAt: string }): Promise<CaptureBatch>;
  createPhoto(photo: InsertPhoto): Promise<Photo>;
  /** Photos with these ids, in the order requested; missing ids are omitted */
  getPhotos(ids: string[]): Promise<Photo[]>;
  findPhotoByObjectPath(objectPath: string): Promise<Photo | undefined>;
  /** Append photos to an item's links (existing links are kept, duplicates ignored) */
  linkPhotos(itemId: string, photoIds: string[], createdAt: string): Promise<void>;
  getEvidenceSnapshot(): Promise<EvidenceSnapshot>;
}

export interface IStorage extends IEvidenceStore {
  getItems(): Promise<InventoryItem[]>;
  getItem(id: string): Promise<InventoryItem | undefined>;
  createItem(item: InsertInventoryItem): Promise<InventoryItem>;
  updateItem(id: string, updates: Partial<InsertInventoryItem>): Promise<InventoryItem | null>;
  deleteItem(id: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private db: PgDatabase<PgQueryResultHKT>;

  private constructor(
    db: PgDatabase<PgQueryResultHKT>,
    private closeConnection: () => Promise<void> = async () => undefined
  ) {
    this.db = db;
  }

  /** Release the connection pool (local driver); scripts call this before exiting */
  async close(): Promise<void> {
    await this.closeConnection();
  }

  /**
   * Create and initialize a DatabaseStorage instance with connection testing
   *
   * @throws {Error} If DATABASE_URL is missing or connection test fails
   */
  static async create(): Promise<DatabaseStorage> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }

    // Outside production, only a local database is allowed (fail-closed, no override)
    if (process.env.NODE_ENV !== "production") {
      assertLocalDatabaseUrl(connectionString, "start the app outside production");
    }

    if (chooseDatabaseDriver(connectionString) === "node-postgres") {
      const pool = new Pool({ connectionString });
      const database = await assertConnectedToLocalServer(pool, "start the app");
      console.log(`✓ Local database connection verified (${database})`);
      // Cast: drizzle bundles its own copy of the pg type declarations
      return new DatabaseStorage(
        drizzleNodePg(pool as never) as unknown as PgDatabase<PgQueryResultHKT>,
        () => pool.end()
      );
    }

    // Initialize Neon HTTP client
    const client = neon(connectionString);
    const db = drizzle(client);

    // Test connection by running a simple query to resolve DNS early
    try {
      await client`SELECT 1`;
      console.log('✓ Database connection verified');
    } catch (error) {
      console.error('❌ Database connection test failed:', error);
      throw new Error(`Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`);
    }

    return new DatabaseStorage(db as unknown as PgDatabase<PgQueryResultHKT>);
  }

  async getItems(): Promise<InventoryItem[]> {
    const items = await this.db
      .select()
      .from(inventoryItems)
      .orderBy(desc(inventoryItems.createdAt));

    // Lazy migration: populate imageUrls from imageUrl if null (PRD 0004 - backwards compatibility)
    return items.map(item => {
      if (!item.imageUrls) {
        item.imageUrls = [item.imageUrl];
      }
      return item;
    });
  }

  async getItem(id: string): Promise<InventoryItem | undefined> {
    const results = await this.db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, id))
      .limit(1);
    const item = results[0];

    // Lazy migration: populate imageUrls from imageUrl if null (PRD 0004 - backwards compatibility)
    if (item && !item.imageUrls) {
      item.imageUrls = [item.imageUrl];
    }

    return item;
  }

  async createItem(insertItem: InsertInventoryItem): Promise<InventoryItem> {
    const results = await this.db
      .insert(inventoryItems)
      .values(insertItem)
      .returning();
    return results[0];
  }

  async updateItem(id: string, updates: Partial<InsertInventoryItem>): Promise<InventoryItem | null> {
    const results = await this.db
      .update(inventoryItems)
      .set(updates)
      .where(eq(inventoryItems.id, id))
      .returning();
    return results[0] || null;
  }

  async deleteItem(id: string): Promise<boolean> {
    // item_photos links cascade; photos are kept as evidence
    const result = await this.db
      .delete(inventoryItems)
      .where(eq(inventoryItems.id, id))
      .returning();
    return result.length > 0;
  }

  // -------------------------------------------------------------------------
  // Capture evidence
  // -------------------------------------------------------------------------

  async createCaptureSession(input: { title: string; notes?: string | null; createdAt: string }): Promise<CaptureSession> {
    const [session] = await this.db
      .insert(captureSessions)
      .values({ title: input.title, notes: input.notes ?? null, createdAt: input.createdAt })
      .returning();
    return session;
  }

  async getCaptureSession(id: string): Promise<CaptureSession | undefined> {
    const [session] = await this.db.select().from(captureSessions).where(eq(captureSessions.id, id)).limit(1);
    return session;
  }

  async createCaptureBatch(input: { sessionId: string; context: BatchContext; createdAt: string }): Promise<CaptureBatch> {
    const [batch] = await this.db.insert(captureBatches).values(input).returning();
    return batch;
  }

  async createPhoto(photo: InsertPhoto): Promise<Photo> {
    const [created] = await this.db.insert(photos).values(photo).returning();
    return created;
  }

  async getPhotos(ids: string[]): Promise<Photo[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(photos).where(inArray(photos.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is Photo => Boolean(row));
  }

  async findPhotoByObjectPath(objectPath: string): Promise<Photo | undefined> {
    const [photo] = await this.db.select().from(photos).where(eq(photos.objectPath, objectPath)).limit(1);
    return photo;
  }

  async linkPhotos(itemId: string, photoIds: string[], createdAt: string): Promise<void> {
    if (photoIds.length === 0) return;
    const [{ last }] = await this.db
      .select({ last: max(itemPhotos.position) })
      .from(itemPhotos)
      .where(eq(itemPhotos.itemId, itemId));
    let position = last === null ? 0 : Number(last) + 1;
    for (const photoId of photoIds) {
      const [existing] = await this.db
        .select()
        .from(itemPhotos)
        .where(and(eq(itemPhotos.itemId, itemId), eq(itemPhotos.photoId, photoId)))
        .limit(1);
      if (existing) continue;
      await this.db.insert(itemPhotos).values({ itemId, photoId, position, createdAt });
      position += 1;
    }
  }

  async getEvidenceSnapshot(): Promise<EvidenceSnapshot> {
    const [sessions, batches, photoRows, links] = await Promise.all([
      this.db.select().from(captureSessions).orderBy(asc(captureSessions.createdAt)),
      this.db.select().from(captureBatches).orderBy(asc(captureBatches.createdAt)),
      this.db.select().from(photos).orderBy(asc(photos.createdAt)),
      this.db.select().from(itemPhotos).orderBy(asc(itemPhotos.itemId), asc(itemPhotos.position)),
    ]);
    return { sessions, batches, photos: photoRows, itemPhotos: links };
  }
}

// Singleton removed: Use createProdServices() or createTestServices() from services.ts instead (PRD 0005)
