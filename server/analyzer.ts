/**
 * IAnalyzer Interface & Implementations
 *
 * This module provides:
 * - IAnalyzer interface for pluggable AI image analysis
 * - OpenAIAnalyzer: Production implementation using OpenAI vision models
 * - MockAnalyzer: Testing implementation with deterministic output
 *
 * Identification and valuation are separate operations (migration 0003).
 * Identification never produces monetary values.
 */

import type OpenAI from "openai";
import {
  VALUATION_ASSUMPTIONS,
  VALUATION_SCOPES,
  type ValuationAssumption,
  type ValuationScope,
} from "../shared/valuationVocabulary";

export const IDENTIFY_PROMPT_VERSION = "identify-v3";
export const IDENTIFY_MODEL_CHEAP = "gpt-4o-mini";
export const IDENTIFY_MODEL_PREMIUM = "gpt-4o";
export const VALUATION_PROMPT_VERSION = "valuation-v4";
export const VALUATION_MODEL = "gpt-4o";

/** Upper bound for a plausible household-inventory estimate (USD) */
const MAX_ESTIMATE_USD = 10_000_000;

/** Below this confidence the cheap model's answer is retried on the premium model */
const PREMIUM_FALLBACK_THRESHOLD = 0.4;

/** Maximum number of item photos sent to the model per request */
export const MAX_AI_IMAGES = 4;

const CATEGORIES = [
  "Electronics",
  "Clothing",
  "Furniture",
  "Collectibles",
  "Antiques",
  "Books",
  "Tools",
  "Kitchen",
  "Household",
  "Sports",
  "Toys",
  "Natural Objects",
  "Other",
];

/**
 * Capabilities that an analyzer may support
 * Used for feature discovery at runtime
 */
export interface AnalyzerCapabilities {
  /** Can detect multiple items in a single image */
  supportsMultiItem?: boolean;
  /** Can analyze video frames (future) */
  supportsVideo?: boolean;
  /** Maximum image size in bytes */
  maxImageSize?: number;
}

/**
 * Result of identifying an item. Contains no monetary fields.
 */
export interface IdentificationResult {
  name: string;
  description: string;
  category: string;
  tags: string[];
  /** 0..1, how sure the model is about what the item is */
  confidence: number;
  /** What is uncertain and what would help, or null */
  notes: string | null;
  /** Other plausible identifications */
  alternatives: string[];
  model: string;
  promptVersion: string;
  raw: unknown;
}

/** What the valuation model is told about the item */
export interface ValuationInput {
  images: Buffer[];
  name: string;
  description: string;
  category: string;
  identificationNotes: string | null;
}

/**
 * Result of the Estimate Value action after server-side validation.
 * Amounts are non-null only when status is "estimated".
 */
export interface ValuationResult {
  status: "estimated" | "nonmarketable" | "insufficient_information";
  marketability: "marketable" | "nonmarketable" | "uncertain";
  marketabilityReason: string;
  low: string | null;
  likely: string | null;
  high: string | null;
  confidence: "low" | "medium" | "high" | null;
  rationale: string;
  missingInformation: string[];
  /** "item" or "category" when estimated; null otherwise */
  scope: ValuationScope | null;
  /** Final assumptions, including server-derived ones; [] when not estimated */
  assumptions: ValuationAssumption[];
  model: string;
  promptVersion: string;
  raw: unknown;
}

/**
 * Strategy interface for image analysis
 * Implementations can use different AI providers (OpenAI, Claude, local models, etc.)
 */
export interface IAnalyzer {
  /** Identify the item shown in one or more photos of the same item */
  identify(images: Buffer[]): Promise<IdentificationResult>;

  /** Assess marketability, then estimate secondhand resale value or explain why not */
  estimateValue(input: ValuationInput): Promise<ValuationResult>;

  /** Query what this analyzer supports */
  readonly capabilities: AnalyzerCapabilities;
}

