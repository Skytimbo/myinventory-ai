import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIAnalyzer, MockAnalyzer, openAIHealthCheck } from "../analyzer";

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

describe("OpenAIAnalyzer", () => {
  let cheapClient: ReturnType<typeof createMockClient>;
  let premiumClient: ReturnType<typeof createMockClient>;
  let analyzer: OpenAIAnalyzer;
  const imageBuffer = Buffer.from("fake-image-data");

  beforeEach(() => {
    cheapClient = createMockClient();
    premiumClient = createMockClient();
    analyzer = new OpenAIAnalyzer(cheapClient, premiumClient);
  });

  it("should return analysis result from cheap model when confidence >= 0.4", async () => {
    cheapClient.chat.completions.create.mockResolvedValue(
      makeAIResponse({
        name: "Laptop",
        description: "A silver laptop",
        category: "Electronics",
        tags: ["laptop", "computer"],
        confidence: 0.8,
        estimatedValue: "300.00",
        valueConfidence: "medium",
        valueRationale: "Used laptop market price",
      }),
    );

    const result = await analyzer.analyze(imageBuffer);

    expect(result.name).toBe("Laptop");
    expect(result.confidence).toBe(0.8);
    expect(premiumClient.chat.completions.create).not.toHaveBeenCalled();
  });

  it("should fallback to premium model when confidence < 0.4", async () => {
    cheapClient.chat.completions.create.mockResolvedValue(
      makeAIResponse({ name: "Unknown", confidence: 0.2 }),
    );
    premiumClient.chat.completions.create.mockResolvedValue(
      makeAIResponse({
        name: "Antique Vase",
        confidence: 0.9,
        estimatedValue: "500.00",
        valueConfidence: "high",
        valueRationale: "Comparable sales",
      }),
    );

    const result = await analyzer.analyze(imageBuffer);

    expect(result.name).toBe("Antique Vase");
    expect(result.confidence).toBe(0.9);
    expect(cheapClient.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(premiumClient.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("should throw when AI returns no content", async () => {
    cheapClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    await expect(analyzer.analyze(imageBuffer)).rejects.toThrow("No response from AI");
  });

  it("should propagate API errors", async () => {
    cheapClient.chat.completions.create.mockRejectedValue(new Error("Rate limit exceeded"));

    await expect(analyzer.analyze(imageBuffer)).rejects.toThrow("Rate limit exceeded");
  });

  it("should pass correct model names to each client", async () => {
    cheapClient.chat.completions.create.mockResolvedValue(
      makeAIResponse({ name: "Item", confidence: 0.5 }),
    );

    await analyzer.analyze(imageBuffer);

    const callArgs = cheapClient.chat.completions.create.mock.calls[0][0];
    expect(callArgs.model).toBe("gpt-4o-mini");
  });

  it("should set temperature=0 and seed=42 for reproducibility", async () => {
    cheapClient.chat.completions.create.mockResolvedValue(
      makeAIResponse({ name: "Item", confidence: 0.5 }),
    );

    await analyzer.analyze(imageBuffer);

    const callArgs = cheapClient.chat.completions.create.mock.calls[0][0];
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.seed).toBe(42);
  });

  it("should expose capabilities", () => {
    expect(analyzer.capabilities.supportsMultiItem).toBe(false);
    expect(analyzer.capabilities.maxImageSize).toBe(20 * 1024 * 1024);
  });
});

describe("MockAnalyzer", () => {
  it("should return deterministic results", async () => {
    const mock = new MockAnalyzer();
    const result = await mock.analyze(Buffer.from("any"));

    expect(result.name).toBe("Mock Item");
    expect(result.confidence).toBe(1.0);
    expect(result.estimatedValue).toBe("25.00");
    expect(result.valueConfidence).toBe("high");
  });

  it("should expose capabilities", () => {
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
