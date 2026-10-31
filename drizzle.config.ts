import { assertLocalDatabaseUrl } from "./server/databaseTarget";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// drizzle-kit (pnpm db:push) changes schemas: local databases only, no override.
// Production schema changes use the reviewed Neon SQL Editor procedure.
assertLocalDatabaseUrl(process.env.DATABASE_URL, "run drizzle-kit");

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
