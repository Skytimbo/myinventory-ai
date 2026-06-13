ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS analysis_metadata JSONB;
