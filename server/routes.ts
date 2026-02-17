/**
 * Routes - Thin HTTP Layer (Architecture Refactoring)
 *
 * This module handles HTTP concerns only:
 * - Request parsing and validation
 * - Response formatting
 * - Error translation to HTTP status codes
 *
 * All business logic is delegated to ItemService.
 * Follows Single Responsibility Principle.
 */

import type { Express } from "express";
import { createServer, type Server } from "http";
import type { AppServices } from "./services";
import multer from "multer";
import { wrap, ApiError } from "./errors";
import { validateUploadedFile } from "./fileValidation";
import { openAIHealthCheck } from "./analyzer";
import { getOpenAIEnvHealth } from "./health/openaiHealth";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10485760 }, // 10MB limit
});

export async function registerRoutes(
  app: Express,
  services: AppServices
): Promise<Server> {
  const { itemService, objectStorage } = services;

  // ============================================================
  // Health Endpoints
  // ============================================================

  app.get("/api/health", async (req, res) => {
    const ai = await openAIHealthCheck(services.openaiCheap);
    res.json({
      ok: true,
      node: process.version,
      env: {
        projectIdLoaded: !!process.env.OPENAI_PROJECT_ID,
        apiKeyLoaded: !!process.env.OPENAI_API_KEY,
      },
      ai,
    });
  });

  app.get("/api/health/openai", (req, res) => {
    const health = getOpenAIEnvHealth();
    res.json(health);
  });

  // ============================================================
  // Multer Error Handler
  // ============================================================

  app.use((error: any, req: any, res: any, next: any) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "File too large. Maximum size is 10MB.",
          code: "FILE_TOO_LARGE",
        });
      }
    }
    next(error);
  });

  // ============================================================
  // Item CRUD Endpoints
  // ============================================================

  // GET /api/items - List all items
  app.get(
    "/api/items",
    wrap(async (req, res) => {
      const items = await itemService.getItems();
      res.json(items);
    })
  );

  // GET /api/items/:id - Get single item
  app.get(
    "/api/items/:id",
    wrap(async (req, res) => {
      const item = await itemService.getItem(req.params.id);
      if (!item) {
        throw new ApiError(404, "NOT_FOUND", "Item not found");
      }
      res.json(item);
    })
  );

  // POST /api/items - Create new item with image upload
  app.post(
    "/api/items",
    upload.fields([
      { name: "images", maxCount: 10 }, // Multi-image (PRD 0004)
      { name: "image", maxCount: 1 }, // Legacy single-image
    ]),
    wrap(async (req, res) => {
      // Normalize files from request
      const files = normalizeFiles(req.files);

      if (files.length === 0) {
        throw new ApiError(
          400,
          "NO_IMAGE",
          'No images provided. Use "images" field for multiple images or "image" for single image.'
        );
      }

      // Validate all files at HTTP layer
      for (const file of files) {
        const validation = validateUploadedFile(file);
        if (!validation.valid) {
          throw new ApiError(
            400,
            "INVALID_FILE_TYPE",
            validation.error || "Invalid file type"
          );
        }
      }

      // Delegate to service
      try {
        const result = await itemService.createItem({
          files,
          skipAI: req.body.skipAI === "true" || req.body.skipAI === true,
          location: req.body.location,
        });

        res.json({ ...result.item, _aiWarning: result.aiWarning });
      } catch (err: any) {
        throw new ApiError(500, "CREATE_FAILED", err.message);
      }
    })
  );

  // DELETE /api/items/:id - Delete item
  app.delete(
    "/api/items/:id",
    wrap(async (req, res) => {
      const success = await itemService.deleteItem(req.params.id);
      if (!success) {
        throw new ApiError(404, "NOT_FOUND", "Item not found");
      }
      res.json({ success: true });
    })
  );

  // POST /api/items/:id/analyze - Analyze existing item (Quick Capture)
  app.post(
    "/api/items/:id/analyze",
    wrap(async (req, res) => {
      try {
        const item = await itemService.analyzeItem(req.params.id);
        res.json(item);
      } catch (err: any) {
        if (err.message === "Item not found") {
          throw new ApiError(404, "NOT_FOUND", "Item not found");
        }
        throw new ApiError(500, "ANALYSIS_FAILED", err.message);
      }
    })
  );

  // ============================================================
  // Object Storage Endpoint
  // ============================================================

  app.get(
    "/objects/:objectPath(*)",
    wrap(async (req, res) => {
      await objectStorage.download(req.path, res);
    })
  );

  // ============================================================
  // Create HTTP Server
  // ============================================================

  const httpServer = createServer(app);
  return httpServer;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Normalize multer files from request
 * Supports both "images" (array) and "image" (single) fields
 */
function normalizeFiles(
  files:
    | { [fieldname: string]: Express.Multer.File[] }
    | Express.Multer.File[]
    | undefined
): Express.Multer.File[] {
  if (!files) return [];

  // Handle array of files (single field upload)
  if (Array.isArray(files)) {
    return files;
  }

  // Handle object with multiple fields
  // Prefer "images" array if present (new multi-image flow)
  if (files.images && files.images.length > 0) {
    return files.images;
  }

  // Fallback to "image" field (legacy single-image flow)
  if (files.image && files.image.length > 0) {
    return files.image;
  }

  return [];
}
