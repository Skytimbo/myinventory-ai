/**
 * ItemService - Business Logic Layer (Architecture Refactoring)
 *
 * This module extracts business logic from routes.ts into a dedicated service:
 * - Item creation with AI identification
 * - Quick Capture mode (skip AI, identify later)
 * - Re-identification of existing items
 * - Item CRUD operations
 *
 * - Value estimation on explicit request
 *
 * Identification never writes monetary values. The legacy estimated_value /
 * value_confidence / value_rationale columns are never written here.
 *
 * Follows Single Responsibility Principle:
 * - Routes handle HTTP concerns only
 * - ItemService handles business logic
 *
 * All dependencies are constructor-injected for testability.
 */

import { randomUUID, createHash } from "crypto";
import type { IStorage } from "./storage";
import type { IObjectStorage } from "./objectStorage";
import {
  confidenceToUncertainty,
  MAX_AI_IMAGES,
  type IAnalyzer,
  type IdentificationResult,
  type ValuationResult,
} from "./analyzer";
import { validateUploadedFile } from "./fileValidation";
import { PhotoService } from "./photoService";
import type {
  AssertableField,
  Identification,
  InventoryItem,
  UserAssertions,
  Valuation,
} from "@shared/schema";
import { getIdentificationStatus } from "@shared/valuation";

/** Shown with every valuation: no external sales data is retrieved */
export const MODEL_JUDGMENT_NOTE =
  "AI judgment from the photos and identification. No marketplace or sales data was retrieved.";

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Options for creating a new inventory item
 */
export interface CreateItemOptions {
  files: Express.Multer.File[];
  skipAI?: boolean;
  location?: string;
}

/**
 * Result of creating an item, includes any AI warnings
 */
export interface CreateItemResult {
  item: InventoryItem;
  aiWarning: string | null;
}

/**
 * Interface for item service operations
 */
/** User edits and confirmations (Milestone 1, stage 3) */
export interface EditItemInput {
  /** New values; each one becomes a user assertion */
  fields?: Partial<{
    name: string;
    description: string;
    category: string;
    tags: string[];
    location: string | null;
    notes: string | null;
  }>;
  /** Confirm current values as they are (no retyping) */
  confirm?: AssertableField[];
  /** Apply the AI's kept suggestion for these fields, as the user's choice */
  acceptSuggestions?: Array<"name" | "description" | "category" | "tags">;
}

export interface IItemService {
  createItem(options: CreateItemOptions): Promise<CreateItemResult>;
  identifyItem(itemId: string): Promise<InventoryItem>;
  createItemFromPhotos(input: { photoIds: string[]; name?: string; identify?: boolean }): Promise<CreateItemResult>;
  estimateValue(itemId: string): Promise<InventoryItem>;
  editItem(itemId: string, input: EditItemInput): Promise<InventoryItem>;
  getItem(id: string): Promise<InventoryItem | undefined>;
  getItems(): Promise<InventoryItem[]>;
  deleteItem(id: string): Promise<boolean>;
}

/**
 * ItemService - Core business logic for inventory items
 *
 * Encapsulates all item-related operations:
 * - Creating items (with or without AI analysis)
 * - Analyzing existing items (for Quick Capture flow)
 * - CRUD operations
 */
export class ItemService implements IItemService {
  constructor(
    private storage: IStorage,
    private objectStorage: IObjectStorage,
    private analyzer: IAnalyzer
  ) {
    this.photos = new PhotoService(storage, objectStorage);
  }

  private photos: PhotoService;

