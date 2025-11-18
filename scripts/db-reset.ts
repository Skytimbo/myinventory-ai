/* scripts/db-reset.ts */
import 'dotenv/config';
import { getPgPoolFromUrl } from './_db';

const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL_TEST or DATABASE_URL must be set');
  process.exit(1);
}

async function main() {
  const pool = getPgPoolFromUrl(url);
  const client = await pool.connect();
  try {
    console.log('🗑️  Resetting database...');
    await client.query('BEGIN');

    await client.query(`DROP TABLE IF EXISTS inventory_items CASCADE;`);
    console.log('✓ Dropped inventory_items table');

    await client.query(`
      CREATE TABLE inventory_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        tags TEXT,
        image_url TEXT,
        image_urls TEXT[],
        barcode_data TEXT,
        estimated_value DECIMAL(10, 2),
        value_confidence TEXT,
        value_rationale TEXT,
        location TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created inventory_items table');

    await client.query('COMMIT');
    console.log('✅ Database reset complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database reset failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
