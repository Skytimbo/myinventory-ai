import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OpenAIAnalyzer,
  MockAnalyzer,
  openAIHealthCheck,
  confidenceToUncertainty,
  stripMonetarySentences,
} from "../analyzer";

function createMockClient() {
  return {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    models: {
      list: vi.fn(),
    },
  } as any;
}

function makeAIResponse(fields: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(fields),
        },
      },
    ],
  };
}

const PRICE_KEYS = ["estimatedValue", "valueConfidence", "valueRationale", "price", "value"];

describe("OpenAIAnalyzer.identify", () => {
  let cheapClient: ReturnType<typeof createMockClient>;
  let premiumClient: ReturnType<typeof createMockClient>;
  let analyzer: OpenAIAnalyzer;
  const imageBuffer = Buffer.from("fake-image-data");

  beforeEach(() => {
    cheapClient = createMockClient();
    premiumClient = createMockClient();
    analyzer = new OpenAIAnalyzer(cheapClient, premiumClient);
  });

  describe("synthetic scenarios", () => {
    it("names an ordinary river rock plainly with no monetary fields", async () => {
      cheapClient.chat.completions.create.mockResolvedValue(
        makeAIResponse({
          name: "River rock",
          description: "Smooth gray river rock about the size of a palm.",
          category: "Natural Objects",
          tags: ["rock", "stone", "river rock"],
          confidence: 0.95,
          uncertaintyNotes: null,
          possibleAlternatives: [],
        })
      );

      const result = await analyzer.identify([imageBuffer]);

      expect(result.name).toBe("River rock");
      expect(result.category).toBe("Natural Objects");
      expect(confidenceToUncertainty(result.confidence)).toBe("low");
      for (const key of PRICE_KEYS) {
        expect(result).not.toHaveProperty(key);
      }
    });

    it("identifies a branded tool and drops any price the model volunteers", async () => {
      cheapClient.chat.completions.create.mockResolvedValue(
        makeAIResponse({
          name: "DeWalt 20V MAX cordless drill",
          description:
            "Yellow and black cordless drill with battery attached. Worth about $60 used.",
          category: "Tools",
          tags: ["Drill", "dewalt", "Power Tool", "drill"],
          confidence: 0.92,
          uncertaintyNotes: null,
          possibleAlternatives: [],
          estimatedValue: "60.00",
          valueConfidence: "high",
          valueRationale: "Recent eBay sold listings",
        })
      );

      const result = await analyzer.identify([imageBuffer]);

      expect(result.name).toBe("DeWalt 20V MAX cordless drill");
      expect(result.description).toBe("Yellow and black cordless drill with battery attached.");
      expect(result.tags).toEqual(["drill", "dewalt", "power tool"]);
      for (const key of PRICE_KEYS) {
        expect(result).not.toHaveProperty(key);
      }
    });

    it("identifies a generic household object generically", async () => {
      cheapClient.chat.completions.create.mockResolvedValue(
        makeAIResponse({
          name: "White ceramic coffee mug",
          description: "Plain white ceramic mug with a handle, no visible branding.",
          category: "Kitchen",
          tags: ["mug", "ceramic", "kitchen"],
          confidence: 0.88,
          uncertaintyNotes: null,
          possibleAlternatives: [],
        })
      );

      const result = await analyzer.identify([imageBuffer]);

      expect(result.category).toBe("Kitchen");
      expect(result.notes).toBeNull();
      expect(result.alternatives).toEqual([]);
    });

    it("escalates an ambiguous antique to the premium model and keeps its uncertainty", async () => {
      cheapClient.chat.completions.create.mockResolvedValue(
        makeAIResponse({ name: "Old jar", confidence: 0.2 })
      );
      premiumClient.chat.completions.create.mockResolvedValue(
        makeAIResponse({
          name: "Salt-glazed stoneware crock",
          description: "Gray stoneware crock with cobalt decoration and a chipped rim.",
          category: "Antiques",
          tags: ["stoneware", "crock", "antique"],
          confidence: 0.55,
          uncertaintyNotes:
            "Maker's mark not visible; a photo of the base would help. Could be worth $200.",
          possibleAlternatives: ["Butter churn base", "Water cooler body", "Pickling jar", "Vase"],
        })
      );

      const result = await analyzer.identify([imageBuffer]);

      expect(result.name).toBe("Salt-glazed stoneware crock");
      expect(result.model).toBe("gpt-4o");
      expect(confidenceToUncertainty(result.confidence)).toBe("medium");
      expect(result.notes).toBe("Maker's mark not visible; a photo of the base would help.");
      expect(result.alternatives).toEqual(["Butter churn base", "Water cooler body", "Pickling jar"]);
    });
  });

  it("uses the cheap model when confidence >= 0.4", async () => {
    cheapClient.chat.completions.create.mockResolvedValue(
      makeAIResponse({ name: "Laptop", confidence: 0.4 })
    );

    const result = await analyzer.identify([imageBuffer]);

    expect(result.model).toBe("gpt-4o-mini");
    expect(premiumClient.chat.completions.create).not.toHaveBeenCalled();
  });

  it("defaults confidence to 0.9 for the premium model when missing", async () => {
    cheapClient.chat.completions.create.mockResolvedValue(makeAIResponse({ confidence: 0.1 }));
    premiumClient.chat.completions.create.mockResolvedValue(makeAIResponse({ name: "Vase" }));

    const result = await analyzer.identify([imageBuffer]);

    expect(result.confidence).toBe(0.9);
  });

  it("uses safe defaults and clamps out-of-range values", async () => {
    cheapClient.chat.completions.create.mockResolvedValue(
      makeAIResponse({ confidence: 7, tags: "not-an-array", possibleAlternatives: [1, " "] })
    );

    const result = await analyzer.identify([imageBuffer]);

    expect(result).toMatchObject({
      name: "Item",
      description: "Unknown item",
      category: "Uncategorized",
      tags: [],
      confidence: 1,
      notes: null,
      alternatives: [],
      promptVersion: "identify-v3",
    });
  });

  it("sends every image (up to 4) with a detected MIME type and an identify-only prompt", async () => {
    cheapClient.chat.completions.create.mockResolvedValue(
      makeAIResponse({ name: "Item", confidence: 0.5 })
    );
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

    await analyzer.identify([png, imageBuffer, imageBuffer, imageBuffer, imageBuffer]);

    const callArgs = cheapClient.chat.completions.create.mock.calls[0][0];
    type Part = { type: string; text?: string; image_url?: { url: string } };
    const content: Part[] = callArgs.messages[0].content;
    const images = content.filter((part) => part.type === "image_url");
    const prompt = content.find((part) => part.type === "text")?.text ?? "";
    expect(images).toHaveLength(4);
    expect(images[0].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(images[1].image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(prompt).toContain("Do not estimate price, value, or worth");
    expect(prompt).not.toMatch(/estimatedValue|eBay/);
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.seed).toBe(42);
  });

  describe("failures", () => {
    it("throws when AI returns no content", async () => {
      cheapClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      await expect(analyzer.identify([imageBuffer])).rejects.toThrow("No response from AI");
    });

    it("throws a clear error on malformed JSON", async () => {
      cheapClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: "{not json" } }],
      });

      await expect(analyzer.identify([imageBuffer])).rejects.toThrow("AI returned invalid JSON");
    });

    it("rejects non-object JSON", async () => {
      cheapClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: "[1,2]" } }],
      });

      await expect(analyzer.identify([imageBuffer])).rejects.toThrow("unexpected response shape");
    });

    it("propagates API errors", async () => {
      cheapClient.chat.completions.create.mockRejectedValue(new Error("Rate limit exceeded"));

      await expect(analyzer.identify([imageBuffer])).rejects.toThrow("Rate limit exceeded");
    });

    it("requires at least one image", async () => {
      await expect(analyzer.identify([])).rejects.toThrow("At least one image is required");
    });
  });

  it("exposes capabilities", () => {
    expect(analyzer.capabilities.supportsMultiItem).toBe(false);
    expect(analyzer.capabilities.maxImageSize).toBe(20 * 1024 * 1024);
  });
});

