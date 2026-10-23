import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InvalidValuationError,
  OpenAIAnalyzer,
  parseValuation,
  stripEvidenceClaims,
  type ValuationInput,
} from "../analyzer";

/**
 * Estimate Value contract (migration 0003)
 *
 * Model output is mocked with synthetic responses. These tests check that
 * the server enforces the contract whatever the model returns; they do not
 * show how a real model judges real photos.
 */

function createMockClient() {
  return {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  } as unknown as { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
}

function makeAIResponse(fields: Record<string, unknown>) {
  return { choices: [{ message: { content: JSON.stringify(fields) } }] };
}

const input: ValuationInput = {
  images: [Buffer.from("synthetic-image")],
  name: "Item",
  description: "Synthetic item",
  category: "Other",
  identificationNotes: null,
};

/** A valid "estimated" response; tests override one field to break it */
function estimate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    marketability: "marketable",
    marketabilityReason: "Branded cordless drills have steady used demand.",
    status: "estimated",
    low: "40",
    likely: "55.5",
    high: "$70.00",
    confidence: "medium",
    rationale: "Used cordless drills of this type with a battery typically sell in this range.",
    missingInformation: ["battery condition"],
    ...overrides,
  };
}

function nonmarketable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    marketability: "nonmarketable",
    marketabilityReason: "Ordinary river rocks are freely available and not bought used.",
    status: "nonmarketable",
    low: null,
    likely: null,
    high: null,
    confidence: null,
    rationale: "No realistic resale market.",
    missingInformation: [],
    ...overrides,
  };
}

function insufficient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    marketability: "uncertain",
    marketabilityReason: "Value depends on maker and age, which are not visible.",
    status: "insufficient_information",
    low: null,
    likely: null,
    high: null,
    confidence: null,
    rationale: "Could range widely depending on maker.",
    missingInformation: ["maker's mark", "photo of the base", "professional appraisal"],
    ...overrides,
  };
}

describe("OpenAIAnalyzer.estimateValue", () => {
  let cheapClient: ReturnType<typeof createMockClient>;
  let premiumClient: ReturnType<typeof createMockClient>;
  let analyzer: OpenAIAnalyzer;

  beforeEach(() => {
    cheapClient = createMockClient();
    premiumClient = createMockClient();
    analyzer = new OpenAIAnalyzer(cheapClient as never, premiumClient as never);
  });

  it("uses the premium model with a marketability-first, no-claimed-evidence prompt", async () => {
    premiumClient.chat.completions.create.mockResolvedValue(makeAIResponse(nonmarketable()));

    const result = await analyzer.estimateValue({
      ...input,
      name: "Salt-glazed stoneware crock",
      identificationNotes: "Maker's mark not visible",
    });

    expect(cheapClient.chat.completions.create).not.toHaveBeenCalled();
    const args = premiumClient.chat.completions.create.mock.calls[0][0];
    const prompt = args.messages[0].content.find((part: { type: string }) => part.type === "text").text;
    expect(args.model).toBe("gpt-4o");
    expect(prompt).toContain("Salt-glazed stoneware crock");
    expect(prompt).toContain("Maker's mark not visible");
    expect(prompt.indexOf("Marketability")).toBeLessThan(prompt.indexOf('"estimated"'));
    expect(prompt).toContain("You have NOT looked up any listings");
    expect(prompt).toContain("Never use 0 to mean unknown");
    expect(result).toMatchObject({ model: "gpt-4o", promptVersion: "valuation-v1" });
  });

  it("rejects a zero-valued estimate from the model", async () => {
    premiumClient.chat.completions.create.mockResolvedValue(
      makeAIResponse(estimate({ low: "0", likely: "0", high: "0" }))
    );

    await expect(analyzer.estimateValue(input)).rejects.toBeInstanceOf(InvalidValuationError);
  });

  it("propagates API errors so nothing is saved", async () => {
    premiumClient.chat.completions.create.mockRejectedValue(new Error("Service unavailable"));

    await expect(analyzer.estimateValue(input)).rejects.toThrow("Service unavailable");
  });

  it("rejects malformed JSON", async () => {
    premiumClient.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: "Probably about $20" } }],
    });

    await expect(analyzer.estimateValue(input)).rejects.toThrow("AI returned invalid JSON");
  });
});

