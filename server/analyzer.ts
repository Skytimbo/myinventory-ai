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

export const IDENTIFY_PROMPT_VERSION = "identify-v1";
export const IDENTIFY_MODEL_CHEAP = "gpt-4o-mini";
export const IDENTIFY_MODEL_PREMIUM = "gpt-4o";
export const VALUATION_PROMPT_VERSION = "valuation-v1";
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

/**
 * Validate and normalize a model's valuation JSON.
 *
 * Throws when the outcome is unusable (unknown status), so nothing is saved.
 * Otherwise enforces the contract: marketability decides first, prices only
 * accompany "estimated", zero is never a price, and claims of having checked
 * sales data are removed.
 */
export function parseValuation(
  parsed: Record<string, unknown>
): Omit<ValuationResult, "model" | "promptVersion" | "raw"> {
  let status = pickEnum(parsed.status, VALUATION_STATUSES);
  if (!status) {
    throw new Error("AI returned an invalid valuation status");
  }

  const marketability =
    pickEnum(parsed.marketability, MARKETABILITY) ??
    (status === "estimated"
      ? "marketable"
      : status === "nonmarketable"
        ? "nonmarketable"
        : "uncertain");

  // Marketability is assessed first and wins over a contradictory status
  if (marketability === "nonmarketable") {
    status = "nonmarketable";
  }

  let confidence = pickEnum(parsed.confidence, CONFIDENCE_LEVELS);
  let rationale = stripEvidenceClaims(cleanText(parsed.rationale, 1000));
  const missingInformation = Array.isArray(parsed.missingInformation)
    ? parsed.missingInformation
        .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
        .map((entry) => entry.trim().slice(0, 200))
        .slice(0, 5)
    : [];

  let low: number | null = null;
  let likely: number | null = null;
  let high: number | null = null;

  if (status === "estimated") {
    const amounts = normalizeRange(
      parseAmount(parsed.low),
      parseAmount(parsed.likely),
      parseAmount(parsed.high)
    );

    if (!amounts) {
      // A price cannot be established; never fall back to $0
      status = "insufficient_information";
      rationale = [rationale, "The model did not provide a usable price range."]
        .filter(Boolean)
        .join(" ");
    } else {
      ({ low, likely, high } = amounts);
      // Uncertain marketability or a self-contradictory range is never more than low confidence
      confidence =
        marketability === "uncertain" || !amounts.consistent ? "low" : confidence ?? "low";
    }
  }

  if (status !== "estimated") {
    confidence = null;
  }

  return {
    status,
    marketability,
    marketabilityReason: stripEvidenceClaims(cleanText(parsed.marketabilityReason, 500)),
    low: formatAmount(low),
    likely: formatAmount(likely),
    high: formatAmount(high),
    confidence,
    rationale: rationale || "Model judgment based on the photos and identification.",
    missingInformation,
  };
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

function parseAmount(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.replace(/[$,\s]/g, ""))
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_ESTIMATE_USD) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function normalizeRange(
  low: number | null,
  likely: number | null,
  high: number | null
): { low: number; likely: number; high: number; consistent: boolean } | null {
  const known = [low, likely, high].filter((value): value is number => value !== null);
  if (known.length === 0) {
    return null;
  }

  const ordered = known.every((value, index) => index === 0 || known[index - 1] <= value);
  const center =
    likely ?? (low !== null && high !== null ? (low + high) / 2 : (low ?? high)!);

  // The range spans every amount given, so likely always falls inside it
  return {
    low: Math.min(...known),
    likely: Math.round(center * 100) / 100,
    high: Math.max(...known),
    consistent: ordered,
  };
}

function formatAmount(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
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
  "name": "Short, specific name. Include brand or model only if visible or clearly recognizable.",
  "description": "1-2 sentences describing what is visible: material, color, notable features, visible condition.",
  "category": "One of: ${CATEGORIES.join(", ")}",
  "tags": ["3-8", "lowercase", "searchable", "tags"],
  "confidence": 0.0-1.0 (how sure you are about what the item is),
  "uncertaintyNotes": "null, or one sentence on what is uncertain and what photo would help (e.g. 'Maker's mark not visible; a photo of the underside would help.')",
  "possibleAlternatives": ["up to 3 other plausible identifications; empty if confident"]
}

Rules:
- Identify only. Do not estimate price, value, or worth, and do not mention money.
- Do not invent brands, models, makers, dates, or origins that are not visible or clearly recognizable. Prefer an accurate generic name ("Hand-thrown ceramic bowl") over a guessed specific one.
- Name ordinary natural objects plainly (e.g. "River rock", "Pinecone").
- If the photo is unclear, say so in uncertaintyNotes and lower confidence.`;
}

function getValuationPrompt(input: ValuationInput): string {
  return `You are assessing the secondhand resale value of an item in a personal home inventory. The attached photos show the item. It was identified as:
- Name: ${input.name}
- Category: ${input.category}
- Description: ${input.description || "(none)"}
- Identification notes: ${input.identificationNotes || "(none)"}

Work in this order:
1. Marketability. Is there a realistic secondhand market where someone would pay money for this specific item? Ordinary natural objects (rocks, sticks, shells), worn-out or disposable goods, and items nobody buys used are "nonmarketable". If the item cannot be pinned down precisely enough to judge (for example an antique whose maker, age, or authenticity is not visible), use "uncertain".
2. Then choose exactly one outcome:
   - "estimated": marketable, and you can give a defensible range for a typical private-party used sale in the visible condition.
   - "nonmarketable": no realistic resale market. Give no price.
   - "insufficient_information": a value may exist but cannot be established from these photos. Give no price, and list what would be needed (e.g. "maker's mark", "model number", "photo of the underside", "professional appraisal").

Return JSON with exactly these fields:
{
  "marketability": "marketable" | "nonmarketable" | "uncertain",
  "marketabilityReason": "One sentence.",
  "status": "estimated" | "nonmarketable" | "insufficient_information",
  "low": "USD decimal string, or null",
  "likely": "USD decimal string, or null",
  "high": "USD decimal string, or null",
  "confidence": "low" | "medium" | "high" | null,
  "rationale": "1-2 sentences explaining your judgment.",
  "missingInformation": ["what would make the estimate possible or more reliable"]
}

Rules:
- You have NOT looked up any listings, sales, auctions, or price guides. Do not claim or imply that you checked eBay, sold listings, comparable sales, or any other data source. Describe your reasoning as your own judgment.
- Never use 0 to mean unknown. If you cannot give a price, use null and the matching status.
- Do not invent a price for a nonmarketable item.
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
