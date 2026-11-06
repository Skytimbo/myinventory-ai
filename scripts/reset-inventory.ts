/* scripts/reset-inventory.ts
 *
 * Truncates the inventory_items table (removes all rows, keeps schema).
 * Local databases only (fail-closed); the target is verified before truncating.
 */
import 'dotenv/config';
import { connectLocalDatabase, exitWithSafeError } from './_localDb';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  console.error('Please ensure .env file exists with DATABASE_URL defined.');
  process.exit(1);
}

async function main() {
  console.log('Connecting to database...');
  const { pool, client } = await connectLocalDatabase(url, 'truncate inventory_items');

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

main().catch(exitWithSafeError);
