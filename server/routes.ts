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
import { z } from "zod";
import { InvalidPhotoError, SessionNotFoundError } from "./photoService";
import { wrap, ApiError } from "./errors";
import { validateUploadedFile } from "./fileValidation";
import { openAIHealthCheck } from "./analyzer";
import { getOpenAIEnvHealth } from "./health/openaiHealth";
import {
  collectImageReferences,
  createBackupArchivePlan,
  toBackupInventoryItem,
  writeBackupArchive,
  type BackupImageFile,
} from "./backupArchive";
import type { BackupInventoryItem } from "../scripts/backup-utils";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10485760 }, // 10MB limit
});

/** Batch capture: up to 25 photos per request (clients send larger selections in chunks) */
export const MAX_BATCH_PHOTOS = 25;
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10485760, files: MAX_BATCH_PHOTOS },
});

const createSessionBody = z.object({
  title: z.string().max(120).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const ASSERTABLE = ["name", "description", "category", "tags", "location", "notes"] as const;
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().transform((value) => (value ? value : null));

const editItemBody = z
  .object({
    fields: z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000),
        category: z.string().trim().min(1).max(60),
        tags: z
          .array(z.string().trim().toLowerCase().min(1).max(40))
          .max(20)
          .transform((tags) => Array.from(new Set(tags))),
        location: optionalText(200),
        notes: optionalText(4000),
      })
      .partial()
      .strict()
      .optional(),
    confirm: z.array(z.enum(ASSERTABLE)).max(ASSERTABLE.length).optional(),
    acceptSuggestions: z.array(z.enum(["name", "description", "category", "tags"])).max(4).optional(),
  })
  .strict();

const createFromPhotosBody = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(10),
  name: z.string().max(120).optional(),
  identify: z.boolean().optional(),
});