/**
 * OpenAI-based image analyzer
 *
 * Identification uses a tiered approach:
 * 1. Try gpt-4o-mini first (cheap, fast)
 * 2. If confidence < 0.4, fallback to gpt-4o (premium, accurate)
 */
export class OpenAIAnalyzer implements IAnalyzer {
  readonly capabilities: AnalyzerCapabilities = {
    supportsMultiItem: false,
    maxImageSize: 20 * 1024 * 1024, // 20MB
  };

  constructor(
    private openaiCheap: OpenAI,
    private openaiPremium: OpenAI
  ) {}

  async identify(images: Buffer[]): Promise<IdentificationResult> {
    const cheap = await this.identifyWithModel(
      this.openaiCheap,
      IDENTIFY_MODEL_CHEAP,
      images
    );

    if (cheap.confidence >= PREMIUM_FALLBACK_THRESHOLD) {
      return cheap;
    }

    return this.identifyWithModel(this.openaiPremium, IDENTIFY_MODEL_PREMIUM, images);
  }

  async estimateValue(input: ValuationInput): Promise<ValuationResult> {
    const { parsed, response } = await requestJson(
      this.openaiPremium,
      VALUATION_MODEL,
      input.images,
      getValuationPrompt(input)
    );

    return {
      ...parseValuation(parsed),
      model: VALUATION_MODEL,
      promptVersion: VALUATION_PROMPT_VERSION,
      raw: response,
    };
  }

  private async identifyWithModel(
    client: OpenAI,
    model: string,
    images: Buffer[]
  ): Promise<IdentificationResult> {
    const { parsed, response } = await requestJson(client, model, images, getIdentifyPrompt());

    return {
      ...parseIdentification(parsed, model === IDENTIFY_MODEL_PREMIUM ? 0.9 : 0.4),
      model,
      promptVersion: IDENTIFY_PROMPT_VERSION,
      raw: response,
    };
  }
}

/**
 * Normalize a model's identification JSON. Only known fields are read, so any
 * price-like fields the model volunteers are dropped.
 */
export function parseIdentification(
  parsed: Record<string, unknown>,
  defaultConfidence: number
): Omit<IdentificationResult, "model" | "promptVersion" | "raw"> {
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    : [];

  return {
    name: cleanText(parsed.name, 120) || "Item",
    description: stripMonetarySentences(cleanText(parsed.description, 1000)) || "Unknown item",
    category: cleanText(parsed.category, 60) || "Uncategorized",
    tags: Array.from(new Set(tags)).slice(0, 10),
    confidence:
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : defaultConfidence,
    notes: stripMonetarySentences(cleanText(parsed.uncertaintyNotes, 500)) || null,
    alternatives: Array.isArray(parsed.possibleAlternatives)
      ? parsed.possibleAlternatives
          .filter((alt): alt is string => typeof alt === "string" && alt.trim() !== "")
          .map((alt) => alt.trim())
          .slice(0, 3)
      : [],
  };
}

const VALUATION_STATUSES = ["estimated", "nonmarketable", "insufficient_information"] as const;
const MARKETABILITY = ["marketable", "nonmarketable", "uncertain"] as const;
const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

/** Model output that violates the valuation contract; nothing is saved */
export class InvalidValuationError extends Error {
  constructor(reason: string) {
    super(`AI returned an invalid valuation: ${reason}`);
    this.name = "InvalidValuationError";
  }
}

/**
 * Which marketability judgments each status may accompany. "estimated" needs a
 * market; "nonmarketable" is exactly the nonmarketable judgment; an item can
 * have (or possibly have) a market yet still lack enough information to price.
 */
const ALLOWED_MARKETABILITY: Record<
  (typeof VALUATION_STATUSES)[number],
  readonly (typeof MARKETABILITY)[number][]
