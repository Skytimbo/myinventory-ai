import { describe, it, expect, vi, beforeEach } from "vitest";
import { ItemService } from "../itemService";
import {
  FakeDatabaseStorage,
  FakeObjectStorageService,
  FakeAnalyzer,
} from "../services";

function makeFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  // 1x1 JPEG magic bytes + padding
  const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  return {
    fieldname: "image",
    originalname: "test.jpg",
    encoding: "7bit",
    mimetype: "image/jpeg",
    buffer: Buffer.concat([jpegMagic, Buffer.alloc(100)]),
    size: 108,
    stream: null as any,
    destination: "",
    filename: "",
    path: "",
    ...overrides,
  };
}

describe("ItemService", () => {
  let storage: FakeDatabaseStorage;
  let objectStorage: FakeObjectStorageService;
  let analyzer: FakeAnalyzer;
  let service: ItemService;

  beforeEach(() => {
    storage = new FakeDatabaseStorage();
    objectStorage = new FakeObjectStorageService();
    analyzer = new FakeAnalyzer();
    service = new ItemService(storage, objectStorage, analyzer);
  });

  describe("createItem", () => {
    it("should create an item with AI identification and no valuation", async () => {
      const file = makeFile();
      const result = await service.createItem({ files: [file] });

      expect(result.item.name).toBe("Test Item");
      expect(result.item.description).toBe("Test description");
      expect(result.item.category).toBe("Test");
      expect(result.item.tags).toEqual(["test"]);
      expect(result.item.identification).toMatchObject({
        confidence: 1,
        uncertainty: "low",
        model: "fake",
        promptVersion: "identify-test",
      });
      expect(result.item.valuation).toBeNull();
      expect(result.item.estimatedValue ?? null).toBeNull();
      expect(result.item.valueConfidence ?? null).toBeNull();
      expect(result.aiWarning).toBeNull();
    });

    it("should create an item in Quick Capture mode (skipAI=true)", async () => {
      const file = makeFile();
      const result = await service.createItem({ files: [file], skipAI: true });

      expect(result.item.name).toBe("Untitled Item");
      expect(result.item.description).toBe("");
      expect(result.item.category).toBe("Uncategorized");
      expect(result.item.estimatedValue ?? null).toBeNull();
      expect(result.item.identification).toBeNull();
      expect(result.item.analysisMetadata?.model).toBe("none");
      expect(result.aiWarning).toBe("Quick capture - not yet identified");
    });

    it("should save image to object storage", async () => {
      const file = makeFile();
      await service.createItem({ files: [file] });

      // Should have saved exactly one file
      const items = await storage.getItems();
      const imageUrl = items[0].imageUrl;
      expect(imageUrl).toMatch(/^\/objects\/items\/.+\.jpg$/);
    });

    it("should save multiple images with indexed paths", async () => {
      const files = [makeFile(), makeFile({ originalname: "test2.jpg" })];
      const result = await service.createItem({ files });

      // Multi-image uses /items/{id}/{index}.ext pattern
      expect(result.item.imageUrls).toHaveLength(2);
      expect(result.item.imageUrls![0]).toMatch(/\/0\.jpg$/);
      expect(result.item.imageUrls![1]).toMatch(/\/1\.jpg$/);
    });

    it("should set location if provided", async () => {
      const file = makeFile();
      const result = await service.createItem({
        files: [file],
        location: "Garage",
      });

      expect(result.item.location).toBe("Garage");
    });

    it("should return aiWarning when analyzer throws", async () => {
      vi.spyOn(analyzer, "identify").mockRejectedValueOnce(
        new Error("API unavailable"),
      );
      // Suppress expected console.error
      vi.spyOn(console, "error").mockImplementation(() => {});

      const file = makeFile();
      const result = await service.createItem({ files: [file] });

      expect(result.item.name).toBe("Item");
      expect(result.item.identification).toBeNull();
      expect(result.item.analysisMetadata?.note).toContain("unavailable");
      expect(result.aiWarning).toContain("AI identification unavailable");
    });

    it("should reject invalid file types", async () => {
      const file = makeFile({
        mimetype: "application/pdf",
        buffer: Buffer.alloc(100), // No JPEG magic bytes
      });

      await expect(service.createItem({ files: [file] })).rejects.toThrow();
    });

    it("should generate unique barcode data", async () => {
      const file = makeFile();
      const result1 = await service.createItem({ files: [file] });
      const result2 = await service.createItem({ files: [file] });

      expect(result1.item.barcodeData).not.toBe(result2.item.barcodeData);
      expect(result1.item.barcodeData).toMatch(/^INV-/);
    });
  });

  describe("identifyItem", () => {
    it("should identify a Quick Capture item and update it", async () => {
      const file = makeFile();
      const { item } = await service.createItem({
        files: [file],
        skipAI: true,
      });
      expect(item.name).toBe("Untitled Item");

      const updated = await service.identifyItem(item.id);

      expect(updated.name).toBe("Test Item");
      expect(updated.description).toBe("Test description");
      expect(updated.category).toBe("Test");
      expect(updated.identification?.promptVersion).toBe("identify-test");
      expect(updated.analysisMetadata?.imageHash).toMatch(/^[0-9a-f]{64}$/);
      expect(updated.valuation).toBeNull();
    });

    it("should preserve location and legacy valuation data", async () => {
      const { item } = await service.createItem({ files: [makeFile()], location: "Garage" });
      await storage.updateItem(item.id, {
        estimatedValue: "125.00",
        valueConfidence: "medium",
        valueRationale: "Legacy combined analysis",
      });

      const updated = await service.identifyItem(item.id);

      expect(updated.location).toBe("Garage");
      expect(updated.estimatedValue).toBe("125.00");
      expect(updated.valueConfidence).toBe("medium");
      expect(updated.valueRationale).toBe("Legacy combined analysis");
    });

    it("should mark an existing valuation stale but keep its amounts", async () => {
      const { item } = await service.createItem({ files: [makeFile()] });
      const valuation = {
        status: "estimated" as const,
        marketability: "marketable" as const,
        marketabilityReason: "Test",
        currency: "USD" as const,
        low: "5.00",
        likely: "8.00",
        high: "10.00",
        confidence: "medium" as const,
        rationale: "Test",
        missingInformation: [],
        evidence: { basis: "model_judgment" as const, note: "No marketplace data was retrieved." },
        basedOn: { name: "Test Item", category: "Test", identifiedAt: null },
        model: "fake",
        evaluatedAt: "2026-10-23T00:00:00.000Z",
        promptVersion: "valuation-test",
        staleAt: null,
        staleReason: null,
      };
      await storage.updateItem(item.id, { valuation });

      // Same name and category: still stale, AI judgment is not used to decide
      const updated = await service.identifyItem(item.id);

      expect(updated.valuation).toMatchObject({
        likely: "8.00",
        staleReason: "reidentified",
      });
      expect(updated.valuation?.staleAt).toEqual(expect.any(String));

      const staleAt = updated.valuation?.staleAt;
      const again = await service.identifyItem(item.id);
      expect(again.valuation?.staleAt).toBe(staleAt);
    });

    it("should send up to four of the item's images, primary first", async () => {
      const files = Array.from({ length: 5 }, (_, i) =>
        makeFile({
          buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, i]), Buffer.alloc(100)]),
        })
      );
      const { item } = await service.createItem({ files, skipAI: true });
      const identify = vi.spyOn(analyzer, "identify");

      await service.identifyItem(item.id);

      const images = identify.mock.calls[0][0];
      expect(images).toHaveLength(4);
      expect(images[0]).toEqual(files[0].buffer);
    });

    it("should leave the item unchanged when identification fails", async () => {
      const { item } = await service.createItem({ files: [makeFile()], location: "Attic" });
      const before = structuredClone(await storage.getItem(item.id));
      vi.spyOn(analyzer, "identify").mockRejectedValueOnce(new Error("API unavailable"));

      await expect(service.identifyItem(item.id)).rejects.toThrow("API unavailable");

      expect(await storage.getItem(item.id)).toEqual(before);
    });

    it("should throw if item not found", async () => {
      await expect(service.identifyItem("nonexistent-id")).rejects.toThrow(
        "Item not found",
      );
    });
  });

  describe("getItem", () => {
    it("should return item by id", async () => {
      const file = makeFile();
      const { item } = await service.createItem({ files: [file] });

      const found = await service.getItem(item.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(item.id);
    });

    it("should return undefined for nonexistent id", async () => {
      const found = await service.getItem("nonexistent");
      expect(found).toBeUndefined();
    });
  });

  describe("getItems", () => {
    it("should return all items", async () => {
      const file = makeFile();
      await service.createItem({ files: [file] });
      await service.createItem({ files: [file] });

      const items = await service.getItems();
      expect(items).toHaveLength(2);
    });

    it("should return empty array when no items", async () => {
      const items = await service.getItems();
      expect(items).toEqual([]);
    });
  });

  describe("deleteItem", () => {
    it("should delete an item", async () => {
      const file = makeFile();
      const { item } = await service.createItem({ files: [file] });

      const result = await service.deleteItem(item.id);
      expect(result).toBe(true);

      const found = await service.getItem(item.id);
      expect(found).toBeUndefined();
    });

    it("should return false for nonexistent item", async () => {
      const result = await service.deleteItem("nonexistent");
      expect(result).toBe(false);
    });
  });
});
