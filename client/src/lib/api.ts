/**
 * Centralized error parser for API responses
 *
 * Handles both {error: string} and {message: string} formats
 * during transition period (until PRD 0002).
 *
 * @param response - The Response object from fetch
 * @returns The error message string
 *
 * @example
 * const response = await fetch('/api/items/123');
 * if (!response.ok) {
 *   const errorMsg = await parseError(response);
 *   console.error(errorMsg);
 * }
 */
export async function parseError(response: Response): Promise<string> {
  try {
    const json = await response.json();
    // Support both {error} and {message} during transition
    return json.error ?? json.message ?? 'Unknown error';
  } catch {
    // JSON parse failed, return generic error
    return 'Unknown error';
  }
}