describe("parseValuation", () => {
  describe("valid outcomes stay distinct", () => {
    it("accepts an ordinary river rock as nonmarketable with no price", () => {
      expect(parseValuation(nonmarketable())).toMatchObject({
        status: "nonmarketable",
        marketability: "nonmarketable",
        low: null,
        likely: null,
        high: null,
        confidence: null,
      });
    });

    it("accepts a branded tool estimate as a positive ordered range", () => {
      expect(parseValuation(estimate())).toMatchObject({
        status: "estimated",
        marketability: "marketable",
        low: "40.00",
        likely: "55.50",
        high: "70.00",
        confidence: "medium",
        missingInformation: ["battery condition"],
      });
    });

    it("accepts a cheap generic household estimate", () => {
      expect(
        parseValuation(estimate({ low: 1, likely: 2, high: 4, confidence: "low" }))
      ).toMatchObject({ status: "estimated", low: "1.00", likely: "2.00", high: "4.00" });
    });

    it("accepts a sub-dollar estimate (positive is not zero)", () => {
      expect(
        parseValuation(estimate({ low: "0.25", likely: "0.50", high: "1" }))
      ).toMatchObject({ status: "estimated", likely: "0.50" });
    });

    it("accepts a flat range where low = likely = high", () => {
      expect(parseValuation(estimate({ low: "5", likely: "5", high: "5" }))).toMatchObject({
        low: "5.00",
        likely: "5.00",
        high: "5.00",
      });
    });

    it.each(["uncertain", "marketable"])(
      "accepts insufficient information with %s marketability and no price",
      (marketability) => {
        expect(parseValuation(insufficient({ marketability }))).toMatchObject({
          status: "insufficient_information",
          marketability,
          likely: null,
          confidence: null,
          missingInformation: ["maker's mark", "photo of the base", "professional appraisal"],
        });
      }
    );
  });

  describe("estimated without a valid positive range is invalid", () => {
    it.each([
      ["zero amounts", { low: "0", likely: "0.00", high: "0" }],
      ["a zero low", { low: "0" }],
      ["negative amounts", { low: "-10", likely: "-5", high: "-1" }],
      ["missing amounts", { low: undefined, likely: undefined, high: undefined }],
      ["null amounts", { low: null, likely: null, high: null }],
      ["a missing likely", { likely: undefined }],
      ["a missing high", { high: null }],
      ["non-numeric amounts", { likely: "unknown" }],
      ["partly numeric text", { likely: "55 dollars" }],
      ["an implausible amount", { high: "99999999" }],
      ["a reversed range", { low: "90", likely: "55", high: "20" }],
      ["likely above high", { likely: "500" }],
      ["likely below low", { likely: "10" }],
      ["no confidence", { confidence: undefined }],
      ["an unknown confidence", { confidence: "very high" }],
    ])("rejects an estimate with %s", (_label, overrides) => {
      expect(() => parseValuation(estimate(overrides))).toThrow(InvalidValuationError);
    });
  });

  describe("contradictory or incomplete status is invalid", () => {
    it.each([
      ["estimated + nonmarketable", estimate({ marketability: "nonmarketable" })],
      ["estimated + uncertain", estimate({ marketability: "uncertain" })],
      ["nonmarketable + marketable", nonmarketable({ marketability: "marketable" })],
      ["nonmarketable + uncertain", nonmarketable({ marketability: "uncertain" })],
      ["insufficient + nonmarketable", insufficient({ marketability: "nonmarketable" })],
      ["missing marketability", estimate({ marketability: undefined })],
      ["unknown marketability", nonmarketable({ marketability: "maybe" })],
    ])("rejects %s", (_label, output) => {
      expect(() => parseValuation(output)).toThrow(InvalidValuationError);
    });

    it.each([undefined, "unknown", "priced", 3])("rejects invalid status %s", (status) => {
      expect(() => parseValuation(estimate({ status }))).toThrow("unknown status");
    });
  });

  describe("prices never accompany other statuses", () => {
    it.each([
      ["nonmarketable with a price", nonmarketable({ likely: "5.00" })],
      ["nonmarketable with zero amounts", nonmarketable({ low: "0", likely: "0", high: "0" })],
      ["insufficient with a price range", insufficient({ low: "50", likely: "200", high: "800" })],
      ["insufficient with a zero amount", insufficient({ likely: 0 })],
    ])("rejects %s instead of dropping the amounts", (_label, output) => {
      expect(() => parseValuation(output)).toThrow("must not include any amount");
    });

    it("ignores a confidence level on non-estimated outcomes", () => {
      expect(parseValuation(nonmarketable({ confidence: "high" })).confidence).toBeNull();
    });
  });

  describe("evidence claims", () => {
    it("removes claims of having checked sales data", () => {
      const result = parseValuation(
        estimate({
          rationale:
            "Based on recent eBay sold listings, these cameras sell well. Working film cameras of this model are popular with hobbyists.",
          marketabilityReason: "I checked comparable sales. Film cameras have an active used market.",
        })
      );

      expect(result.rationale).toBe(
        "Working film cameras of this model are popular with hobbyists."
      );
      expect(result.marketabilityReason).toBe("Film cameras have an active used market.");
    });

    it("falls back to an explicit model-judgment rationale when nothing remains", () => {
      expect(parseValuation(estimate({ rationale: "Comparable sales show $10." })).rationale).toBe(
        "Model judgment based on the photos and identification."
      );
    });

    it.each([
      "There is an active secondhand marketplace for drills.",
      "A sturdy tool in good condition.",
    ])("keeps ordinary sentences: %s", (sentence) => {
      expect(stripEvidenceClaims(sentence)).toBe(sentence);
    });
  });
});
