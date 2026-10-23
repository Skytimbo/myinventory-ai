import { describe, it, expect, vi, beforeEach } from "vitest";
import {
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
    premiumClient.chat.completions.create.mockResolvedValue(
      makeAIResponse({ status: "nonmarketable", marketability: "nonmarketable" })
    );

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
  describe("synthetic scenarios", () => {
    it("gives an ordinary river rock no price", () => {
      const result = parseValuation({
        marketability: "nonmarketable",
        marketabilityReason: "Ordinary river rocks are freely available and not bought used.",
        status: "nonmarketable",
        low: null,
        likely: null,
        high: null,
        confidence: null,
        rationale: "No realistic resale market.",
        missingInformation: [],
      });

      expect(result).toMatchObject({
        status: "nonmarketable",
        low: null,
        likely: null,
        high: null,
        confidence: null,
      });
    });

    it("drops an invented price when marketability is nonmarketable", () => {
      const result = parseValuation({
        marketability: "nonmarketable",
        status: "estimated",
        low: "1.00",
        likely: "2.00",
        high: "5.00",
        confidence: "low",
        rationale: "Decorative rock.",
      });

      expect(result.status).toBe("nonmarketable");
      expect(result.likely).toBeNull();
      expect(result.confidence).toBeNull();
    });

    it("estimates a branded tool as a range", () => {
      const result = parseValuation({
        marketability: "marketable",
        marketabilityReason: "Branded cordless drills have steady used demand.",
        status: "estimated",
        low: "40",
        likely: "55.5",
        high: "$70.00",
        confidence: "medium",
        rationale: "Used cordless drills of this type with a battery typically sell in this range.",
        missingInformation: ["battery condition"],
      });

      expect(result).toMatchObject({
        status: "estimated",
        low: "40.00",
        likely: "55.50",
        high: "70.00",
        confidence: "medium",
        missingInformation: ["battery condition"],
      });
    });

    it("estimates a generic household object with low confidence by default", () => {
      const result = parseValuation({
        marketability: "marketable",
        status: "estimated",
        low: 1,
        likely: 2,
        high: 4,
        rationale: "Plain mugs sell for very little secondhand.",
      });

      expect(result).toMatchObject({ status: "estimated", likely: "2.00", confidence: "low" });
    });

    it("reports insufficient information for an ambiguous antique without a price", () => {
      const result = parseValuation({
        marketability: "uncertain",
        marketabilityReason: "Value depends on maker and age, which are not visible.",
        status: "insufficient_information",
        low: "50.00",
        likely: "200.00",
        high: "800.00",
        confidence: "low",
        rationale: "Could range widely depending on maker.",
        missingInformation: ["maker's mark", "photo of the base", "professional appraisal"],
      });

      expect(result).toMatchObject({
        status: "insufficient_information",
        marketability: "uncertain",
        low: null,
        likely: null,
        high: null,
        confidence: null,
        missingInformation: ["maker's mark", "photo of the base", "professional appraisal"],
      });
    });
  });

  describe("unknown is never zero", () => {
    it.each([
      ["zero", { low: "0", likely: "0.00", high: "0" }],
      ["negative", { likely: "-5" }],
      ["missing", {}],
      ["non-numeric", { likely: "unknown" }],
    ])("downgrades an estimate with %s amounts to insufficient information", (_label, amounts) => {
      const result = parseValuation({
        marketability: "marketable",
        status: "estimated",
        confidence: "high",
        ...amounts,
      });

      expect(result.status).toBe("insufficient_information");
      expect(result.likely).toBeNull();
      expect(result.confidence).toBeNull();
    });
  });

  describe("range normalization", () => {
    it("fills a missing likely value with the midpoint", () => {
      expect(
        parseValuation({ status: "estimated", low: "10", high: "30" })
      ).toMatchObject({ low: "10.00", likely: "20.00", high: "30.00" });
    });

    it("widens a self-contradictory range to cover every amount and lowers confidence", () => {
      expect(
        parseValuation({
          status: "estimated",
          low: "90",
          likely: "500",
          high: "20",
          confidence: "high",
        })
      ).toMatchObject({ low: "20.00", likely: "500.00", high: "500.00", confidence: "low" });
    });

    it("caps confidence at low when marketability is uncertain", () => {
      expect(
        parseValuation({
          status: "estimated",
          marketability: "uncertain",
          likely: "40",
          confidence: "high",
        }).confidence
      ).toBe("low");
    });
  });

  describe("failures", () => {
    it.each([undefined, "unknown", "priced", 3])(
      "throws on invalid status %s so nothing is saved",
      (status) => {
        expect(() => parseValuation({ status, likely: "10" })).toThrow(
          "AI returned an invalid valuation status"
        );
      }
    );
  });

  describe("evidence claims", () => {
    it("removes claims of having checked sales data", () => {
      const result = parseValuation({
        status: "estimated",
        likely: "120",
        rationale:
          "Based on recent eBay sold listings, these cameras sell well. Working film cameras of this model are popular with hobbyists.",
        marketabilityReason: "I checked comparable sales. Film cameras have an active used market.",
      });

      expect(result.rationale).toBe(
        "Working film cameras of this model are popular with hobbyists."
      );
      expect(result.marketabilityReason).toBe("Film cameras have an active used market.");
    });

    it("falls back to an explicit model-judgment rationale when nothing remains", () => {
      expect(
        parseValuation({ status: "estimated", likely: "10", rationale: "Comparable sales show $10." })
          .rationale
      ).toBe("Model judgment based on the photos and identification.");
    });

    it.each([
      "There is an active secondhand marketplace for drills.",
      "A sturdy tool in good condition.",
    ])("keeps ordinary sentences: %s", (sentence) => {
      expect(stripEvidenceClaims(sentence)).toBe(sentence);
    });
  });
});
