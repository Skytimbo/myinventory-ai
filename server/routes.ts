import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzeImage } from "./openai";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import multer from "multer";
import { randomUUID } from "crypto";
import { wrap, ApiError } from "./errors";
import { validateUploadedFile } from "./fileValidation";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10485760 } // 10MB limit
});

// Check if running on Replit or locally
const isReplit = process.env.REPL_ID !== undefined;

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();

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

  // Create new inventory item with image analysis
  app.post("/api/items", upload.single("image"), wrap(async (req, res) => {
    if (!req.file) {
      throw new ApiError(400, 'NO_IMAGE', 'No image provided');
    }

    // Validate file type using both mimetype and magic-number sniffing
    const validation = validateUploadedFile(req.file);
    if (!validation.valid) {
      throw new ApiError(400, 'INVALID_FILE_TYPE', validation.error || 'Invalid file type');
    }

    // Convert image to base64 for AI analysis
    const imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    // Analyze image with AI
    const analysis = await analyzeImage(imageBase64);

    // Save image to storage (local filesystem or Replit object storage)
    const objectId = randomUUID();
    const imageUrl = `/objects/items/${objectId}.jpg`;

    try {
      if (isReplit) {
        // Use Replit object storage
        const privateObjectDir = objectStorageService.getPrivateObjectDir();
        const fullPath = `${privateObjectDir}/items/${objectId}.jpg`;

        const pathParts = fullPath.split("/");
        const bucketName = pathParts[1];
        const objectName = pathParts.slice(2).join("/");

        const bucket = await import("./objectStorage").then(m => m.objectStorageClient.bucket(bucketName));
        const file = bucket.file(objectName);

        await file.save(req.file.buffer, {
          contentType: req.file.mimetype,
          metadata: {
            metadata: {
              "custom:aclPolicy": JSON.stringify({
                owner: "system",
                visibility: "public"
              })
            }
          }
        });
      } else {
        // Use local filesystem storage
        await objectStorageService.saveLocalFile(`items/${objectId}.jpg`, req.file.buffer);
      }
    } catch (error) {
      console.error('Storage error:', error);
      throw new ApiError(500, 'STORAGE_ERROR', 'Failed to save image');
    }

    // Generate barcode data (using item ID)
    const barcodeData = `INV-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Create inventory item
    const item = await storage.createItem({
      name: analysis.name,
      description: analysis.description,
      category: analysis.category,
      tags: analysis.tags,
      imageUrl,
      barcodeData,
      estimatedValue: analysis.estimatedValue,
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
    if (isReplit) {
      // Serve from Replit object storage
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } else {
      // Serve from local filesystem
      const localPath = await objectStorageService.getLocalObjectFile(req.path);
      objectStorageService.downloadLocalObject(localPath, res);
    }
  }));

  const httpServer = createServer(app);

  return httpServer;
}
