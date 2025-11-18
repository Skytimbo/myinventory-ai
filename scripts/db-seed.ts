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
  { name: 'Cordless Drill', category: 'Tools', location: 'Garage', imageCount: 1 },
  { name: 'Camping Stove', category: 'Outdoors', location: 'Shed', imageCount: 1 },
  { name: 'Acoustic Guitar', category: 'Music', location: 'Living Room', imageCount: 1 },
  { name: 'Vintage Camera Collection', category: 'Photography', location: 'Office', imageCount: 3 }, // Multi-image test item
  { name: 'Toolbox Set', category: 'Tools', location: 'Garage', imageCount: 4 }, // Multi-image test item
  { name: 'Art Supply Bundle', category: 'Arts & Crafts', location: 'Studio', imageCount: 2 }, // Multi-image test item
];

async function main() {
  const pool = getPgPoolFromUrl(url);
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding database...');
    await client.query('BEGIN');

    for (const it of items) {
      const itemId = randomUUID();
      const imageCount = it.imageCount || 1;

      // Generate image URLs for multi-image items (PRD 0004)
      const imageUrls: string[] = [];
      for (let i = 0; i < imageCount; i++) {
        if (imageCount === 1) {
          // Legacy single-image format
          imageUrls.push(`/objects/items/${itemId}.jpg`);
        } else {
          // Multi-image format with index
          imageUrls.push(`/objects/items/${itemId}/${i}.jpg`);
        }
      }

      await client.query(
        `INSERT INTO inventory_items
          (id, name, description, category, tags, image_url, image_urls, barcode_data, estimated_value, value_confidence, value_rationale, location)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          itemId,
          it.name,
          `${it.name} description`,
          it.category,
          [],
          imageUrls[0], // Primary image
          imageUrls, // All images as array (pg driver handles conversion)
          `INV-${Date.now()}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
          100.0,
          'low',
          'Seed data',
          it.location,
        ],
      );
      console.log(`✓ Inserted: ${it.name} (${imageCount} image${imageCount > 1 ? 's' : ''})`);
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
