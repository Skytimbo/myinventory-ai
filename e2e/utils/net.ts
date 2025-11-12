import type { Page } from '@playwright/test';

/**
 * Wire up network debugging to log browser console, errors, and all network requests
 * Useful for diagnosing why routes aren't matching or pages aren't loading
 *
 * Note: Uses events instead of routing to avoid interfering with route() stubs
 */
export function wireNetworkDebug(page: Page) {
  // Log browser console messages
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[BROWSER ${type.toUpperCase()}]`, text);
  });

  // Log browser errors
  page.on('pageerror', error => {
    console.log('[BROWSER ERROR]', error.message);
    console.log(error.stack);
  });

  // Log all network requests using events (doesn't interfere with route() handlers)
  page.on('request', request => {
    const method = request.method();
    const url = request.url();
    console.log(`[REQ] ${method} ${url}`);
  });

  // Log all network responses
  page.on('response', response => {
    const status = response.status();
    const url = response.url();
    console.log(`[RES] ${status} ${url}`);
  });
}
