import OpenAI from "openai";

// Validate environment variables at startup
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "REPLACE_ME") {
  console.warn("⚠️  WARNING: OPENAI_API_KEY is not set or still has placeholder value. AI analysis will fail.");
}
if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  console.warn("⚠️  WARNING: AI_INTEGRATIONS_OPENAI_BASE_URL is not set. Defaulting to OpenAI API.");
}

// Cheap model client (for gpt-4o-mini)
export const openaiCheap = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Premium model client (for gpt-4o / gpt-5)
export const openaiPremium = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
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

// Note: Image analysis is handled by analyzeImagePolicy() in modelPolicy.ts
// which uses a cost-efficient tiered approach (cheap model with premium fallback)
