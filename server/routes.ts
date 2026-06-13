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

import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import { timingSafeEqual } from "crypto";
import type { AppServices } from "./services";
import multer from "multer";
import { wrap, ApiError } from "./errors";
import { validateUploadedFile } from "./fileValidation";
import { openAIHealthCheck } from "./analyzer";
import { getOpenAIEnvHealth } from "./health/openaiHealth";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10485760 }, // 10MB limit
});

export async function registerRoutes(
  app: Express,
  services: AppServices
): Promise<Server> {
  const { itemService, objectStorage } = services;
  const auth = createAuthMiddleware();
  const loginRateLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    code: "LOGIN_RATE_LIMITED",
    message: "Too many login attempts. Try again later.",
  });
  const aiRateLimit = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 30,
    code: "AI_RATE_LIMITED",
    message: "Too many AI requests. Try again later.",
  });

  // ============================================================
  // Health Endpoints
  // ============================================================

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ============================================================
  // Auth Endpoints
  // ============================================================

  app.get("/api/auth/status", (req, res) => {
    res.json({
      authenticated: auth.isAuthenticated(req),
      authEnabled: auth.enabled,
    });
  });

  app.post("/api/auth/login", loginRateLimit, (req, res) => {
    if (!auth.enabled) {
      req.session.authenticated = true;
      return res.json({ authenticated: true });
    }

    if (!auth.verifyPassword(req.body?.password)) {
      return res.status(401).json({
        error: "Invalid password",
        code: "INVALID_PASSWORD",
      });
    }

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({
          error: "Unable to create session",
          code: "SESSION_ERROR",
        });
      }

      req.session.authenticated = true;
      res.json({ authenticated: true });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({
          error: "Unable to destroy session",
          code: "SESSION_ERROR",
        });
      }
      res.clearCookie("myinventory.sid");
      res.json({ authenticated: false });
    });
  });

  app.get("/api/health/openai", auth.requireAuth, (req, res) => {
    const health = getOpenAIEnvHealth();
    res.json(health);
  });

  app.get("/api/health/openai/live", auth.requireAuth, async (req, res) => {
    const ai = await openAIHealthCheck(services.openaiCheap);
    res.json({
      ok: true,
      ai,
    });
  });

  app.use("/api", auth.requireAuth);

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
    aiRateLimit,
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
    aiRateLimit,
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

  // POST /api/items/:id/reanalyze - Re-run AI analysis on existing item
  app.post(
    "/api/items/:id/reanalyze",
    aiRateLimit,
    wrap(async (req, res) => {
      try {
        const item = await itemService.analyzeItem(req.params.id);
        res.json(item);
      } catch (err: any) {
        if (err.message === "Item not found") {
          throw new ApiError(404, "NOT_FOUND", "Item not found");
        }
        throw new ApiError(500, "REANALYSIS_FAILED", err.message);
      }
    })
  );

  // ============================================================
  // Object Storage Endpoint
  // ============================================================

  app.get(
    "/objects/:objectPath(*)",
    auth.requireAuth,
    wrap(async (req, res) => {
      await objectStorage.download(req.path, res);
    })
  );

  // ============================================================
  // Multer Error Handler
  // ============================================================

  app.use((error: any, _req: Request, res: Response, next: NextFunction) => {
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
  // Create HTTP Server
  // ============================================================

  const httpServer = createServer(app);
  return httpServer;
}

// ============================================================
// Auth & Rate Limit Helpers
// ============================================================

function createAuthMiddleware() {
  const password = process.env.INVENTORY_PASSWORD || "";
  const enabled = Boolean(password);

  if (process.env.NODE_ENV === "production" && !enabled) {
    throw new Error(
      "INVENTORY_PASSWORD is required in production to protect inventory data."
    );
  }

  function isAuthenticated(req: Request): boolean {
    return !enabled || req.session.authenticated === true;
  }

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (isAuthenticated(req)) {
      return next();
    }

    return res.status(401).json({
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
  }

  function verifyPassword(candidate: unknown): boolean {
    if (typeof candidate !== "string" || candidate.length === 0) {
      return false;
    }
    return safeEqual(candidate, password);
  }

  return {
    enabled,
    isAuthenticated,
    requireAuth,
    verifyPassword,
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  code: string;
  message: string;
}

function createRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (current.count >= options.max) {
      const retryAfter = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: options.message,
        code: options.code,
      });
    }

    current.count += 1;
    return next();
  };
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
