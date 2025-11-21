/**
 * OpenAI Environment Health Check
 *
 * Provides runtime diagnostics for OpenAI configuration without making API calls.
 * Used to debug Replit deployment environment variable issues.
 */

export interface OpenAIEnvHealth {
  OPENAI_API_KEY_exists: boolean;
  OPENAI_BASE_URL: string | null;
  effective_api_key_prefix: string | null;
  environment: string;
}

/**
 * Get OpenAI environment configuration status
 *
 * @returns Object with OpenAI environment diagnostics
 */
export function getOpenAIEnvHealth(): OpenAIEnvHealth {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL ?? null;
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  // Extract first 8 characters of API key for verification (if exists)
  const effectivePrefix = apiKey && apiKey.length >= 8
    ? apiKey.substring(0, 8)
    : null;

  return {
    OPENAI_API_KEY_exists: !!apiKey && apiKey !== '__REPLACE_WITH_YOUR_OPENAI_KEY__',
    OPENAI_BASE_URL: baseUrl,
    effective_api_key_prefix: effectivePrefix,
    environment: nodeEnv,
  };
}
