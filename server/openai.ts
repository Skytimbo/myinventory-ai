import OpenAI from "openai";

// This is using Replit's AI Integrations service, which provides OpenAI-compatible API access without requiring your own OpenAI API key.
// Based on blueprint: javascript_openai_ai_integrations
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

export interface ImageAnalysisResult {
  name: string;
  description: string;
  category: string;
  tags: string[];
  estimatedValue: string;
  valueConfidence?: string;
  valueRationale?: string;
}

export async function analyzeImage(imageBase64: string): Promise<ImageAnalysisResult> {
  try {
    // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are an expert appraiser analyzing items for resale value estimation. Examine this image carefully and provide detailed, market-informed analysis.

CRITICAL ANALYSIS FACTORS:
1. **Brand Recognition**: Identify any visible brands, logos, or manufacturer marks. Premium brands command higher resale values.
2. **Condition Assessment**: Evaluate visible wear, damage, scratches, discoloration, or signs of use. Mint condition = highest value.
3. **Age & Vintage Status**: Determine if the item is new, used, vintage, or antique. Some items appreciate with age.
4. **Market Demand**: Consider current market trends and typical resale platforms (eBay, Facebook Marketplace, Poshmark, etc.)
5. **Completeness**: Note if accessories, original packaging, or documentation appear to be present.
6. **Rarity & Collectibility**: Identify if this is a common item or has collectible/limited edition characteristics.

RESALE VALUE ESTIMATION GUIDELINES:
- Electronics: Typically 30-60% of retail for used, consider depreciation and technology age
- Clothing/Fashion: Brand matters enormously (designer vs. fast fashion), condition critical
- Furniture: Assess quality, brand (IKEA vs. vintage/designer), condition, and local demand
- Collectibles/Vintage: Research current market values, rarity significantly affects price
- Books: First editions, signed copies, rare books command premium; mass market paperbacks minimal value
- Tools/Equipment: Professional-grade holds value better than consumer-grade
- Kitchen/Home: Brand recognition (KitchenAid, Le Creuset) affects resale significantly

Return your analysis as a JSON object with these fields:
- name: Specific item name including brand if visible (e.g., "Apple MacBook Pro 13-inch" or "IKEA Kallax Shelf")
- description: Detailed description including brand, model, visible condition, materials, and distinguishing features (3-4 sentences)
- category: Primary category (Electronics, Furniture, Clothing, Kitchen, Books, Toys, Sports, Tools, Decor, Collectibles, Jewelry, Art)
- tags: 4-6 relevant, searchable tags including brand, condition indicators, style/era, and use case
- estimatedValue: Realistic resale value in USD (format: "45.00"). Base this on current secondary market prices, NOT retail. Consider platform fees and negotiation room. Be conservative but fair.
- valueConfidence: Your confidence in the estimate (low/medium/high) based on visibility of key factors
- valueRationale: Brief 1-sentence explanation of the valuation (e.g., "Popular brand in good condition, high market demand")

Be thorough, realistic, and market-aware. Your estimates should reflect actual resale prices on platforms like eBay, Mercari, and Facebook Marketplace.`,
            },
            {
              type: "image_url",
              image_url: {
                url: imageBase64,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const result = JSON.parse(content);
    
    return {
      name: result.name || "Unknown Item",
      description: result.description || "No description available",
      category: result.category || "Uncategorized",
      tags: Array.isArray(result.tags) ? result.tags : [],
      estimatedValue: result.estimatedValue || "0.00",
      valueConfidence: result.valueConfidence || "medium",
      valueRationale: result.valueRationale || "Estimated based on typical market values",
    };
  } catch (error) {
    console.error("Error analyzing image:", error);
    
    // Fallback response
    return {
      name: "Item",
      description: "AI analysis temporarily unavailable. Please add details manually.",
      category: "Uncategorized",
      tags: [],
      estimatedValue: "0.00",
    };
  }
}
