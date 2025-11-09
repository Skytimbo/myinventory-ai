import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import 'dotenv/config';

/**
 * Reset test database - drops and recreates inventory_items table
 * Uses DATABASE_URL_TEST if available, otherwise DATABASE_URL
 */
async function resetDatabase() {
  const databaseUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL or DATABASE_URL_TEST environment variable is required");
  }

  console.log('🗑️  Resetting database...');

  const sqlClient = neon(databaseUrl);
  const db = drizzle(sqlClient);

  try {
    // Drop table if exists
    await db.execute(sql`DROP TABLE IF EXISTS inventory_items CASCADE`);
    console.log('✓ Dropped inventory_items table');

    // Recreate table with schema
    await db.execute(sql`
      CREATE TABLE inventory_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        tags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        image_url TEXT NOT NULL,
        barcode_data TEXT NOT NULL,
        estimated_value DECIMAL(10, 2),
        value_confidence TEXT,
        value_rationale TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created inventory_items table');

    console.log('✅ Database reset complete');
  } catch (error) {
    console.error('❌ Database reset failed:', error);
    process.exit(1);
  }
}

resetDatabase();
