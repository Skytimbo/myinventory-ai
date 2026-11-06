/**
 * Database target safety (fail-closed)
 *
 * Development, test, and database-management commands may only use a
 * PostgreSQL server on this machine. There is deliberately no override:
 * production changes go through the reviewed procedures in
 * docs/AI-IDENTIFY-VALUATION.md, never through these commands.
 *
 * Nothing here ever prints a connection string or credentials; only host,
 * port, and database name.
 */

export interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
  /** Loopback host or local Unix socket */
  local: boolean;
}

export class LocalDatabaseRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalDatabaseRequiredError";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Host, port, and database of a connection URL, without credentials */
export function describeDatabaseUrl(url: string | undefined): DatabaseTarget {
  if (!url || !url.trim()) {
    throw new LocalDatabaseRequiredError("No database URL is configured.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new LocalDatabaseRequiredError("The database URL could not be parsed.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new LocalDatabaseRequiredError("The database URL is not a postgres:// or postgresql:// URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  // postgresql:///db?host=/tmp uses a local Unix socket
  const socketDir = parsed.searchParams.get("host");
  const viaSocket = hostname === "" && Boolean(socketDir && socketDir.startsWith("/"));
  // A host query parameter can redirect libpq to another server; only allow a socket path
  const hostParamRedirect = Boolean(socketDir && !socketDir.startsWith("/"));

  return {
    host: viaSocket ? `socket:${socketDir}` : hostname || "(none)",
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "(none)",
    local: !hostParamRedirect && (viaSocket || LOOPBACK_HOSTS.has(hostname)),
  };
}

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  try {
    return describeDatabaseUrl(url).local;
  } catch {
    return false;
  }
}

/**
 * Throw unless the URL points at a PostgreSQL server on this machine.
 * Call before connecting, so a remote server is never contacted.
 */
export function assertLocalDatabaseUrl(url: string | undefined, purpose: string): DatabaseTarget {
  const target = describeDatabaseUrl(url);
  if (!target.local) {
    throw new LocalDatabaseRequiredError(
      `Refusing to ${purpose}: database host "${target.host}" is not local. ` +
        "Development and database-management commands only run against PostgreSQL on this machine " +
        "(localhost, 127.0.0.1, ::1, or a local socket). Use .env.development (see docs/LOCAL-DEVELOPMENT.md)."
    );
  }
  return target;
}

interface Queryable {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * After connecting, confirm with the server itself that it is local and not
 * Neon. Catches a tunnel or hosts-file entry that makes a remote server look
 * like localhost. Returns the database name for display.
 */
export async function assertConnectedToLocalServer(client: Queryable, purpose: string): Promise<string> {
  const { rows } = await client.query(
    "SELECT current_database() AS database, host(inet_server_addr()) AS server_address, " +
      "current_setting('neon.timeline_id', true) AS neon_timeline"
  );
  const row = rows[0] ?? {};
  const address = row.server_address == null ? null : String(row.server_address);
  const isLoopback = address === null || address === "127.0.0.1" || address === "::1";

  if (row.neon_timeline) {
    throw new LocalDatabaseRequiredError(`Refusing to ${purpose}: the connected server is a Neon database.`);
  }
  if (!isLoopback) {
    throw new LocalDatabaseRequiredError(
      `Refusing to ${purpose}: the connected server reports address ${address}, not a local server.`
    );
  }
  return String(row.database);
}
