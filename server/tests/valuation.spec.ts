import { describe, expect, it } from "vitest";
import type { Valuation } from "@shared/schema";
import {
  describeValuation,
  getIdentificationStatus,
  VALUATION_CSV_HEADERS,
  valuationCsvCells,
  getValuationView,
  summarizeValuations,
} from "@shared/valuation";

function createValuation(overrides: Partial<Valuation> = {}): Valuation {
  return {
    status: "estimated",
    marketability: "marketable",
    marketabilityReason: "Branded power tools have an active secondhand market",
    currency: "USD",
    low: "40.00",
    likely: "55.00",
    high: "70.00",
    confidence: "medium",
    rationale: "Common cordless drill model in used condition",
    missingInformation: [],
    evidence: { basis: "model_judgment", note: "No marketplace data was retrieved." },
    basedOn: { name: "Cordless Drill", category: "Tools", identifiedAt: null },
    model: "gpt-4o",
    evaluatedAt: "2026-10-23T00:00:00.000Z",
    promptVersion: "valuation-v1",
    staleAt: null,
    staleReason: null,
    ...overrides,
  };
}

const noLegacy = { estimatedValue: null, valueConfidence: null, valueRationale: null };

describe("getValuationView", () => {
  it("treats a missing valuation as not evaluated, never as zero", () => {
    const view = getValuationView({ valuation: null, ...noLegacy });

    expect(view.status).toBe("not_evaluated");
    expect(view.currentValue).toBeNull();
    expect(view.isCurrentEstimate).toBe(false);
    expect(view.legacy).toBeNull();
  });

  it("keeps legacy amounts accessible without promoting them to current estimates", () => {
    const view = getValuationView({
      valuation: null,
      estimatedValue: "125.00",
      valueConfidence: "medium",
      valueRationale: "Based on similar vintage cameras on eBay",
    });

    expect(view.status).toBe("not_evaluated");
    expect(view.isCurrentEstimate).toBe(false);
    expect(view.currentValue).toBeNull();
    expect(view.legacy).toEqual({
      amount: "125.00",
      confidence: "medium",
      rationale: "Based on similar vintage cameras on eBay",
      isPlaceholder: false,
    });
  });

  it("flags legacy 0.00 values without confidence as placeholders", () => {
    const view = getValuationView({
      valuation: null,
      estimatedValue: "0.00",
      valueConfidence: null,
      valueRationale: null,
    });

    expect(view.legacy?.isPlaceholder).toBe(true);
    expect(view.status).toBe("not_evaluated");
  });

  it.each([
    ["0.00 with low confidence", "0.00", "low"],
    ["0.00 with high confidence", "0.00", "high"],
    ["a negative amount", "-5.00", "medium"],
  ])("treats a legacy %s as an ambiguous placeholder", (_label, amount, confidence) => {
    const view = getValuationView({
      valuation: null,
      estimatedValue: amount,
      valueConfidence: confidence,
      valueRationale: "Common rock",
    });

    expect(view.legacy).toMatchObject({ amount, confidence, isPlaceholder: true });
    expect(view.status).toBe("not_evaluated");
    expect(summarizeValuations([{ valuation: null, estimatedValue: amount, valueConfidence: confidence, valueRationale: null }]).legacyOnlyCount).toBe(0);
  });

  it("keeps a valid positive legacy estimate as a non-placeholder", () => {
    expect(
      getValuationView({ valuation: null, estimatedValue: "0.01", valueConfidence: "low", valueRationale: null })
        .legacy?.isPlaceholder
    ).toBe(false);
  });

  it("reports a legacy amount alongside a newer valuation without mixing them", () => {
    const view = getValuationView({
      valuation: createValuation(),
      estimatedValue: "125.00",
      valueConfidence: "high",
      valueRationale: null,
    });

    expect(view.currentValue).toBe(55);
    expect(view.legacy?.amount).toBe("125.00");
  });

  it("counts a fresh estimate as current", () => {
    const view = getValuationView({ valuation: createValuation(), ...noLegacy });

    expect(view.status).toBe("estimated");
    expect(view.isCurrentEstimate).toBe(true);
    expect(view.currentValue).toBe(55);
  });

  it("never counts a stale estimate as current", () => {
    const view = getValuationView({
      valuation: createValuation({
        staleAt: "2026-10-24T00:00:00.000Z",
        staleReason: "reidentified",
      }),
      ...noLegacy,
    });

    expect(view.status).toBe("estimated");
    expect(view.isStale).toBe(true);
    expect(view.isCurrentEstimate).toBe(false);
    expect(view.currentValue).toBeNull();
  });

  it.each(["nonmarketable", "insufficient_information"] as const)(
    "gives %s valuations no current value",
    (status) => {
      const view = getValuationView({
        valuation: createValuation({ status, low: null, likely: null, high: null, confidence: null }),
        ...noLegacy,
      });

      expect(view.status).toBe(status);
      expect(view.currentValue).toBeNull();
    }
  );
});

