import express, { type Express, type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../errors";
import { registerRoutes } from "../routes";
import { createTestServices, type AppConfig, type FakeAnalyzer, type FakeDatabaseStorage } from "../services";

const PASSWORD = "capture-test";
const jpeg = (marker: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, marker]), Buffer.alloc(80, marker)]);

async function createApp(): Promise<{ app: Express; storage: FakeDatabaseStorage; analyzer: FakeAnalyzer }> {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "t", resave: false, saveUninitialized: false }));
  const services = await createTestServices({} as AppConfig);
  await registerRoutes(app, services);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: "Internal Server Error", code: "UNHANDLED" });
  });
  return { app, storage: services.storage as FakeDatabaseStorage, analyzer: services.analyzer as FakeAnalyzer };
}

async function login(app: Express) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: PASSWORD }).expect(200);
  return agent;
}

function uploadBatch(
  agent: ReturnType<typeof request.agent>,
  sessionId: string,
  markers: number[],
  context: Record<string, string> = {}
): request.Test {
  let req = agent.post(`/api/capture-sessions/${sessionId}/batches`);
  markers.forEach((marker, index) => (req = req.attach("photos", jpeg(marker), `IMG_${index}.jpg`)));
  Object.entries(context).forEach(([key, value]) => (req = req.field(key, value)));
  return req;
}

