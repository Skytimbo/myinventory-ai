# Neon Database Setup for Railway Deployment

**Status:** Required for production deployment
**Issue:** Railway shows "relation 'inventory_items' does not exist"
**Solution:** Execute SQL migration in Neon Console

---

## Quick Fix (5 minutes)

### Step 1: Open Neon Console SQL Editor

1. Go to https://console.neon.tech
2. Select your project: `ep-still-cloud-ah7zvayl-pooler`
3. Click **SQL Editor** in the left sidebar

### Step 2: Execute Migration Script

Copy the SQL from `migrations/railway-init.sql` (or use the script below):

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create inventory_items table
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  image_url TEXT NOT NULL,
  image_urls TEXT[],
  barcode_data TEXT NOT NULL,
  estimated_value DECIMAL(10, 2),
  value_confidence TEXT,
  value_rationale TEXT,
  location TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Step 3: Verify Table Creation

Run this query in the same SQL Editor:

```sql
-- Check if table exists and view structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'inventory_items'
ORDER BY ordinal_position;
```

**Expected Result:** 12 rows showing all columns (id, name, description, etc.)

---

## Verification Checklist

After running the SQL migration:

### ✅ Database Verification

- [ ] Run: `SELECT * FROM inventory_items LIMIT 1;`
  - **Expected:** Empty result set (no rows yet) OR existing rows if data was migrated
  - **Should NOT show:** "relation does not exist" error

- [ ] Run: `SELECT COUNT(*) FROM inventory_items;`
  - **Expected:** Returns `0` (or count of existing rows)

- [ ] Check UUID generation:
  ```sql
  INSERT INTO inventory_items (name, description, category, image_url, barcode_data)
  VALUES ('Test', 'Test Description', 'Test Category', '/test.jpg', 'TEST-001')
  RETURNING id;
  ```
  - **Expected:** Returns a UUID like `550e8400-e29b-41d4-a716-446655440000`
  - **Cleanup:** `DELETE FROM inventory_items WHERE barcode_data = 'TEST-001';`

### ✅ Railway Deployment Verification

Railway will automatically detect the git push and redeploy. No action needed.

- [ ] Wait 2-3 minutes for Railway to rebuild
- [ ] Check Railway logs for: `✓ Database connection verified`
- [ ] Test health endpoint: `https://your-app.railway.app/api/health`
  - **Expected:** `{"status":"ok","timestamp":"...","environment":"production"}`

### ✅ Photo Upload Test

1. **Access Production URL:** `https://your-app.railway.app`
2. **Click "Add Item"** button
3. **Take or upload a photo**
4. **Submit the form**

**Expected Behavior:**
- Loading indicator appears
- Photo uploads successfully
- Item appears in the list with:
  - AI-generated name
  - AI-generated description
  - AI-generated category
  - Estimated value (or blank if AI couldn't estimate)
  - Thumbnail image

**If Upload Fails:**
- Check Railway logs for error messages
- Verify OPENAI_API_KEY is set in Railway environment variables
- Verify persistent volume is mounted at `/app/uploads`

### ✅ Database Data Verification

After successful upload, verify data was written:

```sql
SELECT
  id,
  name,
  category,
  image_url,
  estimated_value,
  created_at
FROM inventory_items
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** Shows your uploaded item(s) with all fields populated

---

## Troubleshooting

### Error: "relation 'inventory_items' does not exist"

**Cause:** SQL migration was not applied
**Fix:** Re-run the migration script in Neon Console SQL Editor

### Error: "function gen_random_uuid() does not exist"

**Cause:** pgcrypto extension not enabled
**Fix:** Run `CREATE EXTENSION IF NOT EXISTS "pgcrypto";` first

### Error: "column 'image_urls' cannot be null"

**Cause:** Application trying to insert NULL into NOT NULL column
**Fix:** This should not happen - the schema defines `image_urls` as nullable

### Railway Still Shows 500 Error After Migration

**Possible causes:**
1. Railway didn't redeploy after schema change
   - **Fix:** Push an empty commit: `git commit --allow-empty -m "trigger redeploy" && git push`

2. OPENAI_API_KEY is missing/invalid
   - **Fix:** Set in Railway dashboard → Variables
   - If using project-scoped keys (`sk-proj-*`), also set `OPENAI_PROJECT_ID`
   - Verify with: `https://your-app.railway.app/api/health/openai`

3. DATABASE_URL is incorrect
   - **Fix:** Should be: `postgresql://neondb_owner:npg_bRvYc0f2KjTw@ep-still-cloud-ah7zvayl-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`

4. Persistent volume not mounted
   - **Fix:** In Railway dashboard, add volume at `/app/uploads` (5GB)

---

## Database Schema Reference

### Table: inventory_items

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| name | TEXT | NO | - | Item name (AI-extracted) |
| description | TEXT | NO | - | Item description (AI-extracted) |
| category | TEXT | NO | - | Item category (AI-extracted) |
| tags | TEXT[] | NO | ARRAY[]::text[] | Searchable tags (AI-extracted) |
| image_url | TEXT | NO | - | Primary image URL |
| image_urls | TEXT[] | YES | NULL | All image URLs (multi-image support) |
| barcode_data | TEXT | NO | - | Barcode/QR code identifier |
| estimated_value | DECIMAL(10,2) | YES | NULL | AI-estimated resale value |
| value_confidence | TEXT | YES | NULL | Confidence: "low", "medium", "high" |
| value_rationale | TEXT | YES | NULL | Brief valuation explanation |
| location | TEXT | YES | NULL | Physical storage location |
| created_at | TEXT | NO | CURRENT_TIMESTAMP | Creation timestamp |

### Indexes
- Primary key index on `id` (automatically created)

### Constraints
- Primary key: `id`
- NOT NULL: `name`, `description`, `category`, `tags`, `image_url`, `barcode_data`, `created_at`

---

## Next Steps After Verification

Once photo uploads work in production:

1. **Add test data** - Upload 3-5 different items to test AI analysis quality
2. **Monitor Railway logs** - Watch for any errors or warnings
3. **Check cost usage** - Monitor Neon database storage and Railway compute usage
4. **Enable backups** - Configure automated Neon backups (recommended)
5. **Add monitoring** - Consider Sentry for error tracking (optional)

---

**Last Updated:** 2025-11-21
**Railway URL:** https://your-app.railway.app (replace with actual URL)
**Neon Database:** ep-still-cloud-ah7zvayl-pooler.c-3.us-east-1.aws.neon.tech
