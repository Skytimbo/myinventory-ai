import 'dotenv/config';
import { getPgPoolFromUrl } from './_db';
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL_TEST or DATABASE_URL must be set');
  process.exit(1);
}

async function main() {
  const pool = getPgPoolFromUrl(url);
  const client = await pool.connect();

  const migrationPath = path.join(__dirname, "../migrations/0001_uuid_default.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  console.log("Running migration...");
  console.log(migrationSql);

  try {
    await client.query('BEGIN');
    await client.query(migrationSql);
    await client.query('COMMIT');
    console.log("Migration completed successfully!");
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Migration failed:", error);
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
