import { openaiCheap, openaiPremium } from "./openai";

export interface AnalysisResult {
  name: string;
  description: string;
  category: string;
  tags: string[];
  confidence: number;
  estimatedValue: string | null;
  valueConfidence: string | null;
  valueRationale: string | null;
  raw: unknown;
}

export async function analyzeWithCheapModel(imageBuffer: Buffer): Promise<AnalysisResult> {
  // Use gpt-4o-mini for cost-effective analysis
  const response = await openaiCheap.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: "data:image/jpeg;base64," + imageBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: `Analyze this item image and return JSON with these fields:
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
- If unable to estimate confidently, use valueConfidence: "low"`,
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from AI");
  }

  const parsed = JSON.parse(content);

  // Validate and normalize valueConfidence
  const validConfidences = ["low", "medium", "high"];
  const valueConfidence = validConfidences.includes(parsed.valueConfidence)
    ? parsed.valueConfidence
    : null;

  // Validate estimatedValue format (should be decimal string like "45.00")
  const estimatedValue = typeof parsed.estimatedValue === "string" &&
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
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.4,
    estimatedValue,
    valueConfidence,
    valueRationale: typeof parsed.valueRationale === "string" ? parsed.valueRationale : null,
    raw: response,
  };
}

export async function analyzeWithPremiumModel(imageBuffer: Buffer): Promise<AnalysisResult> {
  // Use gpt-4o for higher quality analysis
  const response = await openaiPremium.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: "data:image/jpeg;base64," + imageBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: `Analyze this item image and return JSON with these fields:
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
Be conservative - account for negotiation room and platform fees.`,
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from AI");
  }

  const parsed = JSON.parse(content);

  // Validate and normalize valueConfidence
  const validConfidences = ["low", "medium", "high"];
  const valueConfidence = validConfidences.includes(parsed.valueConfidence)
    ? parsed.valueConfidence
    : null;

  // Validate estimatedValue format (should be decimal string like "45.00")
  const estimatedValue = typeof parsed.estimatedValue === "string" &&
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
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.9,
    estimatedValue,
    valueConfidence,
    valueRationale: typeof parsed.valueRationale === "string" ? parsed.valueRationale : null,
    raw: response,
  };
}

export async function analyzeImagePolicy(imageBuffer: Buffer): Promise<AnalysisResult> {
  const cheap = await analyzeWithCheapModel(imageBuffer);

  // Policy: if low confidence → fallback to premium model
  if (cheap.confidence >= 0.4) {
    return cheap;
  }

  return await analyzeWithPremiumModel(imageBuffer);
}
