import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzeImage } from "./openai";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import multer from "multer";
import { randomUUID } from "crypto";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();

  // Get all inventory items
  app.get("/api/items", async (req, res) => {
    try {
      const items = await storage.getItems();
      res.json(items);
    } catch (error) {
      console.error("Error fetching items:", error);
      res.status(500).json({ error: "Failed to fetch items" });
    }
  });

  // Get single inventory item
  app.get("/api/items/:id", async (req, res) => {
    try {
      const item = await storage.getItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error fetching item:", error);
      res.status(500).json({ error: "Failed to fetch item" });
    }
  });

  // Create new inventory item with image analysis
  app.post("/api/items", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image provided" });
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
    } catch (error) {
      console.error("Error creating item:", error);
      res.status(500).json({ error: "Failed to create item" });
    }
  });

  // Delete inventory item
  app.delete("/api/items/:id", async (req, res) => {
    try {
      const success = await storage.deleteItem(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Item not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting item:", error);
      res.status(500).json({ error: "Failed to delete item" });
    }
  });

  // Get object storage upload URL
  app.post("/api/objects/upload", async (req, res) => {
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Serve objects (images)
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
