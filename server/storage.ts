import { type InventoryItem, type InsertInventoryItem, inventoryItems } from "@shared/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

export interface IStorage {
  getItems(): Promise<InventoryItem[]>;
  getItem(id: string): Promise<InventoryItem | undefined>;
  createItem(item: InsertInventoryItem): Promise<InventoryItem>;
  deleteItem(id: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private db: NeonHttpDatabase;
  private client: ReturnType<typeof neon>;

  private constructor(db: NeonHttpDatabase, client: ReturnType<typeof neon>) {
    this.db = db;
    this.client = client;
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

    // Initialize Neon HTTP client with explicit fetch
    const client = neon(connectionString, { fetch });
    const db = drizzle(client);

    // Test connection by running a simple query to resolve DNS early
    try {
      await client`SELECT 1`;
      console.log('✓ Database connection verified');
    } catch (error) {
      console.error('❌ Database connection test failed:', error);
      throw new Error(`Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`);
    }

    return new DatabaseStorage(db, client);
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

  async deleteItem(id: string): Promise<boolean> {
    const result = await this.db
      .delete(inventoryItems)
      .where(eq(inventoryItems.id, id))
      .returning();
    return result.length > 0;
  }
}

// Singleton removed: Use createProdServices() or createTestServices() from services.ts instead (PRD 0005)
