import OpenAI from "openai";

console.log("[ENV DEBUG]", {
  OPENAI_API_KEY_exists: !!process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  AI_INTEGRATIONS_OPENAI_API_KEY_exists: !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  AI_INTEGRATIONS_OPENAI_BASE_URL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
});

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

// Validate environment variables at startup
if (!apiKey || apiKey === "REPLACE_ME") {
  console.warn("⚠️  WARNING: OPENAI_API_KEY is not set or still has placeholder value. AI analysis will fail.");
}
if (!process.env.OPENAI_BASE_URL) {
  console.warn("⚠️  WARNING: OPENAI_BASE_URL is not set. Defaulting to OpenAI API.");
}

// Cheap model client (for gpt-4o-mini)
export const openaiCheap = new OpenAI({
  apiKey: apiKey!,
  baseURL: baseUrl,
});

// Premium model client (for gpt-4o / gpt-5)
export const openaiPremium = new OpenAI({
  apiKey: apiKey!,
  baseURL: baseUrl,
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
