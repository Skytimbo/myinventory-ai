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

/**
 * Strategy interface for image analysis
 * Implementations can use different AI providers (OpenAI, Claude, local models, etc.)
 */
export interface IAnalyzer {
  /** Identify the item shown in one or more photos of the same item */
  identify(images: Buffer[]): Promise<IdentificationResult>;

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
