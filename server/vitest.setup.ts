import { config } from 'dotenv';
import path from 'path';

// Load .env file from project root
config({ path: path.resolve(__dirname, '../.env') });

// Fallback for test-specific DATABASE_URL if not in .env
if (!process.env.DATABASE_URL) {
  // Use a test database URL or the same as development
  console.warn('[vitest-setup] DATABASE_URL not found in .env, tests may fail');
}