describe("identify prompt rules (2026-10-24 production observations)", () => {
  async function identifyPrompt(): Promise<string> {
    const cheap = createMockClient();
    cheap.chat.completions.create.mockResolvedValue(makeAIResponse({ name: "Item", confidence: 0.9 }));
    await new OpenAIAnalyzer(cheap, createMockClient()).identify([Buffer.from("img")]);
    const content = cheap.chat.completions.create.mock.calls[0][0].messages[0].content as Array<{ type: string; text?: string }>;
    return content.find((part) => part.type === "text")?.text ?? "";
  }

  it("asks for legible markings (missed DeWalt / XRP / 18V)", async () => {
    const prompt = await identifyPrompt();

    expect(prompt).toContain("Read legible markings first");
    for (const marking of ["manufacturer", "model", "series", "voltage", "capacity"]) {
      expect(prompt).toContain(marking);
    }
    expect(prompt).toContain("Clearly legible text is visible evidence, not a guess");
    expect(prompt).toContain("DeWalt XRP 18V cordless drill");
  });

  it("forbids unsupported treatment, material, origin, and interior claims ('polished', fur lining)", async () => {
    const prompt = await identifyPrompt();

    expect(prompt).toContain("Separate what is visible from what is inferred");
    for (const claim of ["surface treatment", "polished", "specific materials", "provenance", "cultural origin", "interior construction", "a lining", "age"]) {
      expect(prompt).toContain(claim);
    }
    expect(prompt).toContain("put it in uncertaintyNotes as a possibility instead of stating it");
  });

  it("keeps inferred qualities out of tags (v3: mug tagged 'handcrafted')", async () => {
    const prompt = await identifyPrompt();

    expect(prompt).toContain("visible facts only; no inferred qualities such as handcrafted or antique");
    expect(prompt).toContain("This applies to the name, description, and tags alike");
  });

  it("keeps the existing anti-hallucination and no-money rules", async () => {
    const prompt = await identifyPrompt();

    expect(prompt).toContain("Do not estimate price, value, or worth");
    expect(prompt).toContain("Do not invent brands, models, makers, dates, or origins");
    expect(prompt).toContain('Name ordinary natural objects plainly (e.g. "River rock"');
    expect(prompt).not.toMatch(/eBay|estimatedValue/);
  });

  it("keeps legible markings from a model answer in name and tags", async () => {
    const cheap = createMockClient();
    cheap.chat.completions.create.mockResolvedValue(
      makeAIResponse({
        name: "DeWalt XRP 18V cordless drill",
        description: "Yellow and black DeWalt drill marked XRP and 18V, with battery attached.",
        category: "Tools",
        tags: ["DeWalt", "XRP", "18V", "drill"],
        confidence: 0.93,
        uncertaintyNotes: "Working condition cannot be seen.",
        possibleAlternatives: [],
      })
    );

    const result = await new OpenAIAnalyzer(cheap, createMockClient()).identify([Buffer.from("img")]);

    expect(result.name).toBe("DeWalt XRP 18V cordless drill");
    expect(result.tags).toEqual(["dewalt", "xrp", "18v", "drill"]);
    expect(result.promptVersion).toBe("identify-v3");
  });
});