describe("summarizeValuations", () => {
  it("buckets item, category, and unrecorded-basis estimates; counts each item once", () => {
    const item = (likely: string) => createValuation({ likely, scope: "item", assumptions: ["as_is_untested", "visible_condition_only"] });
    const category = (likely: string) =>
      createValuation({ likely, scope: "category", confidence: "low", assumptions: ["unattributed", "visible_condition_only"] });
    const summary = summarizeValuations([
      { valuation: item("55.00"), ...noLegacy },
      { valuation: item("20.00"), ...noLegacy },
      { valuation: category("6.00"), ...noLegacy },
      // v2/v3 estimate: no recorded basis, excluded from the combined total
      { valuation: createValuation({ likely: "40.00" }), ...noLegacy },
      // stale v4 estimate, and a current estimate that also carries a legacy amount
      { valuation: { ...item("900.00"), staleAt: "2026-10-24T00:00:00.000Z" }, ...noLegacy },
      { valuation: item("10.00"), estimatedValue: "125.00", valueConfidence: "medium", valueRationale: null },
      { valuation: null, estimatedValue: "300.00", valueConfidence: "high", valueRationale: null },
      { valuation: null, estimatedValue: "0.00", valueConfidence: null, valueRationale: null },
      { valuation: null, ...noLegacy },
      {
        valuation: createValuation({ status: "nonmarketable", low: null, likely: null, high: null, scope: null, assumptions: [] }),
        ...noLegacy,
      },
      {
        valuation: createValuation({
          status: "insufficient_information",
          low: null,
          likely: null,
          high: null,
          scope: null,
          assumptions: [],
        }),
        ...noLegacy,
      },
    ]);

    expect(summary).toEqual({
      itemTotal: 85,
      itemCount: 3,
      categoryTotal: 6,
      categoryCount: 1,
      combinedTotal: 91,
      combinedCount: 4,
      unrecordedTotal: 40,
      unrecordedCount: 1,
      staleCount: 1,
      legacyOnlyCount: 1,
      notEvaluatedCount: 3,
      nonmarketableCount: 1,
      insufficientCount: 1,
    });
    // 11 items: every one lands in exactly one of these buckets
    expect(
      summary.itemCount + summary.categoryCount + summary.unrecordedCount + summary.staleCount +
        summary.notEvaluatedCount + summary.nonmarketableCount + summary.insufficientCount
    ).toBe(11);
  });

  it("reports no combined total when only unrecorded-basis estimates exist", () => {
    const summary = summarizeValuations([{ valuation: createValuation({ likely: "40.00" }), ...noLegacy }]);

    expect(summary).toMatchObject({ combinedTotal: 0, combinedCount: 0, unrecordedCount: 1 });
  });
});

