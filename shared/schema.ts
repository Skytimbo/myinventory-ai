import { sql } from "drizzle-orm";
import { pgTable, text, uuid, decimal, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { VALUATION_ASSUMPTIONS, VALUATION_SCOPES } from "./valuationVocabulary";

export const analysisMetadataSchema = z
  .object({
    model: z.string().optional(),
    timestamp: z.string().optional(),
    version: z.string().optional(),
    imageHash: z.string().optional(),
    latencyMs: z.number().optional(),
    note: z.string().nullable().optional(),
  })
  .nullable();

export type AnalysisMetadata = z.infer<typeof analysisMetadataSchema>;

export const confidenceLevelSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceLevel = z.infer<typeof confidenceLevelSchema>;

/** Result of the Identify action (migration 0003). Never contains monetary values. */
export const identificationSchema = z
  .object({
    confidence: z.number(),
    uncertainty: confidenceLevelSchema,
    notes: z.string().nullable(),
    alternatives: z.array(z.string()),
    model: z.string(),
    identifiedAt: z.string(),
    promptVersion: z.string(),
  })
  .nullable();

export type Identification = NonNullable<z.infer<typeof identificationSchema>>;

export {
  VALUATION_ASSUMPTIONS,
  VALUATION_SCOPES,
  type ValuationAssumption,
  type ValuationScope,
} from "./valuationVocabulary";

/**
 * Result of the Estimate Value action (migration 0003).
 * "not_evaluated" is never stored: it is the absence of a valuation.
 * Every estimate is an indicative private-party secondhand resale value.
 */
export const valuationSchema = z
  .object({
    status: z.enum(["estimated", "nonmarketable", "insufficient_information"]),
    marketability: z.enum(["marketable", "nonmarketable", "uncertain"]),
    marketabilityReason: z.string(),
    currency: z.literal("USD"),
    low: z.string().nullable(),
    likely: z.string().nullable(),
    high: z.string().nullable(),
    confidence: confidenceLevelSchema.nullable(),
    rationale: z.string(),
    missingInformation: z.array(z.string()),
    // Set by the server, never by the model. "model_judgment" means no
    // marketplace data was retrieved.
    evidence: z.object({
      basis: z.literal("model_judgment"),
      note: z.string(),
    }),
    basedOn: z.object({
      name: z.string(),
      category: z.string(),
      identifiedAt: z.string().nullable(),
    }),
    model: z.string(),
    evaluatedAt: z.string(),
    promptVersion: z.string(),
    staleAt: z.string().nullable(),
    staleReason: z.string().nullable(),
    // valuation-v4+. Absent on earlier records, which have no recorded basis
    // and must not be reinterpreted. null/[] on non-estimated outcomes.
    scope: z.enum(VALUATION_SCOPES).nullable().optional(),
    assumptions: z.array(z.enum(VALUATION_ASSUMPTIONS)).optional(),
  })
  .nullable();

export type Valuation = NonNullable<z.infer<typeof valuationSchema>>;

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  imageUrl: text("image_url").notNull(), // FOUNDATION: See FOUNDATION.md Principle 1 for imageUrl → imageUrls migration path (PRD 0004+)
  imageUrls: text("image_urls").array().$type<string[]>(), // FOUNDATION: Multi-image support (PRD 0004) - nullable for backwards compatibility
  barcodeData: text("barcode_data").notNull(),
  // LEGACY: written only by the pre-0003 combined analysis. Current code never
  // writes these; they are preserved as-is and shown as legacy estimates.
  estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }),
  valueConfidence: text("value_confidence"),
  valueRationale: text("value_rationale"),
  location: text("location"),
  analysisMetadata: jsonb("analysis_metadata").$type<AnalysisMetadata>(),
  identification: jsonb("identification").$type<Identification>(),
  valuation: jsonb("valuation").$type<Valuation>(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems, {
  analysisMetadata: analysisMetadataSchema.optional(),
  identification: identificationSchema.optional(),
  valuation: valuationSchema.optional(),
}).omit({
  id: true,
  createdAt: true,
});

export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItems.$inferSelect;
