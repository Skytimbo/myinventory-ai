import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzeImage } from "./openai";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import multer from "multer";
import { randomUUID } from "crypto";
import { wrap, ApiError } from "./errors";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();

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

    // Convert image to base64 for AI analysis
    const imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    // Analyze image with AI
    const analysis = await analyzeImage(imageBase64);

    // Upload image to object storage
    const privateObjectDir = objectStorageService.getPrivateObjectDir();
    const objectId = randomUUID();
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

    const imageUrl = `/objects/items/${objectId}.jpg`;

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

  // Get object storage upload URL
  app.post("/api/objects/upload", wrap(async (req, res) => {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    res.json({ uploadURL });
  }));

  // Serve objects (images)
  app.get("/objects/:objectPath(*)", wrap(async (req, res) => {
    const objectFile = await objectStorageService.getObjectEntityFile(req.path);
    objectStorageService.downloadObject(objectFile, res);
  }));

  const httpServer = createServer(app);

  return httpServer;
}
