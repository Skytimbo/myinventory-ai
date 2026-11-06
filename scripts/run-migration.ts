import 'dotenv/config';
import { connectLocalDatabase, exitWithSafeError } from './_localDb';
import fs from "fs";
import path from "path";

const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL_TEST or DATABASE_URL must be set');
  process.exit(1);
}

// Local databases only (fail-closed). Production schema changes use the
// reviewed Neon SQL Editor procedure in docs/AI-IDENTIFY-VALUATION.md.
async function main() {
  const { pool, client } = await connectLocalDatabase(url, 'run a migration');

  const migrationArg = process.argv[2] ?? "migrations/0001_uuid_default.sql";
  const migrationPath = path.isAbsolute(migrationArg)
    ? migrationArg
    : path.resolve(process.cwd(), migrationArg);
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  console.log(`Running migration: ${migrationPath}`);
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

main().catch(exitWithSafeError);
