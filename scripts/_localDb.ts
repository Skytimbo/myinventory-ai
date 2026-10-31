/* scripts/_localDb.ts
 *
 * Fail-closed connection for database-management scripts: the URL must point
 * at PostgreSQL on this machine, and the connected server must confirm it is
 * local and not Neon, before any statement runs. No override exists.
 */
import { Pool, type PoolClient } from 'pg';
import { assertConnectedToLocalServer, assertLocalDatabaseUrl } from '../server/databaseTarget';

export async function connectLocalDatabase(
  url: string | undefined,
  purpose: string
): Promise<{ pool: Pool; client: PoolClient; database: string }> {
  const target = assertLocalDatabaseUrl(url, purpose);
  const pool = new Pool({ connectionString: url });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const database = await assertConnectedToLocalServer(client, purpose);
    console.log(`Target: local database "${database}" (${target.host}:${target.port})`);
    return { pool, client, database };
  } catch (error) {
    client?.release();
    await pool.end();
    throw error;
  }
}

/** Print a guard refusal (never a connection string) and exit non-zero */
export function exitWithSafeError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exit(1);
}
