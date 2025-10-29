import { type InventoryItem, type InsertInventoryItem } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getItems(): Promise<InventoryItem[]>;
  getItem(id: string): Promise<InventoryItem | undefined>;
  createItem(item: InsertInventoryItem): Promise<InventoryItem>;
  deleteItem(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private items: Map<string, InventoryItem>;

  constructor() {
    this.items = new Map();
  }

  async getItems(): Promise<InventoryItem[]> {
    return Array.from(this.items.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getItem(id: string): Promise<InventoryItem | undefined> {
    return this.items.get(id);
  }

  async createItem(insertItem: InsertInventoryItem): Promise<InventoryItem> {
    const id = randomUUID();
    const item: InventoryItem = {
      ...insertItem,
      id,
      createdAt: new Date().toISOString(),
    };
    this.items.set(id, item);
    return item;
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.items.delete(id);
  }
}

export const storage = new MemStorage();
