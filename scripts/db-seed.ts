/* scripts/db-seed.ts */
import 'dotenv/config';
import { getPgPoolFromUrl } from './_db';
import { randomUUID } from 'crypto';

const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL_TEST or DATABASE_URL must be set');
  process.exit(1);
}

const items = [
  { name: 'Cordless Drill', category: 'Tools', location: 'Garage' },
  { name: 'Camping Stove', category: 'Outdoors', location: 'Shed' },
  { name: 'Acoustic Guitar', category: 'Music', location: 'Living Room' },
];

async function main() {
  const pool = getPgPoolFromUrl(url);
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding database...');
    await client.query('BEGIN');

    for (const it of items) {
      await client.query(
        `INSERT INTO inventory_items
          (id, name, description, category, tags, image_url, barcode_data, estimated_value, value_confidence, value_rationale, location)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          randomUUID(),
          it.name,
          `${it.name} description`,
          it.category,
          JSON.stringify([]),
          `/objects/items/${randomUUID()}.jpg`,
          `INV-${Date.now()}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
          100.0,
          'low',
          'Seed data',
          it.location,
        ],
      );
      console.log(`✓ Inserted: ${it.name}`);
    }

    await client.query('COMMIT');
    console.log(`✅ Seeded ${items.length} test items`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database seeding failed:', err);
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
