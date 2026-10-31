import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import {
  assertConnectedToLocalServer,
  assertLocalDatabaseUrl,
  describeDatabaseUrl,
  isLocalDatabaseUrl,
  LocalDatabaseRequiredError,
} from "../databaseTarget";
import { chooseDatabaseDriver } from "../storage";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");
const SECRET = "s3cretPassw0rd";
// Neon-shaped and unresolvable remote targets; never real hosts
const NEON_URL = `postgresql://neondb_owner:${SECRET}@ep-fake-000000-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const REMOTE_URL = `postgresql://admin:${SECRET}@db.example.invalid:5432/prod`;

describe("describeDatabaseUrl / assertLocalDatabaseUrl", () => {
  it.each([
    "postgresql://localhost:5432/myinventory_dev",
    "postgres://user:pw@127.0.0.1/db",
    "postgresql://user@[::1]:5432/db",
    "postgresql://LOCALHOST/db",
    "postgresql:///myinventory_dev?host=/tmp",
  ])("accepts local target %s", (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
    expect(() => assertLocalDatabaseUrl(url, "test")).not.toThrow();
  });

  it.each([
    ["Neon", NEON_URL],
    ["remote host", REMOTE_URL],
    ["look-alike host", "postgresql://localhost.evil.example/db"],
    ["other loopback-looking name", "postgresql://127.0.0.1.nip.io/db"],
    ["host parameter redirect", "postgresql://localhost/db?host=prod.example.com"],
    ["empty", ""],
    ["unparseable", "not a url"],
    ["non-postgres scheme", "mysql://localhost/db"],
  ])("refuses %s, without echoing credentials", (_label, url) => {
    let error: unknown;
    try {
      assertLocalDatabaseUrl(url, "test");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LocalDatabaseRequiredError);
    expect(String(error)).not.toContain(SECRET);
    if (url) expect(String(error)).not.toContain(url);
  });

  it("describes host, port, and database only", () => {
    expect(describeDatabaseUrl(NEON_URL)).toEqual({
      host: "ep-fake-000000-pooler.c-3.us-east-1.aws.neon.tech",
      port: "5432",
      database: "neondb",
      local: false,
    });
  });
});

describe("chooseDatabaseDriver", () => {
  it("uses node-postgres only for local servers and keeps Neon HTTP for production", () => {
    expect(chooseDatabaseDriver("postgresql://localhost:5432/myinventory_dev")).toBe("node-postgres");
    expect(chooseDatabaseDriver(NEON_URL)).toBe("neon-http");
    expect(chooseDatabaseDriver(REMOTE_URL)).toBe("neon-http");
  });
});

describe("assertConnectedToLocalServer", () => {
  const client = (row: Record<string, unknown>) => ({ query: async () => ({ rows: [row] }) });

  it.each([
    ["Unix socket", null],
    ["IPv4 loopback", "127.0.0.1"],
    ["IPv6 loopback", "::1"],
  ])("accepts a server connected over %s", async (_label, address) => {
    await expect(
      assertConnectedToLocalServer(client({ database: "myinventory_dev", server_address: address, neon_timeline: null }), "test")
    ).resolves.toBe("myinventory_dev");
  });

  it("refuses a 'localhost' URL that actually reaches a remote server (tunnel or hosts file)", async () => {
    await expect(
      assertConnectedToLocalServer(client({ database: "neondb", server_address: "10.20.30.40", neon_timeline: null }), "test")
    ).rejects.toThrow("not a local server");
  });

  it("refuses any Neon server", async () => {
    await expect(
      assertConnectedToLocalServer(client({ database: "neondb", server_address: null, neon_timeline: "d96b4237" }), "test")
    ).rejects.toThrow("Neon database");
  });
});

describe("commands refuse non-local databases before connecting", () => {
  const tsx = path.join(ROOT, "node_modules/.bin/tsx");
  const run = (args: string[], env: Record<string, string>) =>
    execFileAsync(tsx, args, {
      cwd: ROOT,
      timeout: 20_000,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    }).then(
      (ok) => ({ code: 0, output: ok.stdout + ok.stderr }),
      (failed: { code: number; stdout: string; stderr: string }) => ({
        code: failed.code,
        output: failed.stdout + failed.stderr,
      })
    );

  it.each([
    ["db:reset", ["scripts/db-reset.ts"], { DATABASE_URL: NEON_URL }],
    ["reset-inventory", ["scripts/reset-inventory.ts"], { DATABASE_URL: NEON_URL }],
    ["db:seed", ["scripts/db-seed.ts"], { DATABASE_URL_TEST: REMOTE_URL }],
    ["run-migration", ["scripts/run-migration.ts", "migrations/0003_identify_valuation.sql"], { DATABASE_URL: NEON_URL }],
    ["restore:verify target", ["scripts/restore-verify.ts", "no-such-archive.tar.gz"], { DATABASE_URL_TEST: NEON_URL, RESTORE_UPLOADS_DIR: "/tmp/never-used" }],
    ["drizzle-kit config", ["-e", "import('./drizzle.config.ts')"], { DATABASE_URL: NEON_URL }],
    [
      "app start outside production",
      ["server/index.ts"],
      { DATABASE_URL: NEON_URL, NODE_ENV: "development", OPENAI_API_KEY: "test-placeholder", PORT: "0" },
    ],
  ])("%s", async (_label, args, env) => {
    const started = Date.now();
    const { code, output } = await run(args as string[], env as Record<string, string>);

    expect(code).not.toBe(0);
    expect(output).toMatch(/Refusing to .*not local/);
    expect(output).not.toContain(SECRET);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);
});
