/**
 * Valuation and identification views (migration 0003)
 *
 * Single place that interprets stored data for display, totals, and export:
 * - A missing valuation is "not_evaluated", never $0.
 * - Legacy amounts (pre-0003 combined analysis) stay accessible but are never
 *   treated as current valuations.
 * - Stale valuations (identification rerun since) never count as current.
 * - Every estimate is an indicative private-party secondhand resale value.
 *   Estimates made before valuation-v4 have no recorded scope and are shown
 *   as "basis not recorded", never reclassified.
 */

import type { AnalysisMetadata, Identification, Valuation } from "./schema";
import type { ValuationAssumption } from "./valuationVocabulary";

/** Scope of an estimate as displayed; "unrecorded" = estimated before valuation-v4 */
export type EstimateScope = "item" | "category" | "unrecorded";

export type ValueStatus =
  | "not_evaluated"
  | "estimated"
  | "nonmarketable"
  | "insufficient_information";

export interface LegacyEstimate {
  amount: string;
  confidence: string | null;
  rationale: string | null;
  /**
   * Amount <= 0 (or unreadable), whatever confidence was recorded. The old
   * combined analysis used 0 ambiguously, so it is not treated as a valuation.
   */
  isPlaceholder: boolean;
}

export interface ValuationView {
  status: ValueStatus;
  valuation: Valuation | null;
  isStale: boolean;
  /** True only for a current, non-stale estimate under the new contract */
  isCurrentEstimate: boolean;
  /** Likely value in USD when isCurrentEstimate, otherwise null */
  currentValue: number | null;
  /** Scope when status is "estimated" (stale or not); null otherwise */
  scope: EstimateScope | null;
  legacy: LegacyEstimate | null;
}

type ValuationFields = {
  valuation?: Valuation | null;
  estimatedValue?: string | null;
  valueConfidence?: string | null;
  valueRationale?: string | null;
};

export function getValuationView(item: ValuationFields): ValuationView {
  const valuation = item.valuation ?? null;
  const legacy = getLegacyEstimate(item);

  if (!valuation) {
    return {
      status: "not_evaluated",
      valuation: null,
      isStale: false,
      isCurrentEstimate: false,
      currentValue: null,
      scope: null,
      legacy,
    };
  }

  const isStale = Boolean(valuation.staleAt);
  const likely = parseAmount(valuation.likely);
  const isCurrentEstimate =
    valuation.status === "estimated" && !isStale && likely !== null;

  return {
    status: valuation.status,
    valuation,
    isStale,
    isCurrentEstimate,
    currentValue: isCurrentEstimate ? likely : null,
    scope: valuation.status === "estimated" ? getEstimateScope(valuation) : null,
    legacy,
  };
}

function getEstimateScope(valuation: Valuation): EstimateScope {
  return valuation.scope === "item" || valuation.scope === "category" ? valuation.scope : "unrecorded";
}

function getLegacyEstimate(item: ValuationFields): LegacyEstimate | null {
  if (item.estimatedValue === null || item.estimatedValue === undefined) {
    return null;
  }

  const amount = parseAmount(item.estimatedValue);
  return {
    amount: item.estimatedValue,
    confidence: item.valueConfidence ?? null,
    rationale: item.valueRationale ?? null,
    isPlaceholder: amount === null || amount <= 0,
  };
}

export interface ValuationSummary {
  /** Current (non-stale) item-scope estimates: sum of likely values */
  itemTotal: number;
  itemCount: number;
  /** Current (non-stale) category baselines: sum of likely values */
  categoryTotal: number;
  categoryCount: number;
  /** itemTotal + categoryTotal; each item appears in at most one bucket */
  combinedTotal: number;
  combinedCount: number;
  /** Current estimates without a recorded basis (before valuation-v4); not in combinedTotal */
  unrecordedTotal: number;
  unrecordedCount: number;
  staleCount: number;
  legacyOnlyCount: number;
  notEvaluatedCount: number;
  nonmarketableCount: number;
  insufficientCount: number;
}

export function summarizeValuations(items: ValuationFields[]): ValuationSummary {
  const summary: ValuationSummary = {
    itemTotal: 0,
    itemCount: 0,
    categoryTotal: 0,
    categoryCount: 0,
    combinedTotal: 0,
    combinedCount: 0,
    unrecordedTotal: 0,
    unrecordedCount: 0,
    staleCount: 0,
    legacyOnlyCount: 0,
    notEvaluatedCount: 0,
    nonmarketableCount: 0,
    insufficientCount: 0,
  };

  // Each item has one current valuation, so it lands in exactly one branch
  for (const item of items) {
    const view = getValuationView(item);
    if (view.isStale) {
      summary.staleCount += 1;
    }

    if (view.isCurrentEstimate && view.currentValue !== null) {
      if (view.scope === "item") {
        summary.itemTotal += view.currentValue;
        summary.itemCount += 1;
      } else if (view.scope === "category") {
        summary.categoryTotal += view.currentValue;
        summary.categoryCount += 1;
      } else {
        summary.unrecordedTotal += view.currentValue;
        summary.unrecordedCount += 1;
      }
    } else if (view.status === "not_evaluated") {
      summary.notEvaluatedCount += 1;
      if (view.legacy && !view.legacy.isPlaceholder) {
        summary.legacyOnlyCount += 1;
      }
    } else if (view.status === "nonmarketable") {
      summary.nonmarketableCount += 1;
    } else if (view.status === "insufficient_information") {
      summary.insufficientCount += 1;
    }
  }

  summary.combinedTotal = summary.itemTotal + summary.categoryTotal;
  summary.combinedCount = summary.itemCount + summary.categoryCount;
  return summary;
}