  /**
   * Create a new inventory item with optional AI identification
   *
   * @param options.files - Uploaded image files (at least one required)
   * @param options.skipAI - If true, skip AI identification (Quick Capture mode)
   * @param options.location - Optional location string
   * @returns Created item and any AI warning message
   */
  async createItem(options: CreateItemOptions): Promise<CreateItemResult> {
    const { files, skipAI = false, location } = options;

    // Validate all files
    for (const file of files) {
      const validation = validateUploadedFile(file);
      if (!validation.valid) {
        throw new Error(validation.error || "Invalid file type");
      }
    }

    // Run AI identification (or skip for Quick Capture)
    const identifyStart = Date.now();
    const { result, aiWarning } = await this.getIdentification(
      files.map((file) => file.buffer),
      skipAI
    );
    const latencyMs = Date.now() - identifyStart;
    const identifiedAt = new Date().toISOString();

    // Compute image hash for traceability
    const imageHash = files[0].buffer ? hashBuffer(files[0].buffer) : undefined;

    const analysisMetadata = {
      model: skipAI ? "none" : result?.model ?? "openai",
      timestamp: identifiedAt,
      version: "v3",
      imageHash,
      latencyMs,
      note: aiWarning || null,
    };

    // Store the uploads as photo evidence (independent of the item), then link them
    const photos = await this.photos.ingest(
      files.map((file) => ({ buffer: file.buffer, originalFilename: file.originalname })),
      { batchId: null, source: "item_upload" }
    );
    const imageUrls = photos.map((photo) => photo.objectPath);

    // Generate barcode
    const barcodeData = `INV-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const details = result
      ? identificationToItemFields(result)
      : skipAI
        ? { name: "Untitled Item", description: "", category: "Uncategorized", tags: [] }
        : {
            name: "Item",
            description: "AI identification unavailable.",
            category: "Uncategorized",
            tags: [],
          };

    // Create database record. Valuation is never set at creation.
    const item = await this.storage.createItem({
      ...details,
      imageUrl: imageUrls[0],
      imageUrls: imageUrls,
      barcodeData,
      location,
      analysisMetadata,
      identification: result ? toIdentification(result, identifiedAt) : null,
      valuation: null,
    });
    await this.storage.linkPhotos(item.id, photos.map((photo) => photo.id), identifiedAt);

    return { item, aiWarning };
  }

  /**
   * Identify (or re-identify) an existing item from its photos
   *
   * Updates name, description, category, tags, and identification. Leaves
   * location and all valuation data intact, except that an existing
   * valuation is marked stale because it was based on the earlier
   * identification. If the AI call fails nothing is written.
   *
   * @throws Error("Item not found") or the AI error
   */
  async identifyItem(itemId: string): Promise<InventoryItem> {
    const item = await this.storage.getItem(itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    const images = await this.readItemImages(item);

    const identifyStart = Date.now();
    const result = await this.analyzer.identify(images);
    const latencyMs = Date.now() - identifyStart;
    const identifiedAt = new Date().toISOString();

    // Re-read so a valuation saved while the AI call ran is not lost
    const current = await this.storage.getItem(itemId);
    if (!current) {
      throw new Error("Item not found");
    }

    const valuation =
      current.valuation && !current.valuation.staleAt
        ? { ...current.valuation, staleAt: identifiedAt, staleReason: "reidentified" }
        : current.valuation;

    // Never overwrite a field the user asserted; keep the AI's differing value as a suggestion
    const { applied, suggestions } = applyRespectingAssertions(
      identificationToItemFields(result),
      current
    );

    const updated = await this.storage.updateItem(itemId, {
      ...applied,
      identification: {
        ...toIdentification(result, identifiedAt),
        ...(Object.keys(suggestions).length ? { suggestions } : {}),
      },
      valuation,
      analysisMetadata: {
        model: result.model,
        timestamp: identifiedAt,
        version: "v3",
        imageHash: hashBuffer(images[0]),
        latencyMs,
        note: null,
      },
    });

    if (!updated) {
      throw new Error("Failed to update item");
    }

    return updated;
  }

  /**
   * Create an inventory entry from photos already captured as evidence.
   * Photos are linked, not copied; a photo may support several entries.
   * Context of the first photo's batch pre-fills fields as user assertions
   * (source "batch_context"). AI runs only if requested; if it fails the
   * entry is still created, unidentified.
   */
  async createItemFromPhotos(input: {
    photoIds: string[];
    name?: string;
    identify?: boolean;
  }): Promise<CreateItemResult> {
    const photoIds = Array.from(new Set(input.photoIds));
    const photos = await this.storage.getPhotos(photoIds);
    if (photoIds.length === 0 || photos.length !== photoIds.length) {
      throw new Error("Photo not found");
    }

    const now = new Date().toISOString();
    const snapshot = await this.storage.getEvidenceSnapshot();
    const context = snapshot.batches.find((batch) => batch.id === photos[0].batchId)?.context ?? {};
    const assertions: UserAssertions = {};
    const fromContext = { source: "batch_context" as const, assertedAt: now };

    const name = input.name?.trim().slice(0, 120);
    if (name) assertions.name = { source: "user", assertedAt: now };
    const category = context.category?.trim();
    if (category) assertions.category = fromContext;
    const location = [context.location, context.container].map((part) => part?.trim()).filter(Boolean).join(" › ");
    if (location) assertions.location = fromContext;
    const notes = context.purpose?.trim() ? `Purpose: ${context.purpose.trim()}` : null;
    if (notes) assertions.notes = fromContext;

    const item = await this.storage.createItem({
      name: name || "Untitled Item",
      description: "",
      category: category || "Uncategorized",
      tags: [],
      imageUrl: photos[0].objectPath,
      imageUrls: photos.map((photo) => photo.objectPath),
      barcodeData: `INV-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      location: location || null,
      notes,
      userAssertions: Object.keys(assertions).length ? assertions : null,
      analysisMetadata: {
        model: "none",
        timestamp: now,
        version: "v3",
        imageHash: photos[0].sha256,
        note: "Created from captured photos - not yet identified",
      },
      identification: null,
      valuation: null,
    });
    await this.storage.linkPhotos(item.id, photos.map((photo) => photo.id), now);

    if (!input.identify) {
      return { item, aiWarning: null };
    }
    try {
      return { item: await this.identifyItem(item.id), aiWarning: null };
    } catch (err) {
      console.error("AI identification failed:", err);
      return { item, aiWarning: "AI identification unavailable. Use Identify to try again." };
    }
  }

  /**
   * Estimate an item's secondhand resale value (explicit user action only)
   *
   * Replaces the item's valuation with a fresh one and writes nothing else.
   * If the item was re-identified while the AI call ran, the new valuation
   * is saved already stale. If the AI call fails nothing is written.
   *
   * @throws Error("Item not found"), Error("Item not identified"), or the AI error
   */
  async estimateValue(itemId: string): Promise<InventoryItem> {
    const item = await this.storage.getItem(itemId);
    if (!item) {
      throw new Error("Item not found");
    }
    if (getIdentificationStatus(item) === "unidentified") {
      throw new Error("Item not identified");
    }

    const basedOn = {
      name: item.name,
      category: item.category,
      identifiedAt: item.identification?.identifiedAt ?? null,
    };

    const result = await this.analyzer.estimateValue({
      images: await this.readItemImages(item),
      name: item.name,
      description: item.description,
      category: item.category,
      identificationNotes: item.identification?.notes ?? null,
    });
    const evaluatedAt = new Date().toISOString();

    const current = await this.storage.getItem(itemId);
    if (!current) {
      throw new Error("Item not found");
    }
    const reidentified = (current.identification?.identifiedAt ?? null) !== basedOn.identifiedAt;

    const updated = await this.storage.updateItem(itemId, {
      valuation: toValuation(result, {
        basedOn,
        evaluatedAt,
        staleAt: reidentified ? evaluatedAt : null,
      }),
    });

    if (!updated) {
      throw new Error("Failed to update item");
    }

    return updated;
  }

  /**
   * Get a single item by ID
   */
  /**
   * Apply user edits and confirmations. Every edited, confirmed, or accepted
   * field is recorded as a user assertion, which AI identification never
   * overwrites. Changing what the item is (name, description, category)
   * marks a current estimate stale, because it described the old identity.
   *
   * @throws Error("Item not found"), Error("No suggestion for <field>")
   */
  async editItem(itemId: string, input: EditItemInput): Promise<InventoryItem> {
    const item = await this.storage.getItem(itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    const now = new Date().toISOString();
    const userAssertion = { source: "user" as const, assertedAt: now };
    const updates: Record<string, unknown> = {};
    const assertions: UserAssertions = { ...(item.userAssertions ?? {}) };

    for (const [field, value] of Object.entries(input.fields ?? {})) {
      updates[field] = value;
      assertions[field as AssertableField] = userAssertion;
    }

    const suggestions = { ...(item.identification?.suggestions ?? {}) };
    for (const field of input.acceptSuggestions ?? []) {
      if (suggestions[field] === undefined) {
        throw new Error(`No suggestion for ${field}`);
      }
      updates[field] = suggestions[field];
      assertions[field] = userAssertion;
      delete suggestions[field];
    }

    for (const field of input.confirm ?? []) {
      assertions[field] = userAssertion;
    }

    const identityChanged = (["name", "description", "category"] as const).some(
      (field) => field in updates && updates[field] !== item[field]
    );
    const valuation =
      identityChanged && item.valuation && !item.valuation.staleAt
        ? { ...item.valuation, staleAt: now, staleReason: "user_edited" }
        : item.valuation;

    const updated = await this.storage.updateItem(itemId, {
      ...updates,
      userAssertions: assertions,
      valuation,
      ...(input.acceptSuggestions?.length && item.identification
        ? { identification: { ...item.identification, suggestions } }
        : {}),
    });
    if (!updated) {
      throw new Error("Failed to update item");
    }
    return updated;
  }

  async getItem(id: string): Promise<InventoryItem | undefined> {
    return this.storage.getItem(id);
  }

  /**
   * Get all items
   */
  async getItems(): Promise<InventoryItem[]> {
    return this.storage.getItems();
  }

  /**
   * Delete an item by ID
   */
  async deleteItem(id: string): Promise<boolean> {
    return this.storage.deleteItem(id);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Get AI identification for new images, with fallback handling
   *
   * @returns The result (null when skipped or failed) and an optional warning
   */
  private async getIdentification(
    images: Buffer[],
    skipAI: boolean
  ): Promise<{ result: IdentificationResult | null; aiWarning: string | null }> {
    if (skipAI) {
      return { result: null, aiWarning: "Quick capture - not yet identified" };
    }

    try {
      return { result: await this.analyzer.identify(images), aiWarning: null };
    } catch (err) {
      console.error("AI identification failed:", err);
      return {
        result: null,
        aiWarning: "AI identification unavailable. Use Identify to try again.",
      };
    }
  }

  /**
   * Read up to MAX_AI_IMAGES of an item's photos, primary image first
   */
  private async readItemImages(item: InventoryItem): Promise<Buffer[]> {
    const urls = item.imageUrls?.length ? item.imageUrls : [item.imageUrl];
    const images: Buffer[] = [];
    for (const url of urls.slice(0, MAX_AI_IMAGES)) {
      images.push(await this.objectStorage.read(url));
    }
    return images;
  }

}

function identificationToItemFields(result: IdentificationResult) {
  return {
    name: result.name,
    description: result.description,
    category: result.category,
    tags: result.tags,
  };
}

function toIdentification(result: IdentificationResult, identifiedAt: string): Identification {
  return {
    confidence: result.confidence,
    uncertainty: confidenceToUncertainty(result.confidence),
    notes: result.notes,
    alternatives: result.alternatives,
    model: result.model,
    identifiedAt,
    promptVersion: result.promptVersion,
  };
}

function toValuation(
  result: ValuationResult,
  context: { basedOn: Valuation["basedOn"]; evaluatedAt: string; staleAt: string | null }
): Valuation {
  return {
    status: result.status,
    marketability: result.marketability,
    marketabilityReason: result.marketabilityReason,
    currency: "USD",
    low: result.low,
    likely: result.likely,
    high: result.high,
    confidence: result.confidence,
    rationale: result.rationale,
    missingInformation: result.missingInformation,
    scope: result.scope,
    assumptions: result.assumptions,
    // Set here, never from model output
    evidence: { basis: "model_judgment", note: MODEL_JUDGMENT_NOTE },
    basedOn: context.basedOn,
    model: result.model,
    evaluatedAt: context.evaluatedAt,
    promptVersion: result.promptVersion,
    staleAt: context.staleAt,
    staleReason: context.staleAt ? "reidentified" : null,
  };
}

const IDENTIFIED_FIELDS = ["name", "description", "category", "tags"] as const satisfies readonly AssertableField[];

/**
 * Split AI identification into fields to apply and suggestions for fields
 * the user asserted. A suggestion is kept only when it differs.
 */
function applyRespectingAssertions(
  fields: ReturnType<typeof identificationToItemFields>,
  current: InventoryItem
): { applied: Partial<ReturnType<typeof identificationToItemFields>>; suggestions: NonNullable<Identification["suggestions"]> } {
  const asserted = current.userAssertions ?? {};
  const applied: Partial<ReturnType<typeof identificationToItemFields>> = {};
  const suggestions: Record<string, unknown> = {};
  for (const field of IDENTIFIED_FIELDS) {
    if (asserted[field]) {
      if (JSON.stringify(fields[field]) !== JSON.stringify(current[field])) {
        suggestions[field] = fields[field];
      }
    } else {
      (applied as Record<string, unknown>)[field] = fields[field];
    }
  }
  return { applied, suggestions: suggestions as NonNullable<Identification["suggestions"]> };
}