> = {
  estimated: ["marketable"],
  nonmarketable: ["nonmarketable"],
  insufficient_information: ["marketable", "uncertain"],
};

/**
 * Validate a model's valuation JSON against the contract.
 *
 * Throws InvalidValuationError (so nothing is saved) instead of reinterpreting
 * contradictory output. The server never synthesizes a status: "nonmarketable"
 * and "insufficient_information" are only ever the model's explicit judgments.
 * - status and marketability must be valid and consistent with each other
 * - "estimated" needs a valid confidence and low <= likely <= high, all > 0
 * - other statuses must not carry any amount
 * Sentences claiming sales data was consulted are still removed, since none is.
 */
export function parseValuation(
  parsed: Record<string, unknown>
): Omit<ValuationResult, "model" | "promptVersion" | "raw"> {
  const status = pickEnum(parsed.status, VALUATION_STATUSES);
  if (!status) {
    throw new InvalidValuationError("unknown status");
  }

  const marketability = pickEnum(parsed.marketability, MARKETABILITY);
  if (!marketability) {
    throw new InvalidValuationError("missing or unknown marketability");
  }
  if (!ALLOWED_MARKETABILITY[status].includes(marketability)) {
    throw new InvalidValuationError(
      `status "${status}" contradicts marketability "${marketability}"`
    );
  }

  let amounts: { low: string; likely: string; high: string } | null = null;
  let confidence: (typeof CONFIDENCE_LEVELS)[number] | null = null;
  // Scope and assumptions sent with a non-estimated outcome are ignored
  let scope: ValuationScope | null = null;
  let assumptions: ValuationAssumption[] = [];

  if (status === "estimated") {
    const low = parseAmount(parsed.low);
    const likely = parseAmount(parsed.likely);
    const high = parseAmount(parsed.high);
    if (low === null || likely === null || high === null) {
      throw new InvalidValuationError("estimate without a positive low, likely, and high amount");
    }
    if (!(low <= likely && likely <= high)) {
      throw new InvalidValuationError("estimate range is not ordered low <= likely <= high");
    }
    confidence = pickEnum(parsed.confidence, CONFIDENCE_LEVELS);
    if (!confidence) {
      throw new InvalidValuationError("estimate without a valid confidence");
    }
    amounts = { low: low.toFixed(2), likely: likely.toFixed(2), high: high.toFixed(2) };

    scope = pickEnum(parsed.scope, VALUATION_SCOPES);
    if (!scope) {
      throw new InvalidValuationError("estimate without a valid scope (item or category)");
    }
    if (scope === "category" && confidence === "high") {
      throw new InvalidValuationError("a category baseline cannot have high confidence");
    }
    assumptions = deriveAssumptions(scope, parsed.assumptions);
  } else if ([parsed.low, parsed.likely, parsed.high].some(isProvided)) {
    throw new InvalidValuationError(`status "${status}" must not include any amount`);
  }

  const missingInformation = Array.isArray(parsed.missingInformation)
    ? parsed.missingInformation
        .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
        .map((entry) => entry.trim().slice(0, 200))
        .slice(0, 5)
    : [];

  return {
    status,
    marketability,
    marketabilityReason: stripEvidenceClaims(cleanText(parsed.marketabilityReason, 500)),
    low: amounts?.low ?? null,
    likely: amounts?.likely ?? null,
    high: amounts?.high ?? null,
    confidence,
    rationale:
      stripEvidenceClaims(cleanText(parsed.rationale, 1000)) ||
      "Model judgment based on the photos and identification.",
    missingInformation,
    scope,
    assumptions,
  };
}

/**
 * Final assumptions for an estimate. The model may choose only
 * as_is_untested; unattributed is derived from scope "category" and
 * visible_condition_only applies to every photo-based estimate. Unknown
 * tokens, a non-array value, and unattributed on an item estimate are invalid.
 */
