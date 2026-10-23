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
import type { Identification, InventoryItem, Valuation } from "@shared/schema";
import { getIdentificationStatus } from "@shared/valuation";

/** Shown with every valuation: no external sales data is retrieved */
export const MODEL_JUDGMENT_NOTE =
  "AI judgment from the photos and identification. No marketplace or sales data was retrieved.";

// MIME type to file extension mapping
const mimeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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
export interface IItemService {
  createItem(options: CreateItemOptions): Promise<CreateItemResult>;
  identifyItem(itemId: string): Promise<InventoryItem>;
  estimateValue(itemId: string): Promise<InventoryItem>;
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
  ) {}

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

    // Generate item ID
    const itemId = randomUUID();

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

    // Save images to storage
    const imageUrls = await this.saveImages(files, itemId);

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

    const updated = await this.storage.updateItem(itemId, {
      ...identificationToItemFields(result),
      identification: toIdentification(result, identifiedAt),
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

  /**
   * Save uploaded images to object storage
   *
   * @param files - Array of uploaded files
   * @param itemId - Item ID for path generation
   * @returns Array of image URLs
   */
  private async saveImages(
    files: Express.Multer.File[],
    itemId: string
  ): Promise<string[]> {
    const imageUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = mimeToExt[file.mimetype] || "jpg";

      const isSingleImage = files.length === 1;
      const imageUrl = isSingleImage
        ? `/objects/items/${itemId}.${ext}`
        : `/objects/items/${itemId}/${i}.${ext}`;
      const storagePath = isSingleImage
        ? `items/${itemId}.${ext}`
        : `items/${itemId}/${i}.${ext}`;

      imageUrls.push(imageUrl);
      await this.objectStorage.save(storagePath, file.buffer);
    }

    return imageUrls;
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
