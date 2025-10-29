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
              text: `Analyze this image and provide detailed information about the object shown. Return your response as a JSON object with the following fields:
- name: A clear, concise name for the item (e.g., "Vintage Leather Backpack")
- description: A detailed description of the item, including its appearance, condition, and notable features (2-3 sentences)
- category: The primary category (e.g., "Electronics", "Furniture", "Clothing", "Kitchen", "Books", "Toys", "Sports", "Tools", "Decor")
- tags: An array of 3-5 relevant tags for searching and filtering (e.g., ["vintage", "leather", "backpack", "travel"])
- estimatedValue: An estimated resale value in USD as a number (e.g., "45.00"). Be realistic based on the item's condition and type.

Focus on being accurate and helpful. If you can't determine something with confidence, make a reasonable estimate.`,
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
