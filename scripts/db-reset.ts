/* scripts/db-reset.ts
 *
 * Resets the MyInventory-AI environment to a clean slate:
 * 1. Truncates inventory_items table (removes all rows, keeps schema)
 * 2. Clears uploaded images from local storage
 *
 * Works identically on local development and Railway deployment.
 * Uses DATABASE_URL from environment/.env automatically.
 *
 * Usage: pnpm db:reset
 */
import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { getPgPoolFromUrl } from './_db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  console.error('Please ensure .env file exists with DATABASE_URL defined.');
  process.exit(1);
}

// Determine uploads directory (same logic as server/objectStorage.ts)
function getUploadsDir(): string {
  const customDir = process.env.LOCAL_STORAGE_DIR;
  if (customDir) {
    // Handle relative paths
    if (customDir.startsWith('./') || customDir.startsWith('../')) {
      return path.join(process.cwd(), customDir);
    }
    return customDir;
  }
  return path.join(process.cwd(), 'uploads');
}

async function clearUploads(): Promise<void> {
  const uploadsDir = getUploadsDir();
  const itemsDir = path.join(uploadsDir, 'items');

  try {
    // Check if items directory exists
    await fs.access(itemsDir);

    // Get all files/directories in items/
    const entries = await fs.readdir(itemsDir, { withFileTypes: true });

    let cleared = 0;
    for (const entry of entries) {
      const entryPath = path.join(itemsDir, entry.name);
      if (entry.isDirectory()) {
        // Multi-image directories (PRD 0004)
        await fs.rm(entryPath, { recursive: true });
      } else {
        // Single image files
        await fs.unlink(entryPath);
      }
      cleared++;
    }

    console.log(`✓ Cleared ${cleared} items from uploads`);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.log('✓ No uploads directory to clear');
    } else {
      console.warn(`⚠️  Warning: Could not clear uploads: ${err.message}`);
    }
  }
}

async function truncateDatabase(): Promise<void> {
  // Parse URL to show which database we're connecting to (without credentials)
  const dbUrl = new URL(url);
  console.log(`Database: ${dbUrl.hostname}${dbUrl.pathname}`);

  const pool = getPgPoolFromUrl(url);
  const client = await pool.connect();

  try {
    // Use TRUNCATE with CASCADE to handle any foreign key constraints
    await client.query('TRUNCATE TABLE inventory_items CASCADE;');
    console.log('✓ Truncated inventory_items table');
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     MyInventory-AI Database Reset      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  // Step 1: Clear uploads
  console.log('Step 1: Clearing uploaded images...');
  await clearUploads();
  console.log('');

  // Step 2: Truncate database
  console.log('Step 2: Truncating database...');
  await truncateDatabase();
  console.log('');

  console.log('════════════════════════════════════════');
  console.log('RESET COMPLETE');
  console.log('════════════════════════════════════════');
  console.log('');
}

main().catch((e) => {
  console.error('');
  console.error('❌ Reset failed:', e.message || e);
  process.exit(1);
});