describe("valuation scope and historical records", () => {
  it.each([
    ["v4 item estimate", { scope: "item" as const }, "item"],
    ["v4 category baseline", { scope: "category" as const, confidence: "low" as const }, "category"],
    ["v2/v3 estimate without scope", {}, "unrecorded"],
  ])("reads a %s", (_label, overrides, scope) => {
    expect(getValuationView({ valuation: createValuation(overrides), ...noLegacy }).scope).toBe(scope);
  });

  it("keeps the scope of a stale estimate but never counts it", () => {
    const view = getValuationView({
      valuation: createValuation({ scope: "category", staleAt: "2026-10-24T00:00:00.000Z" }),
      ...noLegacy,
    });

    expect(view).toMatchObject({ scope: "category", isStale: true, isCurrentEstimate: false });
  });

  it("gives non-estimated and v1 legacy records no scope", () => {
    expect(getValuationView({ valuation: null, estimatedValue: "125.00", valueConfidence: "medium", valueRationale: null }).scope).toBeNull();
    expect(
      getValuationView({
        valuation: createValuation({ status: "nonmarketable", low: null, likely: null, high: null }),
        ...noLegacy,
      }).scope
    ).toBeNull();
  });

  it("describes each scope and its assumptions without implying an appraisal", () => {
    const item = describeValuation(
      getValuationView({
        valuation: createValuation({ scope: "item", confidence: "low", assumptions: ["as_is_untested", "visible_condition_only"] }),
        ...noLegacy,
      })
    );
    const category = describeValuation(
      getValuationView({
        valuation: createValuation({ scope: "category", confidence: "low", assumptions: ["unattributed", "visible_condition_only"] }),
        ...noLegacy,
      })
    );
    const unrecorded = describeValuation(getValuationView({ valuation: createValuation(), ...noLegacy }));

    expect(item).toMatch(/^Item estimate: /);
    expect(item).toContain("Functionality untested (unknown, not known to be faulty)");
    expect(category).toMatch(/^Category baseline: /);
    expect(category).toContain("excludes any maker, collectible, authenticity, or provenance premium");
    expect(unrecorded).toMatch(/^Basis not recorded: /);
    for (const text of [item, category, unrecorded]) {
      expect(text).toContain("indicative AI judgment, not an appraisal");
    }
  });

  it("exports scope and assumptions as CSV cells, blank when not estimated", () => {
    const header = VALUATION_CSV_HEADERS;
    const cells = valuationCsvCells({
      valuation: createValuation({ scope: "category", confidence: "low", assumptions: ["unattributed", "visible_condition_only"] }),
      ...noLegacy,
    });
    const oldCells = valuationCsvCells({ valuation: createValuation(), ...noLegacy });
    const none = valuationCsvCells({ valuation: null, ...noLegacy });

    expect(cells[header.indexOf("Valuation Scope")]).toBe("category");
    expect(cells[header.indexOf("Assumptions")]).toBe("unattributed; visible_condition_only");
    expect(oldCells[header.indexOf("Valuation Scope")]).toBe("unrecorded");
    expect(oldCells[header.indexOf("Assumptions")]).toBe("");
    expect(none[header.indexOf("Valuation Scope")]).toBe("");
  });
});

describe("getIdentificationStatus", () => {
  it("recognizes items identified under the current contract", () => {
    expect(
      getIdentificationStatus({
        identification: {
          confidence: 0.9,
          uncertainty: "low",
          notes: null,
          alternatives: [],
          model: "gpt-4o-mini",
          identifiedAt: "2026-10-23T00:00:00.000Z",
          promptVersion: "identify-v1",
        },
        analysisMetadata: null,
      })
    ).toBe("identified");
  });

  it("treats Quick Capture and failed-AI items as unidentified", () => {
    expect(
      getIdentificationStatus({ identification: null, analysisMetadata: { model: "none" } })
    ).toBe("unidentified");
    expect(
      getIdentificationStatus({
        identification: null,
        analysisMetadata: {
          model: "openai",
          note: "AI analysis unavailable. Please update details manually.",
        },
      })
    ).toBe("unidentified");
  });

  it("treats older AI-analyzed items as legacy identifications", () => {
    expect(
      getIdentificationStatus({ identification: null, analysisMetadata: { model: "openai" } })
    ).toBe("legacy");
    expect(getIdentificationStatus({ identification: null, analysisMetadata: null })).toBe(
      "legacy"
    );
  });
});
