/* scripts/_db.ts */
import { Pool } from 'pg';

/**
 * Select a DB client for scripts.
 * - If CI or localhost → use node-postgres Pool over TCP.
 * - If NEON_HTTP_URL is set → throw for now (we only support TCP in scripts).
 * You can extend later to support @neondatabase/serverless.
 */
export function getPgPoolFromUrl(url: string) {
  if (!url) throw new Error('DATABASE_URL_TEST is required');
  const u = new URL(url);
  // Prefer TCP for CI or localhost
  const isCI = !!process.env.CI;
  const isLocalhost = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (isCI || isLocalhost) {
    return new Pool({ connectionString: url });
  }
  // Fallback: try TCP as well (works with most managed Postgres, including Neon TCP URLs)
  return new Pool({
    connectionString: url,
    ssl: /neon\.tech$/.test(u.hostname) ? { rejectUnauthorized: false } : undefined
  });
}
