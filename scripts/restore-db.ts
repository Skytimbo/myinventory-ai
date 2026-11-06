import type { BackupEvidence, BackupInventoryItem } from "./backup-utils";

/**
 * Database side of restore, shared by `pnpm restore:verify` (inside a
 * rolled-back transaction) and `pnpm restore:local` (committed into an empty
 * local database). Callers are responsible for the local-only guards.
 */
export interface RestoreClient {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

/** Child tables first, so TRUNCATE and emptiness checks read naturally */
export const RESTORE_TABLES = [
  "item_photos",
  "photos",
  "capture_batches",
  "capture_sessions",
  "inventory_items",
] as const;

const REQUIRED_COLUMNS: Record<(typeof RESTORE_TABLES)[number], string[]> = {
  inventory_items: [
    "id",
    "name",
    "description",
    "category",
    "tags",
    "image_url",
    "image_urls",
    "barcode_data",
    "estimated_value",
    "value_confidence",
    "value_rationale",
    "location",
    "analysis_metadata",
    "identification",
    "valuation",
    "notes",
    "user_assertions",
    "created_at",
  ],
  capture_sessions: ["id", "title", "notes", "created_at"],
  capture_batches: ["id", "session_id", "context", "created_at"],
  photos: [
    "id",
    "batch_id",
    "object_path",
    "sha256",
    "bytes",
    "mime_type",
    "original_filename",
    "source",
    "created_at",
  ],
  item_photos: ["item_id", "photo_id", "position", "created_at"],
};

export async function assertSchemaReady(client: RestoreClient, label: string): Promise<void> {
  const result = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [RESTORE_TABLES]
  );
  const present = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) =>
    columns.map((column) => `${table}.${column}`).filter((name) => !present.has(name))
  );

  if (missing.length > 0) {
    throw new Error(
      `${label} is missing expected column(s): ${missing.join(", ")}. Apply migrations through 0004 first.`
    );
  }
}

export async function countRows(client: RestoreClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of RESTORE_TABLES) {
    const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
    counts[table] = Number(result.rows[0]?.count ?? "0");
  }
  return counts;
}

/** Insert archive rows exactly as backed up (ids, timestamps, links, positions) */
export async function insertArchiveRows(
  client: RestoreClient,
  items: BackupInventoryItem[],
  evidence: BackupEvidence
): Promise<void> {
  for (const item of items) {
    await client.query(
      `INSERT INTO inventory_items (
        id,
        name,
        description,
        category,
        tags,
        image_url,
        image_urls,
        barcode_data,
        estimated_value,
        value_confidence,
        value_rationale,
        location,
        analysis_metadata,
        identification,
        valuation,
        notes,
        user_assertions,
        created_at
      ) VALUES (
        $1::uuid, $2, $3, $4, $5::text[], $6, $7::text[], $8, $9, $10, $11, $12,
        $13::jsonb, $14::jsonb, $15::jsonb, $16, $17::jsonb, $18
      )`,
      [
        item.id,
        item.name,
        item.description,
        item.category,
        item.tags,
        item.imageUrl,
        item.imageUrls,
        item.barcodeData,
        item.estimatedValue,
        item.valueConfidence,
        item.valueRationale,
        item.location,
        item.analysisMetadata ? JSON.stringify(item.analysisMetadata) : null,
        item.identification ? JSON.stringify(item.identification) : null,
        item.valuation ? JSON.stringify(item.valuation) : null,
        item.notes,
        item.userAssertions ? JSON.stringify(item.userAssertions) : null,
        item.createdAt,
      ]
    );
  }

  for (const session of evidence.captureSessions) {
    await client.query(
      `INSERT INTO capture_sessions (id, title, notes, created_at) VALUES ($1::uuid, $2, $3, $4)`,
      [session.id, session.title, session.notes, session.createdAt]
    );
  }
  for (const batch of evidence.captureBatches) {
    await client.query(
      `INSERT INTO capture_batches (id, session_id, context, created_at) VALUES ($1::uuid, $2::uuid, $3::jsonb, $4)`,
      [batch.id, batch.sessionId, JSON.stringify(batch.context ?? {}), batch.createdAt]
    );
  }
  for (const photo of evidence.photos) {
    await client.query(
      `INSERT INTO photos (id, batch_id, object_path, sha256, bytes, mime_type, original_filename, source, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)`,
      [
        photo.id,
        photo.batchId,
        photo.objectPath,
        photo.sha256,
        photo.bytes,
        photo.mimeType,
        photo.originalFilename,
        photo.source,
        photo.createdAt,
      ]
    );
  }
  for (const link of evidence.itemPhotos) {
    await client.query(
      `INSERT INTO item_photos (item_id, photo_id, position, created_at) VALUES ($1::uuid, $2::uuid, $3, $4)`,
      [link.itemId, link.photoId, link.position, link.createdAt]
    );
  }
}

/** Restored row counts must equal the archive's */
export async function assertRestoredCounts(
  client: RestoreClient,
  items: BackupInventoryItem[],
  evidence: BackupEvidence
): Promise<Record<string, number>> {
  const counts = await countRows(client);
  const expected: Record<string, number> = {
    inventory_items: items.length,
    capture_sessions: evidence.captureSessions.length,
    capture_batches: evidence.captureBatches.length,
    photos: evidence.photos.length,
    item_photos: evidence.itemPhotos.length,
  };
  for (const [table, count] of Object.entries(expected)) {
    if (counts[table] !== count) {
      throw new Error(`Restored ${table} count mismatch: expected=${count}, actual=${counts[table]}`);
    }
  }
  return counts;
}