function deriveAssumptions(scope: ValuationScope, raw: unknown): ValuationAssumption[] {
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    throw new InvalidValuationError("assumptions must be a list");
  }
  const chosen = new Set<ValuationAssumption>();
  for (const token of (raw as unknown[] | null | undefined) ?? []) {
    const assumption = pickEnum(token, VALUATION_ASSUMPTIONS);
    if (!assumption) {
      throw new InvalidValuationError(`unknown assumption ${JSON.stringify(token)}`);
    }
    if (assumption === "unattributed" && scope === "item") {
      throw new InvalidValuationError('an item estimate cannot be "unattributed"; use scope "category"');
    }
    chosen.add(assumption);
  }
  if (scope === "category") {
    chosen.add("unattributed");
  }
  chosen.add("visible_condition_only");
  return VALUATION_ASSUMPTIONS.filter((assumption) => chosen.has(assumption));
}

const EVIDENCE_CLAIM_PATTERN =
  /\b(ebay|etsy|craigslist|facebook marketplace|worthpoint|sold listings?|completed listings?|comparable sales|comps|recent sales|auction results?|price guides?|I (checked|searched|looked up|found|reviewed))\b/i;

/** Remove sentences that claim external sales data was consulted; none is retrieved */
export function stripEvidenceClaims(text: string): string {
  if (!text) {
    return text;
  }
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !EVIDENCE_CLAIM_PATTERN.test(sentence))
    .join(" ")
    .trim();
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** A positive USD amount, or null when missing, zero, negative, non-numeric, or implausible */
function parseAmount(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[$,\s]/g, ""))
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_ESTIMATE_USD) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

