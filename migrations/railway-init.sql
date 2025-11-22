-- MyInventory-AI Database Initialization for Railway/Neon
-- This script creates the complete database schema
--
-- USAGE:
-- 1. Copy this entire script
-- 2. Open Neon Console SQL Editor
-- 3. Paste and execute
-- 4. Verify with: SELECT * FROM inventory_items LIMIT 1;
--
-- Generated: 2025-11-21
-- Based on: shared/schema.ts

-- Enable UUID extension for auto-generated primary keys
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create inventory_items table
CREATE TABLE IF NOT EXISTS inventory_items (
  -- Primary key (auto-generated UUID)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core item information (all required)
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,

  -- Searchable metadata
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],

  -- Image storage (supports single and multi-image)
  image_url TEXT NOT NULL,              -- Legacy single image (PRD 0004 backward compatibility)
  image_urls TEXT[],                     -- Multi-image support (nullable for backward compat)

  -- Identification
  barcode_data TEXT NOT NULL,

  -- AI-powered value estimation (PRD 0006)
  estimated_value DECIMAL(10, 2),        -- Resale value estimate
  value_confidence TEXT,                 -- "low", "medium", or "high"
  value_rationale TEXT,                  -- Brief valuation explanation

  -- Optional metadata
  location TEXT,                         -- Physical storage location

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Verify table was created
SELECT 'inventory_items table created successfully' AS status;
