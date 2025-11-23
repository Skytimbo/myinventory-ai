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
  OPENAI_PROJECT_ID_exists: boolean;
  is_project_scoped_key: boolean;
  project_validation_status: 'ok' | 'missing_project_id' | 'not_required';
}

/**
 * Get OpenAI environment configuration status
 *
 * @returns Object with OpenAI environment diagnostics
 */
export function getOpenAIEnvHealth(): OpenAIEnvHealth {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL ?? null;
  const projectId = process.env.OPENAI_PROJECT_ID;
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  // Extract first 8 characters of API key for verification (if exists)
  const effectivePrefix = apiKey && apiKey.length >= 8
    ? apiKey.substring(0, 8)
    : null;

  // Detect project-scoped API keys (sk-proj-*)
  const isProjectScopedKey = !!apiKey && apiKey.startsWith('sk-proj-');
  const projectIdExists = !!projectId;

  // Determine validation status
  let projectValidationStatus: 'ok' | 'missing_project_id' | 'not_required';
  if (isProjectScopedKey && !projectIdExists) {
    projectValidationStatus = 'missing_project_id';
  } else if (isProjectScopedKey && projectIdExists) {
    projectValidationStatus = 'ok';
  } else {
    projectValidationStatus = 'not_required';
  }

  return {
    OPENAI_API_KEY_exists: !!apiKey && apiKey !== '__REPLACE_WITH_YOUR_OPENAI_KEY__',
    OPENAI_BASE_URL: baseUrl,
    effective_api_key_prefix: effectivePrefix,
    environment: nodeEnv,
    OPENAI_PROJECT_ID_exists: projectIdExists,
    is_project_scoped_key: isProjectScopedKey,
    project_validation_status: projectValidationStatus,
  };
}
