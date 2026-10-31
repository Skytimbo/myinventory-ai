import { describe, it, expect, vi, beforeEach } from "vitest";
import { ItemService } from "../itemService";
import { InvalidValuationError, OpenAIAnalyzer } from "../analyzer";
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

    it("should store the upload as photo evidence keyed by photo id and link it", async () => {
      const file = makeFile();
      const { item } = await service.createItem({ files: [file] });

      const snapshot = await storage.getEvidenceSnapshot();
      expect(snapshot.photos).toHaveLength(1);
      const [photo] = snapshot.photos;
      expect(item.imageUrl).toBe(photo.objectPath);
      expect(photo.objectPath).toMatch(new RegExp(`^/objects/photos/${photo.id}\\.jpg$`));
      expect(photo).toMatchObject({
        source: "item_upload",
        batchId: null,
        bytes: file.buffer.length,
        mimeType: "image/jpeg",
        originalFilename: "test.jpg",
      });
      expect(await objectStorage.read(photo.objectPath)).toEqual(file.buffer);
      expect(snapshot.itemPhotos).toEqual([
        expect.objectContaining({ itemId: item.id, photoId: photo.id, position: 0 }),
      ]);
    });

    it("should keep multiple uploads in order as separate photos", async () => {
      const files = [makeFile(), makeFile({ originalname: "test2.jpg" })];
      const result = await service.createItem({ files });

      const { photos, itemPhotos } = await storage.getEvidenceSnapshot();
      expect(result.item.imageUrls).toHaveLength(2);
      expect(result.item.imageUrls).toEqual(
        itemPhotos.map((link) => photos.find((photo) => photo.id === link.photoId)?.objectPath)
      );
      expect(itemPhotos.map((link) => link.position)).toEqual([0, 1]);
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

  describe("estimateValue", () => {
    it("should store a valuation with server-set evidence and provenance", async () => {
      const { item } = await service.createItem({ files: [makeFile()] });

      const updated = await service.estimateValue(item.id);

      expect(updated.valuation).toMatchObject({
        status: "estimated",
        low: "5.00",
        likely: "10.00",
        high: "15.00",
        currency: "USD",
        evidence: { basis: "model_judgment" },
        basedOn: {
          name: "Test Item",
          category: "Test",
          identifiedAt: item.identification?.identifiedAt,
        },
        promptVersion: "valuation-test",
        staleAt: null,
        scope: "item",
        assumptions: ["visible_condition_only"],
      });
      expect(updated.valuation?.evidence.note).toContain("No marketplace or sales data");
    });

    it("should pass identification details and images to the analyzer", async () => {
      const { item } = await service.createItem({ files: [makeFile()] });
      const estimate = vi.spyOn(analyzer, "estimateValue");

      await service.estimateValue(item.id);

      expect(estimate.mock.calls[0][0]).toMatchObject({
        name: "Test Item",
        category: "Test",
        description: "Test description",
        identificationNotes: null,
      });
      expect(estimate.mock.calls[0][0].images).toHaveLength(1);
    });

    it("should refuse unidentified items without calling the AI", async () => {
      const { item } = await service.createItem({ files: [makeFile()], skipAI: true });
      const estimate = vi.spyOn(analyzer, "estimateValue");

      await expect(service.estimateValue(item.id)).rejects.toThrow("Item not identified");
      expect(estimate).not.toHaveBeenCalled();
    });

    it("should estimate legacy-identified items and leave legacy values untouched", async () => {
      const { item } = await service.createItem({ files: [makeFile()] });
      await storage.updateItem(item.id, {
        identification: null,
        analysisMetadata: { model: "openai", version: "v2" },
        estimatedValue: "300.00",
        valueConfidence: "high",
        valueRationale: "Legacy",
      });

      const updated = await service.estimateValue(item.id);

      expect(updated.valuation?.basedOn.identifiedAt).toBeNull();
      expect(updated.valuation?.likely).toBe("10.00");
      expect(updated.estimatedValue).toBe("300.00");
      expect(updated.valueConfidence).toBe("high");
      expect(updated.valueRationale).toBe("Legacy");
    });

    it("should replace a stale valuation with a fresh one", async () => {
      const { item } = await service.createItem({ files: [makeFile()] });
      await service.estimateValue(item.id);
      const reidentified = await service.identifyItem(item.id);
      expect(reidentified.valuation?.staleAt).not.toBeNull();

      const updated = await service.estimateValue(item.id);

      expect(updated.valuation?.staleAt).toBeNull();
      expect(updated.valuation?.basedOn.identifiedAt).toBe(
        reidentified.identification?.identifiedAt
      );
    });

    it("should save the estimate as stale if the item was re-identified meanwhile", async () => {
      const { item } = await service.createItem({ files: [makeFile()] });
      const original = analyzer.estimateValue.bind(analyzer);
      vi.spyOn(analyzer, "estimateValue").mockImplementationOnce(async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await service.identifyItem(item.id);
        return original(input);
      });

      const updated = await service.estimateValue(item.id);

      expect(updated.valuation?.staleReason).toBe("reidentified");
      expect(updated.valuation?.staleAt).toEqual(expect.any(String));
    });

    it("should keep the previous valuation when estimation fails", async () => {
      const { item } = await service.createItem({ files: [makeFile()] });
      const first = await service.estimateValue(item.id);
      vi.spyOn(analyzer, "estimateValue").mockRejectedValueOnce(new Error("timeout"));

      await expect(service.estimateValue(item.id)).rejects.toThrow("timeout");

      expect((await storage.getItem(item.id))?.valuation).toEqual(first.valuation);
    });

    it("should throw if item not found", async () => {
      await expect(service.estimateValue("nonexistent-id")).rejects.toThrow("Item not found");
    });

    describe("with invalid model output (real OpenAIAnalyzer, mocked client)", () => {
      const respond = (fields: Record<string, unknown>) => ({
        choices: [{ message: { content: JSON.stringify(fields) } }],
      });

      it.each([
        ["a zero-valued estimate", { status: "estimated", marketability: "marketable", low: "0", likely: "0", high: "0", confidence: "low" }],
        ["an estimate with no range", { status: "estimated", marketability: "marketable", confidence: "medium" }],
        ["status contradicting marketability", { status: "nonmarketable", marketability: "marketable" }],
        ["a price on insufficient information", { status: "insufficient_information", marketability: "uncertain", likely: "200" }],
        ["a v4 estimate without a scope", { status: "estimated", marketability: "marketable", low: "10", likely: "20", high: "30", confidence: "low" }],
        ["a high-confidence category baseline", { status: "estimated", marketability: "marketable", scope: "category", low: "1", likely: "2", high: "3", confidence: "high" }],
        ["an unknown assumption", { status: "estimated", marketability: "marketable", scope: "item", assumptions: ["authentic"], low: "10", likely: "20", high: "30", confidence: "low" }],
      ])("should reject %s and keep the record unchanged", async (_label, output) => {
        const premium = { chat: { completions: { create: vi.fn().mockResolvedValue(respond(output)) } } };
        const realAnalyzer = new OpenAIAnalyzer({} as never, premium as never);
        const realService = new ItemService(storage, objectStorage, realAnalyzer);

        const { item } = await service.createItem({ files: [makeFile()] });
        await service.estimateValue(item.id);
        await storage.updateItem(item.id, {
          estimatedValue: "125.00",
          valueConfidence: "medium",
          valueRationale: "Legacy",
        });
        const before = structuredClone(await storage.getItem(item.id));

        await expect(realService.estimateValue(item.id)).rejects.toBeInstanceOf(
          InvalidValuationError
        );

        expect(premium.chat.completions.create).toHaveBeenCalledTimes(1);
        expect(await storage.getItem(item.id)).toEqual(before);
      });
    });
  });

  describe("editItem", () => {
    async function identified() {
      return (await service.createItem({ files: [makeFile()] })).item; // FakeAnalyzer: "Test Item" / "Test"
    }

    it("records edited fields as user assertions without touching others", async () => {
      const item = await identified();

      const edited = await service.editItem(item.id, {
        fields: { name: "Dad's drill", location: "Garage", notes: "Lent to Sam" },
      });

      expect(edited).toMatchObject({ name: "Dad's drill", location: "Garage", notes: "Lent to Sam", category: "Test" });
      expect(Object.keys(edited.userAssertions ?? {}).sort()).toEqual(["location", "name", "notes"]);
      expect(edited.userAssertions?.name).toEqual({ source: "user", assertedAt: expect.any(String) });
    });

    it("confirms current values as they are, upgrading capture context to the user's own", async () => {
      const item = await identified();
      await storage.updateItem(item.id, {
        userAssertions: { category: { source: "batch_context", assertedAt: "2026-10-01T00:00:00.000Z" } },
      });

      const confirmed = await service.editItem(item.id, { confirm: ["name", "category"] });

      expect(confirmed.name).toBe("Test Item");
      expect(confirmed.userAssertions?.name?.source).toBe("user");
      expect(confirmed.userAssertions?.category?.source).toBe("user");
    });

    it("keeps user edits through re-identification and records the AI's differing values", async () => {
      const item = await identified();
      await service.editItem(item.id, { fields: { name: "Dad's drill", category: "Tools" } });

      const reidentified = await service.identifyItem(item.id);

      expect(reidentified).toMatchObject({ name: "Dad's drill", category: "Tools", description: "Test description" });
      expect(reidentified.identification?.suggestions).toEqual({ name: "Test Item", category: "Test" });
    });

    it("applies an AI suggestion in one step and records it as the user's choice", async () => {
      const item = await identified();
      await service.editItem(item.id, { fields: { name: "Thing" } });
      await service.identifyItem(item.id);

      const accepted = await service.editItem(item.id, { acceptSuggestions: ["name"] });

      expect(accepted.name).toBe("Test Item");
      expect(accepted.userAssertions?.name?.source).toBe("user");
      expect(accepted.identification?.suggestions).toEqual({});
      await expect(service.editItem(item.id, { acceptSuggestions: ["name"] })).rejects.toThrow("No suggestion for name");
    });

    it("marks a current estimate stale when what the item is changes, but not for location or notes", async () => {
      const item = await identified();
      await service.estimateValue(item.id);

      const moved = await service.editItem(item.id, { fields: { location: "Attic", notes: "Box 3" } });
      expect(moved.valuation?.staleAt).toBeNull();

      const renamed = await service.editItem(item.id, { fields: { name: "Hammer drill" } });
      expect(renamed.valuation).toMatchObject({ staleReason: "user_edited", likely: "10.00" });
      expect(renamed.valuation?.staleAt).toEqual(expect.any(String));
    });

    it("throws if item not found", async () => {
      await expect(service.editItem("nonexistent-id", { confirm: ["name"] })).rejects.toThrow("Item not found");
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
