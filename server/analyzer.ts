/**
 * IAnalyzer Interface & Implementations (Architecture Refactoring)
 *
 * This module provides:
 * - IAnalyzer interface for pluggable AI image analysis
 * - OpenAIAnalyzer: Production implementation using GPT-4 Vision
 * - MockAnalyzer: Testing implementation with deterministic output
 *
 * The strategy pattern allows swapping AI providers without changing business logic.
 */

import type OpenAI from "openai";

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
 * Result of analyzing an image
 */
export interface AnalysisResult {
  name: string;
  description: string;
  category: string;
  tags: string[];
  confidence: number;
  estimatedValue: string | null;
  valueConfidence: "low" | "medium" | "high" | null;
  valueRationale: string | null;
  raw: unknown;
}

/**
 * Strategy interface for image analysis
 * Implementations can use different AI providers (OpenAI, Claude, local models, etc.)
 */
export interface IAnalyzer {
  /** Analyze an image buffer and return structured metadata */
  analyze(imageBuffer: Buffer): Promise<AnalysisResult>;

  /** Query what this analyzer supports */
  readonly capabilities: AnalyzerCapabilities;
}

/**
 * OpenAI-based image analyzer using GPT-4 Vision
 *
 * Uses a tiered approach:
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

  async analyze(imageBuffer: Buffer): Promise<AnalysisResult> {
    const cheap = await this.analyzeWithModel(
      this.openaiCheap,
      "gpt-4o-mini",
      imageBuffer
    );

    // Policy: if low confidence → fallback to premium model
    if (cheap.confidence >= 0.4) {
      return cheap;
    }

    return await this.analyzeWithModel(
      this.openaiPremium,
      "gpt-4o",
      imageBuffer
    );
  }

  private async analyzeWithModel(
    client: OpenAI,
    model: string,
    imageBuffer: Buffer
  ): Promise<AnalysisResult> {
    const isPremium = model === "gpt-4o";

    const prompt = isPremium
      ? this.getPremiumPrompt()
      : this.getCheapPrompt();

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url:
                  "data:image/jpeg;base64," + imageBuffer.toString("base64"),
              },
            },
            {
              type: "text",
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

    const parsed = JSON.parse(content);

    // Validate and normalize valueConfidence
    const validConfidences = ["low", "medium", "high"];
    const valueConfidence = validConfidences.includes(parsed.valueConfidence)
      ? (parsed.valueConfidence as "low" | "medium" | "high")
      : null;

    // Validate estimatedValue format (should be decimal string like "45.00")
    const estimatedValue =
      typeof parsed.estimatedValue === "string" &&
      /^\d+(\.\d{1,2})?$/.test(parsed.estimatedValue)
        ? parsed.estimatedValue.includes(".")
          ? parsed.estimatedValue
          : parsed.estimatedValue + ".00"
        : null;

    return {
      name: parsed.name || "Item",
      description: parsed.description || "Unknown item",
      category: parsed.category || "Uncategorized",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      confidence:
        typeof parsed.confidence === "number"
          ? parsed.confidence
          : isPremium
            ? 0.9
            : 0.4,
      estimatedValue,
      valueConfidence,
      valueRationale:
        typeof parsed.valueRationale === "string"
          ? parsed.valueRationale
          : null,
      raw: response,
    };
  }

  private getCheapPrompt(): string {
    return `Analyze this item image and return JSON with these fields:
{
  "name": "Short descriptive name for the item",
  "description": "Brief description of the item",
  "category": "Category (Electronics, Clothing, Furniture, Collectibles, Books, Tools, Kitchen, Sports, Toys, Other)",
  "tags": ["relevant", "searchable", "tags"],
  "confidence": 0.0-1.0,
  "estimatedValue": "USD resale value as decimal string (e.g., '45.00')",
  "valueConfidence": "low|medium|high",
  "valueRationale": "Brief 1-sentence explanation of the valuation"
}

For value estimation:
- Base on secondary market prices (eBay, Craigslist, Facebook Marketplace), NOT retail
- Be conservative - account for negotiation room and platform fees
- Consider: brand recognition, visible condition, age, market demand
- If unable to estimate confidently, use valueConfidence: "low"`;
  }

  private getPremiumPrompt(): string {
    return `Analyze this item image and return JSON with these fields:
{
  "name": "Short descriptive name for the item",
  "description": "Brief description of the item",
  "category": "Category (Electronics, Clothing, Furniture, Collectibles, Books, Tools, Kitchen, Sports, Toys, Other)",
  "tags": ["relevant", "searchable", "tags"],
  "confidence": 0.0-1.0,
  "estimatedValue": "USD resale value as decimal string (e.g., '45.00')",
  "valueConfidence": "low|medium|high",
  "valueRationale": "Brief 1-sentence explanation of the valuation"
}

For value estimation, consider these factors:
1. Brand Recognition - Known brands command higher prices
2. Condition Assessment - Visible wear, damage, or pristine state
3. Age & Vintage Status - Newer items vs collectible vintage
4. Market Demand - Current popularity and seasonal factors
5. Completeness - Missing parts or accessories reduce value
6. Rarity & Collectibility - Limited editions or discontinued items

Price guidance by category:
- Electronics: Depreciate 20-50% from retail, more for older tech
- Clothing: 10-30% of retail unless designer/vintage
- Furniture: 20-40% of retail, condition critical
- Collectibles: Research comparable sales carefully
- Books: Usually $1-10 unless rare/signed
- Tools: Hold value well if quality brand, 40-60% of retail

Base on secondary market prices (eBay sold listings, Craigslist, Facebook Marketplace), NOT retail.
Be conservative - account for negotiation room and platform fees.`;
  }
}

/**
 * Mock analyzer for testing
 * Returns deterministic results without making API calls
 */
export class MockAnalyzer implements IAnalyzer {
  readonly capabilities: AnalyzerCapabilities = {
    supportsMultiItem: false,
  };

  async analyze(_imageBuffer: Buffer): Promise<AnalysisResult> {
    return {
      name: "Mock Item",
      description: "Mock description for testing",
      category: "Test",
      tags: ["mock", "test"],
      confidence: 1.0,
      estimatedValue: "25.00",
      valueConfidence: "high",
      valueRationale: "Mock valuation for testing",
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
