import express from "express";
import session from "express-session";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InventoryItem } from "@shared/schema";
import { InvalidPhotoError, PhotoService, sha256 } from "../photoService";
import { registerRoutes } from "../routes";
import { createTestServices, FakeDatabaseStorage, FakeObjectStorageService, type AppConfig } from "../services";

const JPEG = (marker: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, marker]), Buffer.alloc(64, marker)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

function legacyItem(id: string, imageUrls: string[] | null, imageUrl: string): InventoryItem {
  return {
    id, name: `Legacy ${id}`, description: "", category: "Other", tags: [], imageUrl, imageUrls,
    barcodeData: `INV-${id}`, estimatedValue: null, valueConfidence: null, valueRationale: null, location: null,
    analysisMetadata: null, identification: null, valuation: null, notes: null, userAssertions: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("PhotoService", () => {
  let storage: FakeDatabaseStorage;
  let objects: FakeObjectStorageService;
  let photos: PhotoService;

  beforeEach(() => {
    storage = new FakeDatabaseStorage();
    objects = new FakeObjectStorageService();
    photos = new PhotoService(storage, objects);
  });

  describe("ingest", () => {
    it("stores each photo by its own id with original bytes, hash, size, type, name, and source", async () => {
      const bytes = JPEG(1);
      const [photo] = await photos.ingest([{ buffer: bytes, originalFilename: "IMG_0001.JPG" }], {
        batchId: null,
        source: "batch_upload",
      });

      expect(photo.objectPath).toBe(`/objects/photos/${photo.id}.jpg`);
      expect(photo).toMatchObject({
        sha256: sha256(bytes),
        bytes: bytes.length,
        mimeType: "image/jpeg",
        originalFilename: "IMG_0001.JPG",
        source: "batch_upload",
      });
      expect(await objects.read(photo.objectPath)).toEqual(bytes);
    });

    it("detects the type from the bytes, not the filename", async () => {
      const [photo] = await photos.ingest([{ buffer: PNG, originalFilename: "looks-like.jpg" }], {
        batchId: null,
        source: "batch_upload",
      });

      expect(photo.mimeType).toBe("image/png");
      expect(photo.objectPath).toMatch(/\.png$/);
    });

    it("rejects the whole set, saving nothing, if any file is not a supported image", async () => {
      await expect(
        photos.ingest(
          [{ buffer: JPEG(1), originalFilename: "ok.jpg" }, { buffer: Buffer.from("not an image at all"), originalFilename: "notes.txt" }],
          { batchId: null, source: "batch_upload" }
        )
      ).rejects.toBeInstanceOf(InvalidPhotoError);

      expect((await storage.getEvidenceSnapshot()).photos).toHaveLength(0);
    });

    it("keeps identical uploads as separate evidence records with the same hash", async () => {
      const bytes = JPEG(2);
      const [a, b] = await photos.ingest([{ buffer: bytes }, { buffer: bytes }], { batchId: null, source: "batch_upload" });

      expect(a.id).not.toBe(b.id);
      expect(a.sha256).toBe(b.sha256);
    });
  });

  describe("relationships", () => {
    it("lets one photo support several items, and keeps it when an item is deleted", async () => {
      const [photo] = await photos.ingest([{ buffer: JPEG(3) }], { batchId: null, source: "batch_upload" });
      storage.seed([legacyItem("a", [photo.objectPath], photo.objectPath), legacyItem("b", [photo.objectPath], photo.objectPath)]);
      await storage.linkPhotos("a", [photo.id], "2026-10-25T00:00:00.000Z");
      await storage.linkPhotos("b", [photo.id], "2026-10-25T00:00:00.000Z");

      expect((await photos.listPhotos()).find((p) => p.id === photo.id)?.itemIds.sort()).toEqual(["a", "b"]);

      await storage.deleteItem("a");

      const after = await storage.getEvidenceSnapshot();
      expect(after.photos.map((p) => p.id)).toContain(photo.id);
      expect(after.itemPhotos).toEqual([expect.objectContaining({ itemId: "b", photoId: photo.id })]);
      expect(await objects.read(photo.objectPath)).toBeTruthy();
    });

    it("lists unassigned photos with their batch and session context", async () => {
      const session = await storage.createCaptureSession({ title: "Garage sweep", createdAt: "2026-10-25T00:00:00.000Z" });
      const batch = await storage.createCaptureBatch({
        sessionId: session.id,
        context: { location: "Garage", container: "Blue bin", purpose: "declutter" },
        createdAt: "2026-10-25T00:00:00.000Z",
      });
      const [used, unsorted] = await photos.ingest([{ buffer: JPEG(4) }, { buffer: JPEG(5) }], { batchId: batch.id, source: "batch_upload" });
      storage.seed([legacyItem("c", [used.objectPath], used.objectPath)]);
      await storage.linkPhotos("c", [used.id], "2026-10-25T00:00:00.000Z");

      const list = await photos.listPhotos({ unassigned: true });

      expect(list.map((p) => p.id)).toEqual([unsorted.id]);
      expect(list[0]).toMatchObject({
        itemIds: [],
        sessionId: session.id,
        sessionTitle: "Garage sweep",
        context: { location: "Garage", container: "Blue bin", purpose: "declutter" },
      });
    });

    it("refuses a batch for a session that does not exist", async () => {
      await expect(
        storage.createCaptureBatch({ sessionId: "missing", context: {}, createdAt: "2026-10-25T00:00:00.000Z" })
      ).rejects.toThrow();
    });
  });

  describe("registerExistingItemPhotos", () => {
    it("registers existing item photos in place, in order, without changing paths or bytes", async () => {
      const single = JPEG(6);
      const first = JPEG(7);
      const second = PNG;
      await objects.save("items/single.jpg", single);
      await objects.save("items/multi/0.jpg", first);
      await objects.save("items/multi/1.png", second);
      storage.seed([
        legacyItem("single", null, "/objects/items/single.jpg"),
        legacyItem("multi", ["/objects/items/multi/0.jpg", "/objects/items/multi/1.png"], "/objects/items/multi/0.jpg"),
      ]);

      const result = await photos.registerExistingItemPhotos();
      const snapshot = await storage.getEvidenceSnapshot();
      const byPath = new Map(snapshot.photos.map((p) => [p.objectPath, p]));

      expect(result).toEqual({ registered: 3, linked: 3, alreadyRegistered: 0, missing: [] });
      expect(byPath.get("/objects/items/single.jpg")).toMatchObject({ sha256: sha256(single), source: "legacy_registration", batchId: null });
      expect(byPath.get("/objects/items/multi/1.png")).toMatchObject({ sha256: sha256(second), mimeType: "image/png" });
      expect(
        snapshot.itemPhotos.filter((l) => l.itemId === "multi").map((l) => snapshot.photos.find((p) => p.id === l.photoId)?.objectPath)
      ).toEqual(["/objects/items/multi/0.jpg", "/objects/items/multi/1.png"]);
      expect(await objects.read("/objects/items/multi/0.jpg")).toEqual(first);
      expect((await storage.getItem("multi"))?.imageUrls).toEqual(["/objects/items/multi/0.jpg", "/objects/items/multi/1.png"]);
    });

    it("is idempotent", async () => {
      await objects.save("items/x.jpg", JPEG(8));
      storage.seed([legacyItem("x", null, "/objects/items/x.jpg")]);
      await photos.registerExistingItemPhotos();

      expect(await photos.registerExistingItemPhotos()).toEqual({ registered: 0, linked: 0, alreadyRegistered: 1, missing: [] });
      expect((await storage.getEvidenceSnapshot()).photos).toHaveLength(1);
    });

    it("reports missing files instead of failing", async () => {
      await objects.save("items/present.jpg", JPEG(9));
      storage.seed([
        legacyItem("present", null, "/objects/items/present.jpg"),
        legacyItem("gone", null, "/objects/items/gone.jpg"),
      ]);

      expect(await photos.registerExistingItemPhotos()).toEqual({
        registered: 1,
        linked: 1,
        alreadyRegistered: 0,
        missing: ["/objects/items/gone.jpg"],
      });
    });
  });
});

describe("POST /api/photos/register-existing", () => {
  const original = process.env.INVENTORY_PASSWORD;
  afterEach(() => {
    if (original === undefined) delete process.env.INVENTORY_PASSWORD;
    else process.env.INVENTORY_PASSWORD = original;
  });

  it("requires sign-in and returns counts", async () => {
    process.env.INVENTORY_PASSWORD = "pw";
    const app = express();
    app.use(express.json());
    app.use(session({ secret: "t", resave: false, saveUninitialized: false }));
    const services = await createTestServices({} as AppConfig);
    await registerRoutes(app, services);

    await request(app).post("/api/photos/register-existing").expect(401);

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "pw" }).expect(200);
    const response = await agent.post("/api/photos/register-existing").expect(200);
    expect(response.body).toEqual({ registered: 0, linked: 0, alreadyRegistered: 0, missing: [] });
  });
});
