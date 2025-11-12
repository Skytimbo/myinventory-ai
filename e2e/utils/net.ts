import type { Page } from '@playwright/test';

/**
 * Wire up network debugging to log browser console, errors, and all network requests
 * Useful for diagnosing why routes aren't matching or pages aren't loading
 *
 * Note: Uses events instead of routing to avoid interfering with route() stubs
 *
 * Set DEBUG_E2E=1 environment variable to enable verbose request/response logging
 */
export function wireNetworkDebug(page: Page) {
  const debug = process.env.DEBUG_E2E === '1';

  // Always log browser console errors (important)
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[BROWSER ERROR]`, msg.text());
    } else if (debug) {
      const type = msg.type();
      const text = msg.text();
      console.log(`[BROWSER ${type.toUpperCase()}]`, text);
    }
  });

  // Always log browser page errors (important)
  page.on('pageerror', error => {
    console.log('[BROWSER ERROR]', error.message);
    if (debug) {
      console.log(error.stack);
    }
  });

  // Only log network requests/responses if DEBUG_E2E is set
  if (debug) {
    page.on('request', request => {
      const method = request.method();
      const url = request.url();
      console.log(`[REQ] ${method} ${url}`);
    });

    page.on('response', response => {
      const status = response.status();
      const url = response.url();
      console.log(`[RES] ${status} ${url}`);
    });
  }
}
