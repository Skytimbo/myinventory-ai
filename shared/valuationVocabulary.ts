/**
 * Controlled valuation vocabularies (valuation-v4). Dependency-free so the
 * analyzer and standalone tools can use them without loading the database schema.
 */

/** What an estimated range describes */
export const VALUATION_SCOPES = ["item", "category"] as const;
export type ValuationScope = (typeof VALUATION_SCOPES)[number];

/**
 * Assumptions behind an estimate. The model chooses only as_is_untested; the
 * server derives unattributed (iff scope is "category") and
 * visible_condition_only (every estimate is photo-based).
 */
export const VALUATION_ASSUMPTIONS = ["as_is_untested", "unattributed", "visible_condition_only"] as const;
export type ValuationAssumption = (typeof VALUATION_ASSUMPTIONS)[number];
