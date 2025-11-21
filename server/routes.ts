import type { Express } from "express";
import { createServer, type Server } from "http";
import type { AppServices } from "./services";
import { ObjectNotFoundError } from "./objectStorage";
import multer from "multer";
import { randomUUID } from "crypto";
import { wrap, ApiError } from "./errors";
import { validateUploadedFile } from "./fileValidation";
import { analyzeImagePolicy, type AnalysisResult } from "./modelPolicy";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10485760 } // 10MB limit
});

// MIME type to file extension mapping
// FOUNDATION: See FOUNDATION.md Principle 1 for guidance on adding new media formats
const mimeToExt: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // Future formats: 'image/avif' → 'avif', 'image/heic' → 'heic', 'video/mp4' → 'mp4', 'application/pdf' → 'pdf'
};

export async function registerRoutes(app: Express, services: AppServices): Promise<Server> {
  // Destructure services for convenient access in route handlers
  const { storage, objectStorage } = services;

  // Health check endpoint for Replit deployment monitoring
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development"
    });
  });

  // Multer error handler for file size limits
  app.use((error: any, req: any, res: any, next: any) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'File too large. Maximum size is 10MB.',
          code: 'FILE_TOO_LARGE'
        });
      }
    }
    next(error);
  });

  // Get all inventory items
  app.get("/api/items", wrap(async (req, res) => {
    const items = await storage.getItems();
    res.json(items);
  }));

  // Get single inventory item
  app.get("/api/items/:id", wrap(async (req, res) => {
    const item = await storage.getItem(req.params.id);
    if (!item) {
      throw new ApiError(404, 'NOT_FOUND', 'Item not found');
    }
    res.json(item);
  }));

  // Create new inventory item with image analysis (PRD 0004: Multi-image support)
  app.post("/api/items", upload.fields([
    { name: 'images', maxCount: 10 },  // New multi-image clients (PRD 0004)
    { name: 'image', maxCount: 1 }      // Legacy single-image clients (backwards compat)
  ]), wrap(async (req, res) => {
    // Normalize to array: support both "images[]" (new) and "image" (legacy)
    const uploadedFiles = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    let files: Express.Multer.File[] = [];

    if (uploadedFiles) {
      // Prefer "images" array if present (new multi-image flow)
      if (uploadedFiles.images && uploadedFiles.images.length > 0) {
        files = uploadedFiles.images;
      }
      // Fallback to "image" field (legacy single-image flow)
      else if (uploadedFiles.image && uploadedFiles.image.length > 0) {
        files = uploadedFiles.image;
      }
    }

    if (files.length === 0) {
      throw new ApiError(400, 'NO_IMAGE', 'No images provided. Use "images" field for multiple images or "image" for single image.');
    }

    // Validate all uploaded files
    for (const file of files) {
      const validation = validateUploadedFile(file);
      if (!validation.valid) {
        throw new ApiError(400, 'INVALID_FILE_TYPE', validation.error || 'Invalid file type');
      }
    }

    // Generate item ID once for all images
    const itemId = randomUUID();

    // Run AI analysis only on first image (primary) - PRD 0004
    const primaryFile = files[0];

    let analysis: AnalysisResult;
    try {
      analysis = await analyzeImagePolicy(primaryFile.buffer);
    } catch (err) {
      console.error("AI analysis failed:", err);
      // Use fallback values - null for value fields, not "0.00"
      analysis = {
        name: "Item",
        description: "AI analysis temporarily unavailable. Please add details manually.",
        category: "Uncategorized",
        tags: [],
        confidence: 0,
        estimatedValue: null,
        valueConfidence: null,
        valueRationale: null,
        raw: null,
      };
    }

    // Generate storage paths and URLs for all images
    const imageUrls: string[] = [];

    // Save all images to storage
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = mimeToExt[file.mimetype] || 'jpg';

        // Multi-image path format: /objects/items/{itemId}/{index}.{ext}
        // Single-image legacy format: /objects/items/{itemId}.{ext}
        let imageUrl: string;
        let storagePath: string;

        if (files.length === 1) {
          // Legacy single-image format for backwards compatibility
          imageUrl = `/objects/items/${itemId}.${ext}`;
          storagePath = `items/${itemId}.${ext}`;
        } else {
          // Multi-image format with index
          imageUrl = `/objects/items/${itemId}/${i}.${ext}`;
          storagePath = `items/${itemId}/${i}.${ext}`;
        }

        imageUrls.push(imageUrl);

        // Save to local filesystem storage
        await objectStorage.saveLocalFile(storagePath, file.buffer);
      }
    } catch (error) {
      console.error('Storage error:', error);
      throw new ApiError(500, 'STORAGE_ERROR', 'Failed to save images');
    }

    // Generate barcode data (using item ID)
    const barcodeData = `INV-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Create inventory item with both imageUrl (primary) and imageUrls (all images)
    const item = await storage.createItem({
      name: analysis.name,
      description: analysis.description,
      category: analysis.category,
      tags: analysis.tags,
      imageUrl: imageUrls[0], // Primary image
      imageUrls: imageUrls,   // All images (PRD 0004)
      barcodeData,
      estimatedValue: analysis.estimatedValue,
      valueConfidence: analysis.valueConfidence,
      valueRationale: analysis.valueRationale,
    });

    res.json(item);
  }));

  // Delete inventory item
  app.delete("/api/items/:id", wrap(async (req, res) => {
    const success = await storage.deleteItem(req.params.id);
    if (!success) {
      throw new ApiError(404, 'NOT_FOUND', 'Item not found');
    }
    res.json({ success: true });
  }));

  // Serve objects (images)
  app.get("/objects/:objectPath(*)", wrap(async (req, res) => {
    // Serve from local filesystem
    const localPath = await objectStorage.getLocalObjectFile(req.path);
    objectStorage.downloadLocalObject(localPath, res);
  }));

  const httpServer = createServer(app);

  return httpServer;
}
