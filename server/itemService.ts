/**
 * ItemService - Business Logic Layer (Architecture Refactoring)
 *
 * This module extracts business logic from routes.ts into a dedicated service:
 * - Item creation with AI analysis
 * - Quick Capture mode (skip AI, analyze later)
 * - Item CRUD operations
 *
 * Follows Single Responsibility Principle:
 * - Routes handle HTTP concerns only
 * - ItemService handles business logic
 *
 * All dependencies are constructor-injected for testability.
 */

import { randomUUID } from "crypto";
import type { IStorage } from "./storage";
import type { IObjectStorage } from "./objectStorage";
import type { IAnalyzer, AnalysisResult } from "./analyzer";
import { validateUploadedFile } from "./fileValidation";
import type { InventoryItem } from "@shared/schema";

// MIME type to file extension mapping
const mimeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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
  analyzeItem(itemId: string): Promise<InventoryItem>;
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
   * Create a new inventory item with optional AI analysis
   *
   * @param options.files - Uploaded image files (at least one required)
   * @param options.skipAI - If true, skip AI analysis (Quick Capture mode)
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

    // Run AI analysis (or skip for Quick Capture)
    const { analysis, aiWarning } = await this.getAnalysis(files[0], skipAI);

    // Save images to storage
    const imageUrls = await this.saveImages(files, itemId);

    // Generate barcode
    const barcodeData = `INV-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Create database record
    const item = await this.storage.createItem({
      name: analysis.name,
      description: analysis.description,
      category: analysis.category,
      tags: analysis.tags,
      imageUrl: imageUrls[0],
      imageUrls: imageUrls,
      barcodeData,
      estimatedValue: analysis.estimatedValue,
      valueConfidence: analysis.valueConfidence,
      valueRationale: analysis.valueRationale,
      location,
    });

    return { item, aiWarning };
  }

  /**
   * Analyze an existing item (for Quick Capture mode)
   *
   * Reads the item's primary image and runs AI analysis,
   * then updates the item with the results.
   *
   * @param itemId - ID of the item to analyze
   * @returns Updated item with AI-generated metadata
   * @throws Error if item not found or analysis fails
   */
  async analyzeItem(itemId: string): Promise<InventoryItem> {
    const item = await this.storage.getItem(itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    // Read image from storage
    const imageBuffer = await this.objectStorage.read(item.imageUrl);

    // Run AI analysis
    const analysis = await this.analyzer.analyze(imageBuffer);

    // Update item with AI results
    const updated = await this.storage.updateItem(itemId, {
      name: analysis.name,
      description: analysis.description,
      category: analysis.category,
      tags: analysis.tags,
      estimatedValue: analysis.estimatedValue,
      valueConfidence: analysis.valueConfidence,
      valueRationale: analysis.valueRationale,
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
   * Get AI analysis for an image, with fallback handling
   *
   * @param file - Image file to analyze
   * @param skipAI - If true, return placeholder values without calling AI
   * @returns Analysis result and optional warning message
   */
  private async getAnalysis(
    file: Express.Multer.File,
    skipAI: boolean
  ): Promise<{ analysis: AnalysisResult; aiWarning: string | null }> {
    if (skipAI) {
      return {
        analysis: {
          name: "Untitled Item",
          description: "",
          category: "Uncategorized",
          tags: [],
          confidence: 0,
          estimatedValue: null,
          valueConfidence: null,
          valueRationale: null,
          raw: null,
        },
        aiWarning: "Quick capture - not yet analyzed",
      };
    }

    try {
      const analysis = await this.analyzer.analyze(file.buffer);
      return { analysis, aiWarning: null };
    } catch (err) {
      console.error("AI analysis failed:", err);
      return {
        analysis: {
          name: "Item",
          description: "AI analysis temporarily unavailable.",
          category: "Uncategorized",
          tags: [],
          confidence: 0,
          estimatedValue: null,
          valueConfidence: null,
          valueRationale: null,
          raw: null,
        },
        aiWarning: "AI analysis unavailable. Please update details manually.",
      };
    }
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