describe("batch capture", () => {
  const original = process.env.INVENTORY_PASSWORD;
  beforeEach(() => {
    process.env.INVENTORY_PASSWORD = PASSWORD;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    if (original === undefined) delete process.env.INVENTORY_PASSWORD;
    else process.env.INVENTORY_PASSWORD = original;
    vi.restoreAllMocks();
  });

  it.each([
    ["get", "/api/capture-sessions"],
    ["post", "/api/capture-sessions"],
    ["post", "/api/capture-sessions/x/batches"],
    ["get", "/api/photos"],
    ["post", "/api/items/from-photos"],
  ])("requires sign-in: %s %s", async (method, path) => {
    const { app } = await createApp();
    await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path).expect(401);
  });

  it("uploads many photos with context into a session without running AI or creating items", async () => {
    const { app, storage, analyzer } = await createApp();
    const identify = vi.spyOn(analyzer, "identify");
    const agent = await login(app);

    const session = (await agent.post("/api/capture-sessions").send({ title: "Garage sweep" }).expect(201)).body;
    const first = await uploadBatch(agent, session.id, [1, 2, 3], {
      location: "Garage",
      container: "Blue bin",
      category: "Tools",
      purpose: "declutter",
    }).expect(201);
    await uploadBatch(agent, session.id, [4]).expect(201); // a session can receive several batches

    expect(first.body.batch.context).toEqual({ location: "Garage", container: "Blue bin", category: "Tools", purpose: "declutter" });
    expect(first.body.photos).toHaveLength(3);
    expect(identify).not.toHaveBeenCalled();
    expect(await storage.getItems()).toHaveLength(0);

    const unsorted = (await agent.get("/api/photos?unassigned=true").expect(200)).body;
    expect(unsorted).toHaveLength(4);
    expect(unsorted.find((p: { batchId: string }) => p.batchId === first.body.batch.id)).toMatchObject({
      sessionTitle: "Garage sweep",
      originalFilename: "IMG_0.jpg",
      source: "batch_upload",
    });

    const sessions = (await agent.get("/api/capture-sessions").expect(200)).body;
    expect(sessions[0]).toMatchObject({ title: "Garage sweep", batchCount: 2, photoCount: 4, unassignedCount: 4 });
  });

  it("gives a new session a default title", async () => {
    const { app } = await createApp();
    const agent = await login(app);

    const session = (await agent.post("/api/capture-sessions").send({}).expect(201)).body;

    expect(session.title).toMatch(/^Capture \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it.each([
    ["an unknown session", "00000000-0000-4000-8000-000000000000", [1], 404, "NOT_FOUND"],
    ["no photos", null, [], 400, "NO_PHOTOS"],
    ["too many photos", null, Array.from({ length: 26 }, (_, i) => i), 400, "TOO_MANY_PHOTOS"],
  ])("rejects a batch with %s", async (_label, sessionOverride, markers, status, code) => {
    const { app } = await createApp();
    const agent = await login(app);
    const session = (await agent.post("/api/capture-sessions").send({}).expect(201)).body;

    const response = await uploadBatch(agent, (sessionOverride as string | null) ?? session.id, markers as number[]).expect(status as number);

    expect(response.body.code).toBe(code);
  });

  it("rejects a batch containing a non-image, storing nothing", async () => {
    const { app, storage } = await createApp();
    const agent = await login(app);
    const session = (await agent.post("/api/capture-sessions").send({}).expect(201)).body;

    const response = await agent
      .post(`/api/capture-sessions/${session.id}/batches`)
      .attach("photos", jpeg(1), "ok.jpg")
      .attach("photos", Buffer.from("plain text, not an image"), "notes.txt")
      .expect(400);

    expect(response.body.code).toBe("INVALID_FILE_TYPE");
    const snapshot = await storage.getEvidenceSnapshot();
    expect(snapshot.photos).toHaveLength(0);
    expect(snapshot.batches).toHaveLength(0);
  });

  describe("creating items from photos", () => {
    async function capturedPhotos(context: Record<string, string> = {}) {
      const setup = await createApp();
      const agent = await login(setup.app);
      const session = (await agent.post("/api/capture-sessions").send({}).expect(201)).body;
      const { photos } = (await uploadBatch(agent, session.id, [1, 2, 3], context).expect(201)).body;
      return { ...setup, agent, photos: photos as Array<{ id: string; objectPath: string }> };
    }

    it("creates an unidentified entry linked to the selected photos, with batch context as assertions", async () => {
      const { agent, photos } = await capturedPhotos({ location: "Garage", container: "Blue bin", category: "Tools", purpose: "declutter" });

      const item = (await agent.post("/api/items/from-photos").send({ photoIds: [photos[1].id, photos[0].id] }).expect(201)).body;

      expect(item).toMatchObject({
        name: "Untitled Item",
        category: "Tools",
        location: "Garage › Blue bin",
        notes: "Purpose: declutter",
        imageUrls: [photos[1].objectPath, photos[0].objectPath],
        identification: null,
        valuation: null,
      });
      expect(item.analysisMetadata.model).toBe("none");
      expect(item.userAssertions).toEqual({
        category: { source: "batch_context", assertedAt: expect.any(String) },
        location: { source: "batch_context", assertedAt: expect.any(String) },
        notes: { source: "batch_context", assertedAt: expect.any(String) },
      });

      const unsorted = (await agent.get("/api/photos?unassigned=true").expect(200)).body;
      expect(unsorted.map((p: { id: string }) => p.id)).toEqual([photos[2].id]);
    });

    it("lets one photo support several entries", async () => {
      const { agent, photos } = await capturedPhotos();

      const a = (await agent.post("/api/items/from-photos").send({ photoIds: [photos[0].id], name: "Socket set" }).expect(201)).body;
      const b = (await agent.post("/api/items/from-photos").send({ photoIds: [photos[0].id], name: "Tool bag" }).expect(201)).body;

      const all = (await agent.get("/api/photos").expect(200)).body;
      expect(all.find((p: { id: string }) => p.id === photos[0].id).itemIds.sort()).toEqual([a.id, b.id].sort());
      expect(a.userAssertions.name.source).toBe("user");
    });

    it("identifies on request without overwriting asserted fields, keeping AI suggestions", async () => {
      const { agent, photos } = await capturedPhotos({ category: "Tools" });

      const item = (
        await agent.post("/api/items/from-photos").send({ photoIds: [photos[0].id], name: "Dad's drill", identify: true }).expect(201)
      ).body;

      expect(item.name).toBe("Dad's drill"); // user assertion kept
      expect(item.category).toBe("Tools"); // batch-context assertion kept
      expect(item.description).toBe("Test description"); // unasserted field filled by AI
      expect(item.identification.suggestions).toEqual({ name: "Test Item", category: "Test" });
    });

    it("still creates the entry when AI identification fails", async () => {
      const { agent, analyzer, photos } = await capturedPhotos();
      vi.spyOn(analyzer, "identify").mockRejectedValueOnce(new Error("upstream down"));

      const item = (await agent.post("/api/items/from-photos").send({ photoIds: [photos[0].id], identify: true }).expect(201)).body;

      expect(item.name).toBe("Untitled Item");
      expect(item._aiWarning).toContain("AI identification unavailable");
    });

    it.each([
      ["no photos", { photoIds: [] }, 400],
      ["a malformed id", { photoIds: ["nope"] }, 400],
      ["too many photos", { photoIds: Array.from({ length: 11 }, () => "00000000-0000-4000-8000-000000000000") }, 400],
      ["an unknown photo", { photoIds: ["00000000-0000-4000-8000-000000000000"] }, 404],
    ])("rejects %s", async (_label, body, status) => {
      const { agent } = await capturedPhotos();

      await agent.post("/api/items/from-photos").send(body).expect(status);
    });
  });
});

describe("PATCH /api/items/:id", () => {
  const original = process.env.INVENTORY_PASSWORD;
  beforeEach(() => {
    process.env.INVENTORY_PASSWORD = PASSWORD;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.INVENTORY_PASSWORD;
    else process.env.INVENTORY_PASSWORD = original;
  });

  async function withItem() {
    const setup = await createApp();
    const agent = await login(setup.app);
    const session = (await agent.post("/api/capture-sessions").send({}).expect(201)).body;
    const { photos } = (await uploadBatch(agent, session.id, [1]).expect(201)).body;
    const item = (await agent.post("/api/items/from-photos").send({ photoIds: [photos[0].id] }).expect(201)).body;
    return { ...setup, agent, item };
  }

  it("requires sign-in", async () => {
    const { app } = await createApp();
    await request(app).patch("/api/items/x").send({ confirm: ["name"] }).expect(401);
  });

  it("saves edits with normalized tags and empty optional text as null", async () => {
    const { agent, item } = await withItem();

    const edited = (
      await agent
        .patch(`/api/items/${item.id}`)
        .send({ fields: { name: "  Socket set ", tags: ["Tools", "tools", " Metric "], location: "  ", notes: "Garage shelf" } })
        .expect(200)
    ).body;

    expect(edited).toMatchObject({ name: "Socket set", tags: ["tools", "metric"], location: null, notes: "Garage shelf" });
    expect(Object.keys(edited.userAssertions).sort()).toEqual(["location", "name", "notes", "tags"]);
  });

  it.each([
    ["an empty name", { fields: { name: "  " } }],
    ["an unknown field", { fields: { barcodeData: "X" } }],
    ["an unknown confirmation", { confirm: ["barcodeData"] }],
    ["an unknown top-level key", { valuation: null }],
  ])("rejects %s", async (_label, body) => {
    const { agent, item } = await withItem();

    const response = await agent.patch(`/api/items/${item.id}`).send(body).expect(400);

    expect(response.body.code).toBe("INVALID_EDIT");
  });

  it("returns 404 for an unknown item and 409 when there is no suggestion to accept", async () => {
    const { agent, item } = await withItem();

    await agent.patch("/api/items/00000000-0000-4000-8000-000000000000").send({ confirm: ["name"] }).expect(404);
    const response = await agent.patch(`/api/items/${item.id}`).send({ acceptSuggestions: ["name"] }).expect(409);
    expect(response.body.code).toBe("NO_SUGGESTION");
  });
});
