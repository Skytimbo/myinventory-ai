-- Milestone 1: capture evidence and user assertions (additive, non-destructive).
-- Photos get identities independent of inventory items. Existing photos are
-- registered later by the application without moving or changing files.

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS user_assertions JSONB;

CREATE TABLE IF NOT EXISTS capture_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS capture_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES capture_sessions(id),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES capture_batches(id),
  object_path TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  original_filename TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS photos_sha256_idx ON photos (sha256);
CREATE INDEX IF NOT EXISTS photos_batch_id_idx ON photos (batch_id);

-- Deleting an item removes only its links; photos are evidence and are kept.
CREATE TABLE IF NOT EXISTS item_photos (
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  photo_id UUID NOT NULL REFERENCES photos(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (item_id, photo_id)
);
CREATE INDEX IF NOT EXISTS item_photos_photo_id_idx ON item_photos (photo_id);