/** Any amount field the model filled in, including 0 */
function isProvided(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/** Map identification confidence to the uncertainty level shown to users */
export function confidenceToUncertainty(confidence: number): "low" | "medium" | "high" {
  if (confidence >= 0.75) {
    return "low";
  }
  if (confidence >= 0.45) {
    return "medium";
  }
  return "high";
}

const MONEY_PATTERN = /(\$\s?\d)|(\b\d[\d,.]*\s?(usd|dollars?)\b)|\b(worth|valued at|resale value|sells? for)\b/i;

/** Remove sentences that state a price or value; identification must not carry money */
export function stripMonetarySentences(text: string): string {
  if (!text) {
    return text;
  }
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !MONEY_PATTERN.test(sentence))
    .join(" ")
    .trim();
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function requestJson(
  client: OpenAI,
  model: string,
  images: Buffer[],
  prompt: string
): Promise<{ parsed: Record<string, unknown>; response: unknown }> {
  if (images.length === 0) {
    throw new Error("At least one image is required");
  }

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [
          ...images.slice(0, MAX_AI_IMAGES).map((image) => ({
            type: "image_url" as const,
            image_url: {
              url: `data:${detectImageMime(image)};base64,${image.toString("base64")}`,
            },
          })),
          {
            type: "text" as const,
            text: prompt,
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1000,
    temperature: 0,
    seed: 42,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from AI");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI returned an unexpected response shape");
  }

  return { parsed: parsed as Record<string, unknown>, response };
}

function detectImageMime(image: Buffer): string {
  if (image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (
    image.subarray(0, 4).toString("ascii") === "RIFF" &&
    image.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

function getIdentifyPrompt(): string {
  return `You are identifying a physical item for a personal home inventory. All attached photos show the same item.

Return JSON with exactly these fields:
{
  "name": "Short, specific name. Include the manufacturer, model, or series when it is legible on the item (e.g. 'DeWalt XRP 18V cordless drill'); otherwise a plain generic name.",
  "description": "1-2 sentences describing only what the photos show: shape, color, legible markings, visible condition.",
  "category": "One of: ${CATEGORIES.join(", ")}",
  "tags": ["3-8 lowercase searchable tags: legible brand, model, or series, and other visible facts only; no inferred qualities such as handcrafted or antique"],
  "confidence": 0.0-1.0 (how sure you are about what the item is),
  "uncertaintyNotes": "null, or one or two sentences on what is uncertain or only inferred, and what photo would help (e.g. 'Maker's mark not visible; a photo of the underside would help.')",
  "possibleAlternatives": ["up to 3 other plausible identifications; empty if confident"]
}

Rules:
- Identify only. Do not estimate price, value, or worth, and do not mention money.
- Read legible markings first: printed, molded, or engraved text such as manufacturer, model, series, voltage, capacity, or size. Clearly legible text is visible evidence, not a guess. Use it in the name, mention it in the description, and add it to the tags.
- Separate what is visible from what is inferred. State as fact only what the photos directly show. Do not assert manufacturing process (e.g. hand-carved, hand-thrown), surface treatment (e.g. polished, restored), age, specific materials (e.g. the species of a fur or wood), provenance, cultural origin, or interior construction (e.g. a lining) unless it is directly visible. This applies to the name, description, and tags alike. If one of these is a plausible inference, put it in uncertaintyNotes as a possibility instead of stating it.
- Do not invent brands, models, makers, dates, or origins that are not legible or clearly recognizable. When nothing identifying is legible, prefer an accurate generic name ("Hand-thrown ceramic bowl") over a guessed specific one.
- Name ordinary natural objects plainly (e.g. "River rock", "Pinecone").
- If the photo is unclear, say so in uncertaintyNotes and lower confidence.`;
}

function getValuationPrompt(input: ValuationInput): string {
  return `You are giving an indicative private-party secondhand resale value for an item in a personal home inventory: roughly what a private seller could expect from a used sale. It is not an insurance appraisal, retail price, replacement cost, or a valuation from verified comparable sales. The attached photos show the item. It was identified as:
- Name: ${input.name}
- Category: ${input.category}
- Description: ${input.description || "(none)"}
- Identification notes: ${input.identificationNotes || "(none)"}

Work in this order:
1. Marketability. Is there a realistic secondhand market where someone would pay money for this specific item? Ordinary natural objects (rocks, sticks, shells), worn-out or disposable goods, and items nobody buys used are "nonmarketable". If the item cannot be pinned down precisely enough to judge whether it would sell at all (for example an antique whose maker, age, or authenticity is not visible), use "uncertain".
2. Baseline before provenance. When an object has an ordinary secondhand market independent of its maker or provenance, assess whether the available evidence supports a defensible baseline resale range. If it does, provide a conservative range, explicitly excluding unverified collectible or provenance premiums, and list the maker, provenance, or other unverified factors in missingInformation. If the evidence is insufficient even for that baseline, return "insufficient_information" and identify the missing evidence. Being in a marketable category alone does not require a price.
   If you judged this specific item "marketable", an unknown maker, a partly visible model number, or unverified working condition is not by itself a reason for "insufficient_information": give a conservative, possibly wide baseline range with low confidence, and list those factors in missingInformation. Reserve "insufficient_information" for items whose basic identity, usability, authenticity, material, or permissibility of sale cannot be judged from the photos, and for the excluded classes below when no item estimate is supportable.
3. Scope of the estimate:
   - "item": the identification is specific (a legible brand, model, or series, or a clearly identifiable product) and the range reflects that specific item.
   - "category": the type of object is clear but its maker, model, or provenance is not. The range is a conservative baseline for a typical unattributed used item of that type, excluding any maker, collectible, authenticity, or provenance premium; list what would allow an item estimate (for example a maker's mark) in missingInformation.
   Never use "category" for antiques, art, jewelry, precious metals, or items made of fur, hide, ivory, feathers, or other animal materials: their value is not a typical baseline. For these, give an "item" estimate only if the item itself supports one; otherwise use "insufficient_information".
4. Then choose exactly one outcome:
   - "estimated": marketability "marketable"; a defensible indicative range for a typical private-party used sale in the visible condition, with a scope.
   - "nonmarketable": marketability "nonmarketable"; no realistic resale market. Give no price and no scope.
   - "insufficient_information": marketability "marketable" or "uncertain"; not even a category baseline can be judged from these photos. Give no price and no scope, and list the specific evidence that would be needed.

Return JSON with exactly these fields:
{
  "marketability": "marketable" | "nonmarketable" | "uncertain",
  "marketabilityReason": "One sentence.",
  "status": "estimated" | "nonmarketable" | "insufficient_information",
  "scope": "item" | "category" | null,
  "assumptions": ["as_is_untested"] or [],
  "low": "USD decimal string, or null",
  "likely": "USD decimal string, or null",
  "high": "USD decimal string, or null",
  "confidence": "low" | "medium" | "high" | null,
  "rationale": "1-2 sentences explaining your judgment. Name the scope; for a category baseline, say that it excludes any maker, collectible, or provenance premium.",
  "missingInformation": ["specific evidence that would make the estimate possible or more reliable, e.g. a clearer photo of a label, or confirmation that it works"]
}

Rules:
- You have NOT looked up any listings, sales, auctions, or price guides. Do not claim or imply that you checked eBay, sold listings, comparable sales, or any other data source, and do not invent comparable sales, marketplace research, or pricing evidence. Describe your reasoning as your own judgment.
- Never use 0 to mean unknown. If you cannot give a price, use null and the matching status.
- Do not invent a price for a nonmarketable item.
- "as_is_untested" means functionality is unknown, not known to be faulty. Include it when the item has a powered or mechanical function that cannot be verified from the photos. The range must reflect that it may or may not work; do not price it as defective or for parts unless the photos show damage. Do not include any other assumption; the server records the rest.
- Tools and electronics: working condition and battery health are usually unverified from photos. Price the item as untested or as-is with low or medium confidence (functionality unknown, not known to be faulty), list them in missingInformation, and do not use "high" confidence while functionality or condition is unverified.
- A "category" baseline must use "low" or "medium" confidence, never "high".
- Items of fur, hide, feathers, ivory, or other animal materials: do not identify the species or material beyond what is visible, and do not state that resale restrictions apply. If the material, origin, or permissibility of resale is uncertain and matters to value, list it in missingInformation as something to verify.
- Be conservative: private-party used prices, not retail. Prefer an honest wide range over false precision.`;
}

/**
 * Mock analyzer for local runs without OpenAI (ANALYZER_PROVIDER=mock)
 * Returns deterministic results without making API calls
 */
export class MockAnalyzer implements IAnalyzer {
  readonly capabilities: AnalyzerCapabilities = {
    supportsMultiItem: false,
  };

  async identify(_images: Buffer[]): Promise<IdentificationResult> {
    return {
      name: "Mock Item",
      description: "Mock description for testing",
      category: "Test",
      tags: ["mock", "test"],
      confidence: 1.0,
      notes: null,
      alternatives: [],
      model: "mock",
      promptVersion: IDENTIFY_PROMPT_VERSION,
      raw: null,
    };
  }

  async estimateValue(_input: ValuationInput): Promise<ValuationResult> {
    return {
      status: "estimated",
      marketability: "marketable",
      marketabilityReason: "Mock marketability for testing",
      low: "15.00",
      likely: "25.00",
      high: "35.00",
      confidence: "medium",
      rationale: "Mock valuation for testing",
      missingInformation: [],
      scope: "item",
      assumptions: ["visible_condition_only"],
      model: "mock",
      promptVersion: VALUATION_PROMPT_VERSION,
      raw: null,
    };
  }
}

/**
 * Health check for OpenAI API connectivity
 * Used by /api/health endpoint
 */
export async function openAIHealthCheck(
  openaiClient: OpenAI
): Promise<{ ok: boolean; error?: string }> {
  try {
    await openaiClient.models.list();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
