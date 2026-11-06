import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Stream } from "stream";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import session from "express-session";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractTarGz, readJsonFile, type BackupManifest } from "../../scripts/backup-utils";
import { verifyBackupArchive } from "../../scripts/restore-verify-archive";
import { ApiError } from "../errors";
import { registerRoutes } from "../routes";
import {
  createTestServices,
  type AppConfig,
  type FakeDatabaseStorage,
  type FakeObjectStorageService,
} from "../services";
import type { InventoryItem } from "@shared/schema";

const TEST_PASSWORD = "test-password";
const tempDirs: string[] = [];

describe("GET /api/backup", () => {
  let originalInventoryPassword: string | undefined;
  let originalAppUrl: string | undefined;

  beforeEach(() => {
    originalInventoryPassword = process.env.INVENTORY_PASSWORD;
    originalAppUrl = process.env.APP_URL;
    process.env.INVENTORY_PASSWORD = TEST_PASSWORD;
    process.env.APP_URL = "http://test.local";
  });

  afterEach(() => {
    restoreEnv("INVENTORY_PASSWORD", originalInventoryPassword);
    restoreEnv("APP_URL", originalAppUrl);
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
  });

  it("requires authentication", async () => {
    const { app } = await createBackupTestApp();

    const response = await request(app).get("/api/backup").expect(401);

    expect(response.body).toEqual({
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
  });

  it("returns a JSON error before streaming when a referenced image is missing", async () => {
    const { app, storage } = await createBackupTestApp();
    const item = createInventoryItem({
      id: "11111111-1111-4111-8111-111111111111",
      imageUrl: "/objects/items/missing.jpg",
    });
    storage.seed([item]);

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: TEST_PASSWORD }).expect(200);

    const response = await agent.get("/api/backup").expect(500);

    expect(response.headers["content-disposition"]).toBeUndefined();
    expect(response.body).toMatchObject({
      code: "BACKUP_INCOMPLETE",
    });
    expect(response.body.error).toContain("/objects/items/missing.jpg");
  });

  it("streams a valid backup archive for a logged-in user", async () => {
    const { app, storage, objectStorage } = await createBackupTestApp();
    const image = Buffer.from("canonical image bytes");
    const imageHash = createHash("sha256").update(image).digest("hex");
    const item = createInventoryItem({
      id: "22222222-2222-4222-8222-222222222222",
      imageUrl: "/objects/items/stream.jpg",
      analysisMetadata: { imageHash },
    });
    storage.seed([item]);
    await objectStorage.save("items/stream.jpg", image);

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: TEST_PASSWORD }).expect(200);

    const response = await agent
      .get("/api/backup")
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect("Content-Type", /application\/gzip/);

    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="myinventory-backup-.+\.tar\.gz"$/
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "backup-endpoint-test-"));
    try {
      const archivePath = path.join(tempDir, "backup.tar.gz");
      const extractDir = path.join(tempDir, "extract");
      await fs.mkdir(extractDir);
      await fs.writeFile(archivePath, response.body);
      await extractTarGz(archivePath, extractDir);

      const manifest = await readJsonFile<BackupManifest>(
        path.join(extractDir, "manifest.json")
      );
      const inventory = await readJsonFile<{ items: InventoryItem[] }>(
        path.join(extractDir, "inventory.json")
      );
      const restoredImage = await fs.readFile(
        path.join(extractDir, "images", "items", "stream.jpg")
      );

      expect(manifest.itemCount).toBe(1);
      expect(manifest.downloadedImageCount).toBe(1);
      expect(manifest.missingImageReferences).toEqual([]);
      expect(manifest.images[0]).toMatchObject({
        objectPath: "/objects/items/stream.jpg",
        archivePath: "images/items/stream.jpg",
        sha256: imageHash,
        bytes: image.length,
      });
      expect(inventory.items[0].name).toBe("Ceramic Mug");
      expect(restoredImage.equals(image)).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("produces an archive that passes restore verification", async () => {
    const { app, storage, objectStorage } = await createBackupTestApp();
    const primary = Buffer.from("synthetic primary image bytes");
    const secondary = Buffer.alloc(1300, 7);
    const single = Buffer.from("synthetic single image");
    storage.seed([
      createInventoryItem({
        id: "33333333-3333-4333-8333-333333333333",
        imageUrl: "/objects/items/multi/0.jpg",
        imageUrls: ["/objects/items/multi/0.jpg", "/objects/items/multi/1.jpg"],
        analysisMetadata: { imageHash: sha256(primary) },
      }),
      createInventoryItem({
        id: "44444444-4444-4444-8444-444444444444",
        name: "Desk Lamp",
        imageUrl: "/objects/items/single.png",
      }),
    ]);
    await objectStorage.save("items/multi/0.jpg", primary);
    await objectStorage.save("items/multi/1.jpg", secondary);
    await objectStorage.save("items/single.png", single);

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: TEST_PASSWORD }).expect(200);
    const response = await agent
      .get("/api/backup")
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    const tempDir = await makeTempDir("backup-restore-test-");
    const archivePath = path.join(tempDir, "backup.tar.gz");
    const restoreUploadsDir = path.join(tempDir, "restored-uploads");
    await fs.writeFile(archivePath, response.body);

    const { manifest, items } = await verifyBackupArchive({ archivePath, restoreUploadsDir });

    expect(manifest.itemCount).toBe(2);
    expect(manifest.downloadedImageCount).toBe(3);
    expect(items.map((item) => item.id).sort()).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ]);
    expect(await fs.readFile(path.join(restoreUploadsDir, "items", "multi", "1.jpg"))).toEqual(
      secondary
    );
    expect(await fs.readFile(path.join(restoreUploadsDir, "items", "single.png"))).toEqual(single);
  });

  it("keeps the whole captured collection through edit, re-identify, backup, and restore", async () => {
    const { app } = await createBackupTestApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: TEST_PASSWORD }).expect(200);
    const jpeg = (marker: number) =>
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, marker]), Buffer.alloc(200, marker)]);
    const originals = [jpeg(1), jpeg(2), jpeg(3), jpeg(4)];

    // 1–2. Upload several photos with batch context
    const session = (await agent.post("/api/capture-sessions").send({ title: "Garage sweep" }).expect(201)).body;
    let upload = agent.post(`/api/capture-sessions/${session.id}/batches`);
    originals.forEach((bytes, index) => (upload = upload.attach("photos", bytes, `IMG_${index}.jpg`)));
    const { photos } = (await upload.field("location", "Garage").field("container", "Blue bin").expect(201)).body;

    // 3. Several entries: one from two photos (identified), one from one photo; one photo left unsorted
    const drill = (
      await agent.post("/api/items/from-photos").send({ photoIds: [photos[0].id, photos[1].id], identify: true }).expect(201)
    ).body;
    const lamp = (await agent.post("/api/items/from-photos").send({ photoIds: [photos[2].id], name: "Desk lamp" }).expect(201)).body;

    // 4. Correct one identity, confirm the other details
    await agent.patch(`/api/items/${drill.id}`).send({ fields: { name: "Dad's drill", notes: "Lent to Sam" } }).expect(200);
    await agent.patch(`/api/items/${drill.id}`).send({ confirm: ["description", "tags"] }).expect(200);

    // 5. Re-identify without losing confirmations
    const reidentified = (await agent.post(`/api/items/${drill.id}/identify`).expect(200)).body;
    expect(reidentified).toMatchObject({ name: "Dad's drill", notes: "Lent to Sam", location: "Garage › Blue bin" });
    expect(reidentified.identification.suggestions).toMatchObject({ name: "Test Item" });

    // 6. Retrieve the original photographs, byte for byte
    for (const [index, photo] of photos.entries()) {
      const served = await agent.get(photo.objectPath).buffer(true).parse(binaryParser).expect(200);
      expect(served.body).toEqual(originals[index]);
    }

    // 7. Back up and restore the entire collection
    const backup = await agent.get("/api/backup").buffer(true).parse(binaryParser).expect(200);
    const tempDir = await makeTempDir("backup-workflow-test-");
    const archivePath = path.join(tempDir, "backup.tar.gz");
    const restoreUploadsDir = path.join(tempDir, "restored-uploads");
    await fs.writeFile(archivePath, backup.body);

    const restored = await verifyBackupArchive({ archivePath, restoreUploadsDir });

    expect(restored.manifest).toMatchObject({ itemCount: 2, photoCount: 4, unassignedPhotoCount: 1, downloadedImageCount: 4 });
    expect(restored.evidence.captureSessions).toEqual([expect.objectContaining({ id: session.id, title: "Garage sweep" })]);
    expect(restored.evidence.captureBatches[0].context).toEqual({ location: "Garage", container: "Blue bin" });
    expect(restored.evidence.itemPhotos.map((link) => [link.itemId, link.photoId, link.position]).sort()).toEqual(
      [
        [drill.id, photos[0].id, 0],
        [drill.id, photos[1].id, 1],
        [lamp.id, photos[2].id, 0],
      ].sort()
    );
    const restoredDrill = restored.items.find((item) => item.id === drill.id)!;
    expect(restoredDrill).toMatchObject({ name: "Dad's drill", notes: "Lent to Sam" });
    expect(Object.fromEntries(Object.entries(restoredDrill.userAssertions ?? {}).map(([field, a]) => [field, a?.source]))).toEqual({
      name: "user",
      notes: "user",
      description: "user",
      tags: "user",
      location: "batch_context",
    });
    expect(restoredDrill.identification?.suggestions).toMatchObject({ name: "Test Item" });
    for (const [index, photo] of photos.entries()) {
      const file = await fs.readFile(path.join(restoreUploadsDir, ...photo.objectPath.replace("/objects/", "").split("/")));
      expect(file).toEqual(originals[index]);
    }
  });

  it("rate limits repeated backup requests", async () => {
    const { app } = await createBackupTestApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: TEST_PASSWORD }).expect(200);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await agent.get("/api/backup").buffer(true).parse(binaryParser).expect(200);
    }

    const response = await agent.get("/api/backup").expect(429);
    expect(response.body.code).toBe("BACKUP_RATE_LIMITED");
  });
});

