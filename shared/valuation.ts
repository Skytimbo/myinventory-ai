/**
 * Valuation and identification views (migration 0003)
 *
 * Single place that interprets stored data for display, totals, and export:
 * - A missing valuation is "not_evaluated", never $0.
 * - Legacy amounts (pre-0003 combined analysis) stay accessible but are never
 *   treated as current valuations.
 * - Stale valuations (identification rerun since) never count as current.
 */

import type { AnalysisMetadata, Identification, Valuation } from "./schema";

export type ValueStatus =
  | "not_evaluated"
  | "estimated"
  | "nonmarketable"
  | "insufficient_information";

export interface LegacyEstimate {
  amount: string;
  confidence: string | null;
  rationale: string | null;
  /** "0.00" with no confidence: an old placeholder, not a valuation */
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
    legacy,
  };
}

function getLegacyEstimate(item: ValuationFields): LegacyEstimate | null {
  if (item.estimatedValue === null || item.estimatedValue === undefined) {
    return null;
  }

  const confidence = item.valueConfidence ?? null;
  return {
    amount: item.estimatedValue,
    confidence,
    rationale: item.valueRationale ?? null,
    isPlaceholder: parseAmount(item.estimatedValue) === 0 && !confidence,
  };
}

export interface ValuationSummary {
  /** Sum of current (non-stale, new-contract) likely values */
  currentTotal: number;
  currentCount: number;
  staleCount: number;
  legacyOnlyCount: number;
  notEvaluatedCount: number;
  nonmarketableCount: number;
  insufficientCount: number;
}

export function summarizeValuations(items: ValuationFields[]): ValuationSummary {
  const summary: ValuationSummary = {
    currentTotal: 0,
    currentCount: 0,
    staleCount: 0,
    legacyOnlyCount: 0,
    notEvaluatedCount: 0,
    nonmarketableCount: 0,
    insufficientCount: 0,
  };

  for (const item of items) {
    const view = getValuationView(item);
    if (view.isStale) {
      summary.staleCount += 1;
    }

    if (view.isCurrentEstimate && view.currentValue !== null) {
      summary.currentTotal += view.currentValue;
      summary.currentCount += 1;
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

/** One-line, human-readable description used by exports */
export function describeValuation(view: ValuationView): string {
  const valuation = view.valuation;
  let text = VALUE_STATUS_LABELS[view.status];

  if (valuation && view.status === "estimated") {
    // Plain hyphen: jsPDF's standard fonts do not reliably render an en dash
    text = `${formatUsd(valuation.low)} - ${formatUsd(valuation.high)} (likely ${formatUsd(
      valuation.likely
    )}, ${valuation.confidence ?? "low"} confidence, AI judgment)`;
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
    view.legacy?.amount ?? "",
  ];
}