export type IdentificationStatus = "identified" | "legacy" | "unidentified";

/**
 * - identified: Identify ran under the current contract
 * - legacy: identified by the pre-0003 combined analysis
 * - unidentified: Quick Capture, or AI identification failed at creation
 */
export function getIdentificationStatus(item: {
  identification?: Identification | null;
  analysisMetadata?: AnalysisMetadata | null;
}): IdentificationStatus {
  if (item.identification) {
    return "identified";
  }

  const metadata = item.analysisMetadata;
  if (metadata?.model === "none") {
    return "unidentified";
  }
  if (metadata?.note && /unavailable/i.test(metadata.note)) {
    return "unidentified";
  }

  return "legacy";
}

function parseAmount(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** "$1,234.50" for a decimal string; null when not a number */
export function formatUsd(amount: string | null | undefined): string | null {
  const value = parseAmount(amount);
  if (value === null) {
    return null;
  }
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export const VALUE_STATUS_LABELS: Record<ValueStatus, string> = {
  not_evaluated: "Not evaluated",
  estimated: "Estimated",
  nonmarketable: "No resale market",
  insufficient_information: "Value can't be established",
};

export const ESTIMATE_SCOPE_LABELS: Record<EstimateScope, string> = {
  item: "Item estimate",
  category: "Category baseline",
  unrecorded: "Basis not recorded",
};

export const ASSUMPTION_LABELS: Record<ValuationAssumption, string> = {
  as_is_untested: "Functionality untested (unknown, not known to be faulty)",
  unattributed: "Maker and provenance unknown; excludes any maker, collectible, authenticity, or provenance premium",
  visible_condition_only: "Condition judged from photos only",
};

/** Shown with every estimate */
export const INDICATIVE_VALUE_NOTE =
  "Indicative private-party resale value from photos (AI judgment). Not an appraisal, retail price, or replacement cost; condition, authenticity, and market were not verified.";

/** Readable assumptions for display, excluding the photo-only note shown globally */
export function describeAssumptions(assumptions: ValuationAssumption[] | undefined): string[] {
  return (assumptions ?? [])
    .filter((assumption) => assumption !== "visible_condition_only")
    .map((assumption) => ASSUMPTION_LABELS[assumption]);
}

/** One-line, human-readable description used by exports */
export function describeValuation(view: ValuationView): string {
  const valuation = view.valuation;
  let text = VALUE_STATUS_LABELS[view.status];

  if (valuation && view.status === "estimated") {
    const scope = view.scope ?? "unrecorded";
    const assumptions = describeAssumptions(valuation.assumptions);
    // Plain hyphen: jsPDF's standard fonts do not reliably render an en dash
    text = `${ESTIMATE_SCOPE_LABELS[scope]}: ${formatUsd(valuation.low)} - ${formatUsd(valuation.high)} (likely ${formatUsd(
      valuation.likely
    )}, ${valuation.confidence ?? "low"} confidence${
      assumptions.length ? `; assumes: ${assumptions.join("; ")}` : ""
    }; indicative AI judgment, not an appraisal)`;
  } else if (valuation && view.status === "insufficient_information" && valuation.missingInformation.length) {
    text += ` (needs: ${valuation.missingInformation.join(", ")})`;
  }

  if (view.isStale) {
    text += " [stale: item re-identified since]";
  }
  if (view.legacy && !view.legacy.isPlaceholder) {
    text += ` | Legacy estimate ${formatUsd(view.legacy.amount)} (old combined analysis, unverified)`;
  }
  return text;
}

export const VALUATION_CSV_HEADERS = [
  "Value Status",
  "Estimate Low",
  "Estimate Likely",
  "Estimate High",
  "Estimate Stale",
  "Evidence Basis",
  "Valuation Scope",
  "Assumptions",
  "Legacy Estimate",
];

/** CSV cells matching VALUATION_CSV_HEADERS; unknown values are blank, never 0 */
export function valuationCsvCells(item: ValuationFields): string[] {
  const view = getValuationView(item);
  return [
    view.status,
    view.valuation?.low ?? "",
    view.valuation?.likely ?? "",
    view.valuation?.high ?? "",
    view.isStale ? "yes" : "",
    view.valuation?.evidence.basis ?? "",
    view.scope ?? "",
    (view.valuation?.assumptions ?? []).join("; "),
    view.legacy?.amount ?? "",
  ];
}
