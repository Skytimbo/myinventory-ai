import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const projectId = process.env.OPENAI_PROJECT_ID;

// Validate environment variables at startup
if (!apiKey || apiKey === "__REPLACE_WITH_YOUR_OPENAI_KEY__") {
  console.warn("⚠️  WARNING: OPENAI_API_KEY is not set or still has placeholder value. AI analysis will fail.");
}

// Fast-fail validation: project-scoped keys (sk-proj-*) require OPENAI_PROJECT_ID
if (apiKey && apiKey.startsWith("sk-proj-") && !projectId) {
  throw new Error(
    "OPENAI_PROJECT_ID is required when using project-scoped API keys (sk-proj-*).\n" +
    "Please set OPENAI_PROJECT_ID in your environment variables.\n" +
    "Find your project ID at: https://platform.openai.com/settings/organization/projects"
  );
}

// Cheap model client (for gpt-4o-mini)
export const openaiCheap = new OpenAI({
  apiKey: apiKey!,
  baseURL: baseUrl,
  project: projectId,
});

// Premium model client (for gpt-4o / gpt-5)
export const openaiPremium = new OpenAI({
  apiKey: apiKey!,
  baseURL: baseUrl,
  project: projectId,
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
