import { sql } from "drizzle-orm";
import { pgTable, text, uuid, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  imageUrl: text("image_url").notNull(), // FOUNDATION: See FOUNDATION.md Principle 1 for imageUrl → imageUrls migration path (PRD 0004+)
  imageUrls: text("image_urls").array().$type<string[]>(), // FOUNDATION: Multi-image support (PRD 0004) - nullable for backwards compatibility
  barcodeData: text("barcode_data").notNull(),
  estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }),
  valueConfidence: text("value_confidence"),
  valueRationale: text("value_rationale"),
  location: text("location"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({
  id: true,
  createdAt: true,
});

export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItems.$inferSelect;
