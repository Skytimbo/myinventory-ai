/* scripts/reset-inventory.ts
 *
 * Truncates the inventory_items table (removes all rows, keeps schema).
 * Uses DATABASE_URL from .env to connect to Neon PostgreSQL.
 */
import 'dotenv/config';
import { getPgPoolFromUrl } from './_db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  console.error('Please ensure .env file exists with DATABASE_URL defined.');
  process.exit(1);
}

async function main() {
  console.log('Connecting to database...');

  // Parse URL to show which database we're connecting to (without credentials)
  const dbUrl = new URL(url);
  console.log(`Database: ${dbUrl.hostname}${dbUrl.pathname}`);

  const pool = getPgPoolFromUrl(url);
  const client = await pool.connect();

  try {
    console.log('Truncating inventory_items table...');
    await client.query('TRUNCATE TABLE inventory_items;');
    console.log('');
    console.log('Inventory reset complete.');
  } catch (err) {
    console.error('ERROR: Failed to truncate inventory_items:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