describe("stripMonetarySentences", () => {
  it.each([
    ["A red bicycle. It sells for $40.", "A red bicycle."],
    ["Brass lamp. Valued at 100 dollars.", "Brass lamp."],
    ["A blue vase with a chip.", "A blue vase with a chip."],
  ])("%s", (input, expected) => {
    expect(stripMonetarySentences(input)).toBe(expected);
  });
});

describe("MockAnalyzer", () => {
  it("returns deterministic identification without monetary fields", async () => {
    const mock = new MockAnalyzer();
    const result = await mock.identify([Buffer.from("any")]);

    expect(result.name).toBe("Mock Item");
    expect(result.confidence).toBe(1.0);
    expect(result).not.toHaveProperty("estimatedValue");
  });

  it("exposes capabilities", () => {
    const mock = new MockAnalyzer();
    expect(mock.capabilities.supportsMultiItem).toBe(false);
  });
});

describe("openAIHealthCheck", () => {
  it("should return ok:true when models.list succeeds", async () => {
    const client = createMockClient();
    client.models.list.mockResolvedValue({ data: [] });

    const result = await openAIHealthCheck(client);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should return ok:false with error when models.list fails", async () => {
    const client = createMockClient();
    client.models.list.mockRejectedValue(new Error("Invalid API key"));

    const result = await openAIHealthCheck(client);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });
});
