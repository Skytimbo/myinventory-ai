CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Convert id column from varchar to uuid type and set default
ALTER TABLE inventory_items
    ALTER COLUMN id TYPE uuid USING id::uuid,
    ALTER COLUMN id SET DEFAULT gen_random_uuid();