async function createBackupTestApp(): Promise<{
  app: Express;
  storage: FakeDatabaseStorage;
  objectStorage: FakeObjectStorageService;
}> {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-session-secret",
      resave: false,
      saveUninitialized: false,
    })
  );

  const services = await createTestServices(createTestConfig());
  const objectStorage = services.objectStorage as FakeObjectStorageService;
  objectStorage.setLocalStorageDir(await makeTempDir("backup-endpoint-uploads-"));
  await registerRoutes(app, services);
  app.use(errorMiddleware);

  return {
    app,
    storage: services.storage as FakeDatabaseStorage,
    objectStorage,
  };
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function createTestConfig(): AppConfig {
  return {
    databaseUrl: "postgres://test",
    openaiApiKey: "test",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiProjectId: undefined,
    nodeEnv: "test",
    port: 0,
    localStorageDir: path.join(os.tmpdir(), "myinventory-test-uploads"),
    analyzerProvider: "mock",
  };
}

function createInventoryItem(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    name: "Ceramic Mug",
    description: "White ceramic coffee mug",
    category: "Kitchen",
    tags: ["kitchen", "mug"],
    imageUrl: "/objects/items/default.jpg",
    imageUrls: null,
    barcodeData: "INV-TEST",
    estimatedValue: "8.00",
    valueConfidence: "medium",
    valueRationale: "Comparable household mug",
    location: "Kitchen",
    analysisMetadata: null,
    identification: null,
    valuation: null,
    notes: null,
    userAssertions: null,
    createdAt: "2026-06-13T00:00:00.000Z",
    ...overrides,
  };
}

function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
    });
  }

  return res.status(500).json({
    error: err instanceof Error ? err.message : "Internal Server Error",
    code: "UNHANDLED",
  });
}

function binaryParser(
  res: Stream,
  callback: (error: Error | null, body: unknown) => void
) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
  res.on("error", callback);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
