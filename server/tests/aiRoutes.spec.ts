import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import session from "express-session";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "@shared/schema";
import { parseValuation } from "../analyzer";
import { ApiError } from "../errors";
import { registerRoutes } from "../routes";
import {
  createTestServices,
  type AppConfig,
  type FakeAnalyzer,
  type FakeDatabaseStorage,
  type FakeObjectStorageService,
} from "../services";

const TEST_PASSWORD = "test-password";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";

describe("AI routes", () => {
  let originalInventoryPassword: string | undefined;

  beforeEach(() => {
    originalInventoryPassword = process.env.INVENTORY_PASSWORD;
    process.env.INVENTORY_PASSWORD = TEST_PASSWORD;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalInventoryPassword === undefined) {
      delete process.env.INVENTORY_PASSWORD;
    } else {
      process.env.INVENTORY_PASSWORD = originalInventoryPassword;
    }
    vi.restoreAllMocks();
  });

  describe("POST /api/items/:id/identify", () => {
    it("requires authentication", async () => {
      const { app } = await createTestApp();

      await request(app).post(`/api/items/${ITEM_ID}/identify`).expect(401);
    });

    it.each(["identify", "analyze", "reanalyze"])(
      "identifies the item via /%s without setting a value",
      async (action) => {
        const { app, storage, objectStorage } = await createTestApp();
        await seedItem(storage, objectStorage);
        const agent = await login(app);

        const response = await agent.post(`/api/items/${ITEM_ID}/${action}`).expect(200);

        expect(response.body.name).toBe("Test Item");
        expect(response.body.identification.uncertainty).toBe("low");
        expect(response.body.valuation).toBeNull();
        expect(response.body.estimatedValue).toBeNull();
      }
    );

    it("returns 404 for an unknown item", async () => {
      const { app } = await createTestApp();
      const agent = await login(app);

      const response = await agent.post(`/api/items/${ITEM_ID}/identify`).expect(404);

      expect(response.body.code).toBe("NOT_FOUND");
    });

    it("returns IDENTIFY_FAILED and leaves the item unchanged when the AI fails", async () => {
      const { app, storage, objectStorage, analyzer } = await createTestApp();
      await seedItem(storage, objectStorage);
      const before = structuredClone(await storage.getItem(ITEM_ID));
      vi.spyOn(analyzer, "identify").mockRejectedValueOnce(new Error("upstream timeout"));
      const agent = await login(app);

      const response = await agent.post(`/api/items/${ITEM_ID}/identify`).expect(502);

      expect(response.body.code).toBe("IDENTIFY_FAILED");
      expect(response.body.error).not.toContain("upstream timeout");
      expect(await storage.getItem(ITEM_ID)).toEqual(before);
    });
  });

  describe("POST /api/items/:id/estimate-value", () => {
    it("requires authentication", async () => {
      const { app } = await createTestApp();

      await request(app).post(`/api/items/${ITEM_ID}/estimate-value`).expect(401);
    });

    it("returns the item with a model-judgment valuation", async () => {
      const { app, storage, objectStorage } = await createTestApp();
      await seedItem(storage, objectStorage, { analysisMetadata: { model: "openai" } });
      const agent = await login(app);

      const response = await agent.post(`/api/items/${ITEM_ID}/estimate-value`).expect(200);

      expect(response.body.valuation).toMatchObject({
        status: "estimated",
        likely: "10.00",
        evidence: { basis: "model_judgment" },
      });
      expect(response.body.location).toBe("Shed");
    });

    it("returns 409 NOT_IDENTIFIED for unidentified items", async () => {
      const { app, storage, objectStorage } = await createTestApp();
      await seedItem(storage, objectStorage);
      const agent = await login(app);

      const response = await agent.post(`/api/items/${ITEM_ID}/estimate-value`).expect(409);

      expect(response.body.code).toBe("NOT_IDENTIFIED");
    });

    it("returns 404 for an unknown item", async () => {
      const { app } = await createTestApp();
      const agent = await login(app);

      await agent.post(`/api/items/${ITEM_ID}/estimate-value`).expect(404);
    });

    it("returns VALUATION_FAILED and keeps existing data when the AI fails", async () => {
      const { app, storage, objectStorage, analyzer } = await createTestApp();
      await seedItem(storage, objectStorage, {
        analysisMetadata: { model: "openai" },
        estimatedValue: "125.00",
        valueConfidence: "medium",
      });
      const before = structuredClone(await storage.getItem(ITEM_ID));
      vi.spyOn(analyzer, "estimateValue").mockRejectedValueOnce(new Error("upstream timeout"));
      const agent = await login(app);

      const response = await agent.post(`/api/items/${ITEM_ID}/estimate-value`).expect(502);

      expect(response.body.code).toBe("VALUATION_FAILED");
      expect(await storage.getItem(ITEM_ID)).toEqual(before);
    });

    it("returns VALUATION_FAILED for a zero-valued model estimate and keeps existing data", async () => {
      const { app, storage, objectStorage, analyzer } = await createTestApp();
      await seedItem(storage, objectStorage, { analysisMetadata: { model: "openai" } });
      const agent = await login(app);
      await agent.post(`/api/items/${ITEM_ID}/estimate-value`).expect(200);
      const before = structuredClone(await storage.getItem(ITEM_ID));
      vi.spyOn(analyzer, "estimateValue").mockImplementationOnce(async () => ({
        ...parseValuation({
          status: "estimated",
          marketability: "marketable",
          low: "0",
          likely: "0",
          high: "0",
          confidence: "low",
        }),
        model: "test",
        promptVersion: "test",
        raw: null,
      }));

      const response = await agent.post(`/api/items/${ITEM_ID}/estimate-value`).expect(502);

      expect(response.body.code).toBe("VALUATION_FAILED");
      expect(await storage.getItem(ITEM_ID)).toEqual(before);
      expect(before?.valuation?.status).toBe("estimated");
    });
  });
});

async function createTestApp(): Promise<{
  app: Express;
  storage: FakeDatabaseStorage;
  objectStorage: FakeObjectStorageService;
  analyzer: FakeAnalyzer;
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

  const services = await createTestServices({} as AppConfig);
  await registerRoutes(app, services);
  app.use(errorMiddleware);

  return {
    app,
    storage: services.storage as FakeDatabaseStorage,
    objectStorage: services.objectStorage as FakeObjectStorageService,
    analyzer: services.analyzer as FakeAnalyzer,
  };
}

async function login(app: Express) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: TEST_PASSWORD }).expect(200);
  return agent;
}

async function seedItem(
  storage: FakeDatabaseStorage,
  objectStorage: FakeObjectStorageService,
  overrides: Partial<InventoryItem> = {}
): Promise<void> {
  storage.seed([
    {
      id: ITEM_ID,
      name: "Untitled Item",
      description: "",
      category: "Uncategorized",
      tags: [],
      imageUrl: `/objects/items/${ITEM_ID}.jpg`,
      imageUrls: [`/objects/items/${ITEM_ID}.jpg`],
      barcodeData: "INV-TEST",
      estimatedValue: null,
      valueConfidence: null,
      valueRationale: null,
      location: "Shed",
      analysisMetadata: { model: "none" },
      identification: null,
      valuation: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      ...overrides,
    },
  ]);
  await objectStorage.save(`items/${ITEM_ID}.jpg`, Buffer.from("synthetic image"));
}

function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  return res.status(500).json({ error: "Internal Server Error", code: "UNHANDLED" });
}
