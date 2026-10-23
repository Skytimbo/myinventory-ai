-- Separate Identify and Estimate Value results (additive, non-destructive).
-- Existing estimated_value / value_confidence / value_rationale are kept as
-- legacy data and are never rewritten.
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS identification JSONB;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS valuation JSONB;