export async function registerRoutes(
  app: Express,
  services: AppServices
): Promise<Server> {
  const { itemService, objectStorage, photoService } = services;
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
  const backupRateLimit = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    code: "BACKUP_RATE_LIMITED",
    message: "Too many backup requests. Try again later.",
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
  // Backup Endpoint
  // ============================================================

  app.get(
    "/api/backup",
    backupRateLimit,
    wrap(async (req, res) => {
      const items = (await itemService.getItems()).map(toBackupInventoryItem);
      const imageFiles = await resolveLocalBackupImageFiles(items, objectStorage);
      const createdAt = new Date().toISOString();
      const plan = await createBackupArchivePlan({
        items,
        imageFiles,
        sourceAppUrl: getRequestAppUrl(req),
        createdAt,
      });

      res.set({
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${plan.archiveName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });

      try {
        await writeBackupArchive(plan, res);
      } catch (error) {
        if (res.headersSent) {
          console.error("Backup stream error:", error);
          res.destroy(error instanceof Error ? error : undefined);
          return;
        }
        throw error;
      }
    })
  );

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

  // POST /api/items/:id/identify - Identify (or re-identify) an item from its photos.
  // /analyze and /reanalyze are kept as aliases for older clients.
  const identifyHandler = wrap(async (req, res) => {
    try {
      const item = await itemService.identifyItem(req.params.id);
      res.json(item);
    } catch (err: any) {
      if (err.message === "Item not found") {
        throw new ApiError(404, "NOT_FOUND", "Item not found");
      }
      console.error("Identify failed:", err);
      throw new ApiError(
        502,
        "IDENTIFY_FAILED",
        "Identification failed. The item was not changed. Please try again."
      );
    }
  });
  app.post("/api/items/:id/identify", aiRateLimit, identifyHandler);

  // ============================================================
  // Capture evidence (Milestone 1)
  // ============================================================

  // POST /api/photos/register-existing - record photos that existing items
  // reference as evidence, in place (no files moved). Idempotent.
  app.post(
    "/api/photos/register-existing",
    wrap(async (_req, res) => {
      res.json(await photoService.registerExistingItemPhotos());
    })
  );

  // GET /api/capture-sessions - sessions with batch and photo counts
  app.get(
    "/api/capture-sessions",
    wrap(async (_req, res) => {
      res.json(await photoService.listSessions());
    })
  );

  // POST /api/capture-sessions - start a capture session
  app.post(
    "/api/capture-sessions",
    wrap(async (req, res) => {
      const body = createSessionBody.safeParse(req.body ?? {});
      if (!body.success) {
        throw new ApiError(400, "INVALID_SESSION", "Invalid capture session");
      }
      res.status(201).json(await photoService.createSession(body.data));
    })
  );

  // POST /api/capture-sessions/:id/batches - upload photos (field "photos") with
  // optional context fields location, category, container, purpose. No AI runs.
  app.post(
    "/api/capture-sessions/:id/batches",
    batchUpload.array("photos", MAX_BATCH_PHOTOS),
    wrap(async (req, res) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        throw new ApiError(400, "NO_PHOTOS", 'No photos provided. Use the "photos" field.');
      }
      const field = (name: string) => (typeof req.body?.[name] === "string" ? req.body[name] : undefined);
      try {
        const result = await photoService.addBatch(
          req.params.id,
          files.map((file) => ({ buffer: file.buffer, originalFilename: file.originalname })),
          { location: field("location"), category: field("category"), container: field("container"), purpose: field("purpose") }
        );
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof SessionNotFoundError) throw new ApiError(404, "NOT_FOUND", err.message);
        if (err instanceof InvalidPhotoError) throw new ApiError(400, "INVALID_FILE_TYPE", err.message);
        throw err;
      }
    })
  );

  // GET /api/photos?unassigned=true - photo evidence with context and links
  app.get(
    "/api/photos",
    wrap(async (req, res) => {
      res.json(await photoService.listPhotos({ unassigned: req.query.unassigned === "true" }));
    })
  );

  // PATCH /api/items/:id - user edits and one-click confirmations
  app.patch(
    "/api/items/:id",
    wrap(async (req, res) => {
      const body = editItemBody.safeParse(req.body ?? {});
      if (!body.success) {
        throw new ApiError(400, "INVALID_EDIT", body.error.issues[0]?.message ?? "Invalid edit");
      }
      try {
        res.json(await itemService.editItem(req.params.id, body.data));
      } catch (err) {
        if (err instanceof Error && err.message === "Item not found") {
          throw new ApiError(404, "NOT_FOUND", "Item not found");
        }
        if (err instanceof Error && err.message.startsWith("No suggestion for")) {
          throw new ApiError(409, "NO_SUGGESTION", err.message);
        }
        throw err;
      }
    })
  );

  // POST /api/items/from-photos - create an inventory entry from captured photos
  app.post(
    "/api/items/from-photos",
    aiRateLimit,
    wrap(async (req, res) => {
      const body = createFromPhotosBody.safeParse(req.body ?? {});
      if (!body.success) {
        throw new ApiError(400, "INVALID_REQUEST", "Select 1 to 10 photos");
      }
      try {
        const result = await itemService.createItemFromPhotos(body.data);
        res.status(201).json({ ...result.item, _aiWarning: result.aiWarning });
      } catch (err) {
        if (err instanceof Error && err.message === "Photo not found") {
          throw new ApiError(404, "NOT_FOUND", "Photo not found");
        }
        throw err;
      }
    })
  );
  app.post("/api/items/:id/analyze", aiRateLimit, identifyHandler);
  app.post("/api/items/:id/reanalyze", aiRateLimit, identifyHandler);

  // POST /api/items/:id/estimate-value - Estimate resale value (explicit request only)
  app.post(
    "/api/items/:id/estimate-value",
    aiRateLimit,
    wrap(async (req, res) => {
      try {
        const item = await itemService.estimateValue(req.params.id);
        res.json(item);
      } catch (err: any) {
        if (err.message === "Item not found") {
          throw new ApiError(404, "NOT_FOUND", "Item not found");
        }
        if (err.message === "Item not identified") {
          throw new ApiError(409, "NOT_IDENTIFIED", "Identify the item before estimating its value.");
        }
        console.error("Estimate value failed:", err);
        throw new ApiError(
          502,
          "VALUATION_FAILED",
          "Value estimate failed. Existing data was not changed. Please try again."
        );
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
      if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({
          error: `Too many photos in one upload. Send at most ${MAX_BATCH_PHOTOS} at a time.`,
          code: "TOO_MANY_PHOTOS",
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

async function resolveLocalBackupImageFiles(
  items: BackupInventoryItem[],
  objectStorage: AppServices["objectStorage"]
): Promise<BackupImageFile[]> {
  const imageFiles: BackupImageFile[] = [];
  const missingImageReferences: string[] = [];

  for (const reference of collectImageReferences(items)) {
    try {
      const filePath = await objectStorage.getLocalObjectFile(reference.objectPath);
      imageFiles.push({
        objectPath: reference.objectPath,
        filePath,
        itemIds: Array.from(reference.itemIds).sort(),
      });
    } catch {
      missingImageReferences.push(reference.objectPath);
    }
  }

  if (missingImageReferences.length > 0) {
    throw new ApiError(
      500,
      "BACKUP_INCOMPLETE",
      `Backup cannot be created because referenced image file(s) are missing: ${missingImageReferences.join(", ")}`
    );
  }

  return imageFiles;
}

function getRequestAppUrl(req: Request): string {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, "");
  }

  const host = req.get("host") || "localhost";
  return `${req.protocol}://${host}`;
}
