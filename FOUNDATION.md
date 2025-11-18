---
version: 1
last_updated: 2025-11-13
purpose: foundational-architecture
canonical: true
related_docs:
  - CONTEXT.md
  - tasks/0003-prd-foundational-architecture.md
  - tasks/0002-prd-dual-env-image-persistence.md
---

# FOUNDATION: MyInventory AI Architectural Principles

**Purpose:** This document defines the foundational architecture for MyInventory AI, establishing principles that enable the platform to scale from a personal inventory tool to a multi-vertical system supporting auto parts catalogs, storage business portals, insurance documentation, and estate planning use cases.

**Audience:** Developers creating PRDs, implementing features, and extending the platform.

**Status:** Canonical architectural reference (v1.0)

---

## Table of Contents

1. [Introduction](#introduction)
2. [Core Principles](#core-principles)
   - [Principle 1: Media as First-Class Concept](#principle-1-media-as-first-class-concept)
   - [Principle 2: Storage as Environment-Agnostic Abstraction](#principle-2-storage-as-environment-agnostic-abstraction)
   - [Principle 3: Upload as Pluggable Mechanism](#principle-3-upload-as-pluggable-mechanism)
   - [Principle 4: Containers as Hierarchical Entities](#principle-4-containers-as-hierarchical-entities)
   - [Principle 5: Extensible Attributes as Flexible Data](#principle-5-extensible-attributes-as-flexible-data)
   - [Principle 6: Search as First-Class Concern](#principle-6-search-as-first-class-concern)
   - [Principle 7: Tests as Behavior Assertions](#principle-7-tests-as-behavior-assertions)
   - [Principle 8: Services as Injectable Dependencies](#principle-8-services-as-injectable-dependencies)
3. [Evolution Roadmap](#evolution-roadmap)
4. [Integration Patterns](#integration-patterns)
5. [Anti-Patterns](#anti-patterns)
6. [Cross-References](#cross-references)

---

## Introduction

### Why This Document Exists

MyInventory AI began as a focused MVP: users capture photos, AI extracts metadata, items are cataloged with barcodes. This core functionality works well. However, as we scale to support:

- **Multiple images per item** (photos from different angles, receipts, manuals, PDFs)
- **Hierarchical containers** (property → room → closet → box → sub-box → item)
- **Vertical-specific features** (auto parts with fitment data, storage business client portals, insurance documentation workflows)
- **Batch operations** (upload 1000 photos from a folder, AI-assisted clustering)
- **Public catalogs** (searchable Jeep parts inventory for clubs/collectors)

...we must ensure the **foundation remains strong, dynamic, and flexible** without over-engineering features prematurely.

This document establishes **8 core architectural principles** that:

1. **Prevent technical debt** by defining patterns before implementation
2. **Enable cheap extensibility** by avoiding hard-coded assumptions
3. **Maintain stability** by preserving backwards compatibility
4. **Guide PRD authors** with clear integration patterns

**Relationship to CONTEXT.md:** `CONTEXT.md` documents *what the system is*. `FOUNDATION.md` documents *how the system should evolve*.

---

## Core Principles

### Principle 1: Media as First-Class Concept

**Current State (2025-11-13):**
Items have a single `imageUrl` (text field) stored in the database (`shared/schema.ts:12`):

```typescript
// shared/schema.ts
export const inventoryItems = pgTable("inventory_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  tags: text("tags").array().notNull().default([]),
  imageUrl: text("image_url").notNull(), // ⚠️ LIMITATION: Single text field, not array
  // ...
});
```

**Problem:**
This design assumes **one item = one image**. Future use cases require:
- Multiple photos (front/back/detail shots)
- Supplemental documents (receipts, warranties, manuals)
- Different media types (images, PDFs, videos)

**Principle:**
> **Items will have multiple media assets, not a single URL.**

**Evolution Path:**

#### Phase 1: Backwards-Compatible Dual Field (PRD 0004)
Add `imageUrls` array alongside `imageUrl`:

```typescript
// shared/schema.ts (future)
export const inventoryItems = pgTable("inventory_items", {
  // ...existing fields...
  imageUrl: text("image_url").notNull(), // Keep for backwards compatibility
  imageUrls: text("image_urls").array().$type<string[]>().default([]), // NEW: Multi-image support
  // ...
});
```

**Migration Strategy:**
- New uploads populate both fields: `imageUrl = images[0]`, `imageUrls = images`
- Old data backfilled: `UPDATE inventory_items SET image_urls = ARRAY[image_url] WHERE image_urls IS NULL`
- UI gradually migrates to `imageUrls[0]` instead of `imageUrl`
- After 6+ months, deprecate `imageUrl` column

#### Phase 2: First-Class Media Entity (PRD 0005+)
For advanced use cases (ordering, metadata, media types), introduce `Media` entity:

```typescript
// shared/schema.ts (future)
export const media = pgTable("media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => inventoryItems.id),
  url: text("url").notNull(),
  type: text("type").notNull(), // 'image', 'pdf', 'video'
  mimeType: text("mime_type").notNull(),
  order: integer("order").default(0), // For primary vs additional images
  caption: text("caption"), // User-provided descriptions
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

**Benefits:**
- Explicit ordering (primary image = order 0)
- Per-media metadata (captions, EXIF data)
- Queryable by type (all receipts, all PDFs)
- Deletion cascade (remove media when item deleted)

#### Storage Path Strategy

**Current:** `/objects/items/{uuid}.jpg` (hard-coded, single file)

**Phase 1 (Multi-Image):** `/objects/items/{itemId}/{index}.{ext}`
- Example: `/objects/items/abc123/0.jpg`, `/objects/items/abc123/1.png`, `/objects/items/abc123/receipt.pdf`

**Phase 2 (Media Entity):** `/objects/media/{mediaId}.{ext}`
- Example: `/objects/media/media-uuid-1.jpg`
- Decouples media from items (allows shared media, e.g., product photos used by multiple listings)

**Implementation Guidance:**
- `ObjectStorageService.saveLocalFile()` already supports arbitrary paths (see `server/objectStorage.ts:274`)
- Path validation regex must be updated to allow `/objects/items/{id}/{file}` pattern
- UI components should iterate `imageUrls` array, displaying gallery instead of single image

**API Contract Evolution:**

**Current:** `POST /api/items` with single `image` field (multipart/form-data)

**Phase 1:** `POST /api/items` with multiple `images[]` field
```typescript
app.post("/api/items", upload.array("images", 10), wrap(async (req, res) => {
  // req.files is array of files
  const imageUrls = await Promise.all(
    req.files.map(async (file, index) => {
      const ext = mimeToExt[file.mimetype] || 'jpg';
      const url = `/objects/items/${itemId}/${index}.${ext}`;
      await objectStorageService.saveLocalFile(`items/${itemId}/${index}.${ext}`, file.buffer);
      return url;
    })
  );
  await storage.createItem({ ...data, imageUrl: imageUrls[0], imageUrls });
}));
```

**Phase 2:** Separate `/api/media` endpoint for media management
```typescript
POST   /api/items/:id/media   # Upload media to existing item
GET    /api/items/:id/media   # List all media for item
DELETE /api/media/:id          # Delete specific media file
PATCH  /api/media/:id/order    # Reorder media (set primary image)
```

---

### Principle 2: Storage as Environment-Agnostic Abstraction

**Current State:**
`ObjectStorageService` (implemented in PRD 0002) provides dual-backend storage:
- **Local development:** Filesystem storage in `uploads/` directory
- **Replit production:** Google Cloud Storage via sidecar

**Reference Implementation:** `server/objectStorage.ts`

**Key Design:**
```typescript
// Environment detection (objectStorage.ts:16-17)
const isReplit = process.env.REPL_ID !== undefined;
export const objectStorageClient = isReplit ? new Storage({...}) : null;

// Unified service interface (objectStorage.ts:45-361)
export class ObjectStorageService {
  // Methods work regardless of backend:
  async saveLocalFile(relativePath: string, buffer: Buffer): Promise<void>
  async getLocalObjectFile(objectPath: string): Promise<string>
  async downloadLocalObject(filePath: string, res: Response, cacheTtlSec?: number): Promise<void>

  // GCS methods for Replit:
  async searchPublicObject(filePath: string): Promise<File | null>
  async downloadObject(file: File, res: Response, cacheTtlSec?: number): Promise<void>
}
```

**Principle:**
> **Storage abstraction must remain environment-agnostic and multi-file ready.**

**Multi-File Readiness:**
The current implementation already supports multi-file scenarios:
- ✅ `saveLocalFile(relativePath, buffer)` accepts arbitrary paths
- ✅ Path validation allows nested structures (`/objects/items/uuid/0.jpg`)
- ✅ Environment detection is startup-time, not per-request
- ✅ No assumptions about file count baked into service methods

**Extension Pattern: Adding Third Backend (S3, Azure)**

Follow PRD 0002's dual-backend pattern:

1. **Add environment detection:**
```typescript
const storageBackend = process.env.STORAGE_BACKEND || (isReplit ? 'gcs' : 'local');
```

2. **Extend ObjectStorageService with backend-specific methods:**
```typescript
async saveToS3(relativePath: string, buffer: Buffer): Promise<void> {
  const s3 = new S3Client({ region: process.env.AWS_REGION });
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: relativePath,
    Body: buffer,
  }));
}
```

3. **Update routing logic:**
```typescript
// server/routes.ts
if (storageBackend === 'gcs') {
  // Use GCS
} else if (storageBackend === 's3') {
  await objectStorageService.saveToS3(`items/${itemId}.${ext}`, req.file.buffer);
} else {
  // Local filesystem
}
```

**Path Conventions:**
- **Items:** `/objects/items/{itemId}/{filename}`
- **Media:** `/objects/media/{mediaId}.{ext}` (future)
- **Containers:** `/objects/containers/{containerId}/index.{ext}` (for printable index sheets)
- **Verticals:** `/objects/verticals/{verticalName}/{assetId}.{ext}` (e.g., auto parts photos)

**Security:**
- Path traversal prevention via `validateObjectPath()` (objectStorage.ts:65-96)
- No direct filesystem access from UI (all via `/objects/*` route)
- ACL policies for public vs private storage (GCS metadata)

---

### Principle 3: Upload as Pluggable Mechanism

**Current State:**
Upload logic is **tightly coupled** to page components:
- `client/src/pages/home.tsx:68-69` - Camera capture handler directly creates FormData
- `client/src/pages/home.tsx:93-94` - File input handler duplicates FormData logic

**Problem:**
Every new upload mechanism (batch upload, drag-and-drop, mobile camera) would duplicate this logic.

**Principle:**
> **Upload mechanisms must be reusable utilities, not page-coupled implementations.**

**Reference Implementation (PRD 0003):**

**Upload Service:** `client/src/lib/uploadService.ts`
```typescript
/**
 * Creates FormData for single item image upload
 *
 * @example
 * const formData = createItemUploadFormData(blob, "photo.jpg");
 * createItemMutation.mutate(formData);
 */
export function createItemUploadFormData(
  imageBlob: Blob,
  filename: string = "upload.jpg"
): FormData {
  const formData = new FormData();
  formData.append("image", imageBlob, filename);
  return formData;
}
```

**Usage in Components:**
```typescript
// client/src/pages/home.tsx
import { createItemUploadFormData } from "@/lib/uploadService";

const handleImageCapture = (data: string, location?: string) => {
  const blob = dataURLToBlob(data);
  const formData = createItemUploadFormData(blob, "upload.jpg");
  createItemMutation.mutate(formData);
};
```

**Extension Pattern: Multi-Image Upload (PRD 0004)**
```typescript
// client/src/lib/uploadService.ts (future)
export function createItemMultiUploadFormData(
  imageBlobs: Blob[],
  filenames?: string[]
): FormData {
  const formData = new FormData();
  imageBlobs.forEach((blob, index) => {
    const filename = filenames?.[index] || `upload-${index}.jpg`;
    formData.append("images", blob, filename); // Note: plural "images"
  });
  return formData;
}
```

**Separation of Concerns:**
- **UI Components** (`CameraCapture`, file input) → Capture user input, trigger upload
- **Upload Service** (`uploadService.ts`) → Construct FormData, handle file preparation
- **API Routes** (`server/routes.ts`) → Validate, process, store files
- **Storage Service** (`objectStorage.ts`) → Save to backend, manage paths

**Benefits:**
- Upload logic is testable in isolation
- Multiple upload mechanisms reuse same service
- Easy to add logging, compression, client-side validation
- No duplication across camera, file input, drag-drop flows

---

### Principle 4: Containers as Hierarchical Entities

**Current State:**
Items have optional `location` field (text) with no structure:
```typescript
// shared/schema.ts:17
location: text("location"), // e.g., "Garage", "Kitchen Drawer"
```

**Problem:**
Cannot represent nested hierarchies like:
- Property → Building → Floor → Room → Closet → Shelf → Box → Item
- Estate inventory: "123 Main St → Bedroom 2 → Dresser → Top Drawer → Watch Box → Rolex"

**Use Cases:**
- **Storage business:** Client's container is root, items nested within
- **Estate planning:** Property → rooms → furniture → contents
- **Auto parts catalog:** Warehouse → Section → Aisle → Bin → Part
- **Printable index sheets:** Generate barcode-labeled box contents list

**Principle:**
> **Items live in hierarchical containers, queryable via subtree traversal.**

**Recommended Pattern: Adjacency List with Recursive CTEs**

**Schema Design:**
```typescript
// shared/schema.ts (future)
export const containers = pgTable("containers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentId: varchar("parent_id").references(() => containers.id), // Self-reference for hierarchy
  name: text("name").notNull(),
  type: text("type").notNull(), // 'property', 'room', 'box', 'shelf', etc.
  description: text("description"),
  barcodeData: text("barcode_data"), // For printable labels
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const inventoryItems = pgTable("inventory_items", {
  // ...existing fields...
  containerId: varchar("container_id").references(() => containers.id),
  location: text("location"), // Keep for backwards compatibility, populate from container path
});
```

**Recursive Query (PostgreSQL CTE):**
```sql
-- Get all items in a container and its descendants
WITH RECURSIVE container_tree AS (
  -- Base case: start container
  SELECT id, parent_id, name, 0 AS depth
  FROM containers
  WHERE id = $1

  UNION ALL

  -- Recursive case: child containers
  SELECT c.id, c.parent_id, c.name, ct.depth + 1
  FROM containers c
  INNER JOIN container_tree ct ON c.parent_id = ct.id
)
SELECT i.*
FROM inventory_items i
INNER JOIN container_tree ct ON i.container_id = ct.id
ORDER BY ct.depth, i.created_at;
```

**API Endpoints:**
```typescript
GET    /api/containers                      # List root containers
GET    /api/containers/:id                  # Get container details
GET    /api/containers/:id/children         # List direct children
GET    /api/containers/:id/tree             # Get full subtree (recursive)
GET    /api/containers/:id/items            # Get all items in subtree
POST   /api/containers                      # Create new container
PATCH  /api/containers/:id/move             # Move container to new parent
DELETE /api/containers/:id                  # Delete (cascade or prevent if has children)
GET    /api/containers/:id/index-sheet      # Generate printable index (PDF with barcodes)
```

**Integration with Existing Location Field:**

**Migration Strategy:**
1. Add `containers` table, `items.container_id` foreign key (nullable)
2. Parse existing `location` text into container hierarchy (best-effort)
3. Dual-write period: Update both `location` (text) and `container_id` (FK)
4. UI shows container breadcrumbs: "Property > Garage > Tool Box"
5. After migration complete, deprecate `location` field

**Printable Index Sheets:**
Generate PDF with container details + barcode + list of items:

```typescript
// server/containers.ts (future)
async function generateIndexSheet(containerId: string): Promise<Buffer> {
  const container = await storage.getContainer(containerId);
  const items = await storage.getItemsInContainerTree(containerId);

  const pdf = new PDFDocument();
  // Header: Container name + barcode
  pdf.fontSize(20).text(container.name);
  pdf.image(await generateQRCode(container.id), { width: 100 });

  // Table: Item names, barcodes, values
  items.forEach(item => {
    pdf.fontSize(12).text(`${item.name} - ${item.barcode_data}`);
  });

  return pdf.toBuffer();
}
```

---

### Principle 5: Extensible Attributes as Flexible Data

**Current State:**
All item attributes are fixed columns in `inventory_items` table:
```typescript
// shared/schema.ts
name, description, category, tags[], imageUrl, barcodeData,
estimatedValue, valueConfidence, valueRationale, location, createdAt
```

**Problem:**
Different verticals need different attributes:

| Vertical | Required Attributes |
|----------|---------------------|
| **Auto Parts** | part_number, brand, fitment (make/model/year), condition, quantity, OEM_number |
| **Storage Business** | client_id, contract_number, storage_fee, insurance_value, retrieval_date |
| **Insurance** | policy_number, claim_date, replacement_cost, depreciation, appraisal_id |
| **Estate Planning** | heir_assignment, appraisal_value, legal_description, tax_basis |

Adding columns for each vertical pollutes the schema and creates nullability issues.

**Principle:**
> **Vertical-specific attributes must be extensible without schema explosion.**

**Strategy Decision Framework:**

| Attribute Type | Pattern | Rationale |
|----------------|---------|-----------|
| **Structured & Searchable** | Separate table with FK | Can index, query, join efficiently |
| **Unstructured & Rare** | JSONB field | Flexible, no schema changes needed |
| **Shared Across Verticals** | Core column | Reduce duplication, enforce consistency |

**Pattern 1: Separate Vertical Tables (Recommended for Structured Data)**

**Example: Auto Parts Catalog**
```typescript
// shared/schema.ts (future)
export const autoPartsAttributes = pgTable("auto_parts_attributes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => inventoryItems.id),
  partNumber: text("part_number").notNull(),
  brand: text("brand"),
  condition: text("condition").notNull(), // 'new', 'used', 'refurbished'
  fitmentMake: text("fitment_make"), // 'Jeep'
  fitmentModel: text("fitment_model"), // 'Wrangler'
  fitmentYearStart: integer("fitment_year_start"),
  fitmentYearEnd: integer("fitment_year_end"),
  oemNumber: text("oem_number"),
  quantity: integer("quantity").default(1),
});

// Indexes for search
CREATE INDEX idx_auto_parts_part_number ON auto_parts_attributes(part_number);
CREATE INDEX idx_auto_parts_fitment ON auto_parts_attributes(fitment_make, fitment_model);
```

**Query Example:**
```sql
-- Find all Jeep Wrangler parts from 1997-2006
SELECT i.*, apa.*
FROM inventory_items i
INNER JOIN auto_parts_attributes apa ON i.id = apa.item_id
WHERE apa.fitment_make = 'Jeep'
  AND apa.fitment_model = 'Wrangler'
  AND apa.fitment_year_start <= 2006
  AND apa.fitment_year_end >= 1997
ORDER BY apa.part_number;
```

**Benefits:**
- Fast queries (indexed columns)
- Type safety (schema-defined)
- Clear vertical boundaries

**Pattern 2: JSONB Attributes (For Unstructured/Rare Data)**

**Example: Insurance Documentation**
```typescript
// shared/schema.ts (future)
export const inventoryItems = pgTable("inventory_items", {
  // ...existing fields...
  verticalAttributes: jsonb("vertical_attributes").$type<Record<string, any>>().default({}),
});

// Usage:
await storage.createItem({
  name: "Antique Clock",
  // ...core fields...
  verticalAttributes: {
    vertical: "insurance",
    policyNumber: "POL-2024-12345",
    claimDate: "2024-03-15",
    replacementCost: 5000,
    appraisalId: "APR-789",
  }
});
```

**Query Example (PostgreSQL JSONB Operators):**
```sql
-- Find all items with insurance vertical
SELECT *
FROM inventory_items
WHERE vertical_attributes->>'vertical' = 'insurance';

-- Find items with replacement cost > $1000
SELECT *
FROM inventory_items
WHERE (vertical_attributes->>'replacementCost')::numeric > 1000;
```

**Benefits:**
- No schema changes needed
- Flexible for evolving requirements
- Good for rare/optional attributes

**Drawbacks:**
- Slower queries (JSONB indexing required)
- Less type-safe (no compile-time checks)
- Harder to enforce constraints

**Recommendation:**
- **Use separate tables** for primary verticals (auto parts, storage business)
- **Use JSONB** for experimental/rare attributes
- **Promote to table** when attribute set stabilizes and query performance matters

---

### Principle 6: Search as First-Class Concern

**Current State:**
Basic filtering via `WHERE` clauses on core fields (`name`, `description`, `category`).

**Future Requirements:**
- **Full-text search:** "Find items containing 'vintage clock'"
- **Structured filters:** "Auto parts for Jeep Wrangler 1997-2006 in 'new' condition"
- **Faceted search:** "Show counts by category, brand, condition"
- **Public catalogs:** Anonymous users search 10k+ item inventory (auto parts)
- **Sub-second latency:** Even with complex filters

**Principle:**
> **Search must support full-text + structured filters with indexed performance.**

**Pattern: PostgreSQL Full-Text Search + GIN Indexes**

**Schema:**
```typescript
// shared/schema.ts (future)
export const inventoryItems = pgTable("inventory_items", {
  // ...existing fields...
  searchVector: tsvector("search_vector"), // Generated column for full-text
});

// Migration SQL:
ALTER TABLE inventory_items ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'C') ||
    setweight(to_tsvector('english', array_to_string(tags, ' ')), 'D')
  ) STORED;

CREATE INDEX idx_inventory_search_vector ON inventory_items USING GIN(search_vector);
```

**Query Pattern:**
```typescript
// server/search.ts (future)
async function searchItems(query: {
  text?: string;
  category?: string;
  tags?: string[];
  location?: string;
  minValue?: number;
  maxValue?: number;
  // Vertical-specific filters:
  vertical?: string;
  verticalFilters?: Record<string, any>;
}) {
  let sql = db.select().from(inventoryItems);

  // Full-text search
  if (query.text) {
    sql = sql.where(sql`search_vector @@ plainto_tsquery('english', ${query.text})`);
  }

  // Structured filters
  if (query.category) sql = sql.where(eq(inventoryItems.category, query.category));
  if (query.tags) sql = sql.where(arrayContains(inventoryItems.tags, query.tags));
  if (query.minValue) sql = sql.where(gte(inventoryItems.estimatedValue, query.minValue));

  // Vertical-specific filters (auto parts example)
  if (query.vertical === 'auto-parts' && query.verticalFilters) {
    sql = sql.innerJoin(autoPartsAttributes, eq(inventoryItems.id, autoPartsAttributes.itemId));
    if (query.verticalFilters.fitmentMake) {
      sql = sql.where(eq(autoPartsAttributes.fitmentMake, query.verticalFilters.fitmentMake));
    }
  }

  return await sql;
}
```

**Performance:**
- **GIN index on `search_vector`**: Sub-second full-text search on 100k+ items
- **Indexes on foreign keys**: Fast joins to vertical attribute tables
- **Covering indexes**: For common filter combinations (category + location)

**API Design:**
```typescript
GET /api/search?q=vintage+clock&category=Household&minValue=100
GET /api/search/auto-parts?fitmentMake=Jeep&fitmentModel=Wrangler&condition=new
GET /api/search/facets?q=tools # Returns counts by category, location, etc.
```

**Faceted Search Example:**
```sql
-- Get item counts by category for search results
SELECT category, COUNT(*) as count
FROM inventory_items
WHERE search_vector @@ plainto_tsquery('english', $1)
GROUP BY category
ORDER BY count DESC;
```

---

### Principle 7: Tests as Behavior Assertions

**Current State:**
E2E tests use deterministic stubs (implemented in PRD 0001):
- `/api/items` stubbed to return predictable test data
- Images use 404 → retry → 200 flow with 1×1 PNG
- No dependency on real API, database, or uploaded files

**Reference:** `e2e/image-fallback.spec.ts`

**Problem:**
Tests can become **brittle** if they assert implementation details instead of behavior:
- ❌ Bad: "Uppy component must call `onGetUploadParameters` with specific payload"
- ✅ Good: "User can upload image and see it persist in item list"

**Principle:**
> **Tests assert user-facing behavior, not internal implementation.**

**Guidelines:**

**What to Test:**
- ✅ User actions: "Click upload button, select file, see item appear"
- ✅ Error handling: "Invalid file type shows error message"
- ✅ Persistence: "Uploaded item survives page refresh"
- ✅ Accessibility: "Image error state is announced to screen readers"

**What NOT to Test:**
- ❌ Internal state: "Uppy instance has 1 file in queue"
- ❌ API payloads: "FormData has exact structure `{image: Blob}`"
- ❌ Component internals: "useState hook called with specific value"

**E2E Determinism Pattern:**

```typescript
// e2e/upload-flow.spec.ts (example)
test('user can upload image and see it in inventory', async ({ page }) => {
  // STUB: Mock API response (deterministic)
  await page.route('/api/items', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        json: {
          id: 'test-item-1',
          name: 'Test Item',
          imageUrl: '/objects/items/test-item-1.jpg',
          // ...other fields...
        }
      });
    }
  });

  // ASSERT BEHAVIOR: User uploads file
  await page.goto('/');
  const fileInput = page.locator('[data-testid="file-input"]');
  await fileInput.setInputFiles('fixtures/test-image.jpg');

  // ASSERT OUTCOME: Item appears in list
  await expect(page.locator('[data-testid^="item-"]')).toHaveCount(1);
  await expect(page.locator('text=Test Item')).toBeVisible();
});
```

**Benefits of This Approach:**
- Tests survive refactors (e.g., replacing Uppy with different upload library)
- Tests are readable (describe user flows, not implementation)
- Tests catch regressions in actual user experience

**Anti-Pattern Example:**
```typescript
// ❌ BAD: Testing Uppy internals
test('Uppy uploader initializes correctly', async ({ page }) => {
  await page.goto('/');
  const uppyState = await page.evaluate(() => window.uppy.getState());
  expect(uppyState.files).toEqual([]);
  expect(uppyState.plugins).toContain('XHRUpload');
});
```

**Why Bad:**
- Test breaks if we replace Uppy with native file input
- Doesn't verify user-facing behavior
- Couples tests to implementation details

**Refactored (Behavior-Focused):**
```typescript
// ✅ GOOD: Testing upload outcome
test('upload button opens file picker', async ({ page }) => {
  await page.goto('/');
  const uploadButton = page.locator('[data-testid="button-upload-image"]');
  await expect(uploadButton).toBeVisible();

  // Simulate file selection (test selector is stable)
  const fileInput = page.locator('[data-testid="file-input"]');
  await fileInput.setInputFiles('fixtures/test.jpg');

  // Verify API call happens (behavior, not internal state)
  const apiCall = page.waitForRequest(req =>
    req.url().includes('/api/items') && req.method() === 'POST'
  );
  await apiCall; // Upload triggered
});
```

**Test Selector Stability:**
Use semantic test IDs that describe **what the element does**, not **how it's implemented**:
- ✅ `data-testid="button-upload-image"` (semantic, stable)
- ❌ `data-testid="uppy-dashboard"` (implementation-specific, fragile)

When upload mechanism changes (Uppy → native input → drag-drop), semantic selectors remain valid.

---

### Principle 8: Services as Injectable Dependencies

**Current State (2025-11-14):**
Backend services are managed via the AppServices container pattern (implemented in PRD 0005):
- Type-safe configuration loaded from environment variables via `AppConfig`
- Production services instantiated by `createProdServices()` factory
- Test services instantiated by `createTestServices()` factory with in-memory fakes
- Services injected into route handlers via `registerRoutes(app, services)`

**Reference:** `server/services.ts`, `server/index.ts`

**Problem:**
Before PRD 0005, services used mixed patterns:
- ❌ Singletons: `export const storage = new DatabaseStorage()` (untestable, global state)
- ❌ Inline instantiation: `new ObjectStorageService()` inside route registration
- ❌ Module-level clients: `const openai = new OpenAI()` (no injection point)

**Principle:**
> **Backend services are managed through a centralized container and injected as dependencies.**

**Benefits:**
- ✅ **Testability:** Tests use `createTestServices()` with fast, deterministic fakes
- ✅ **Type Safety:** `AppServices` interface defines service contracts
- ✅ **Configuration:** Environment variables validated once at startup via `loadAppConfig()`
- ✅ **Maintainability:** Service wiring centralized in one place (`server/services.ts`)
- ✅ **No Global State:** Services passed explicitly, not imported from global singletons

**Implementation Pattern:**

```typescript
// server/services.ts
export interface AppServices {
  storage: IStorage;
  objectStorage: ObjectStorageService;
  imageAnalysis: {
    analyzeImage(imageBase64: string): Promise<ImageAnalysisResult>;
  };
}

export async function createProdServices(config: AppConfig): Promise<AppServices> {
  const { DatabaseStorage } = await import('./storage');
  const { ObjectStorageService } = await import('./objectStorage');
  const { analyzeImage } = await import('./openai');

  return {
    storage: new DatabaseStorage(),
    objectStorage: new ObjectStorageService(),
    imageAnalysis: { analyzeImage },
  };
}

export async function createTestServices(config: AppConfig): Promise<AppServices> {
  return {
    storage: new FakeDatabaseStorage(),
    objectStorage: new FakeObjectStorageService(),
    imageAnalysis: fakeImageAnalysis, // Returns deterministic canned responses
  };
}
```

**Usage in Routes:**

```typescript
// server/routes.ts
export async function registerRoutes(app: Express, services: AppServices): Promise<Server> {
  const { storage, objectStorage, imageAnalysis } = services;

  app.post('/api/items', upload.array('images', 10), wrap(async (req, res) => {
    // Use injected services instead of global imports
    const analysis = await imageAnalysis.analyzeImage(imageBase64);
    const item = await storage.createItem({ ... });
    res.json(item);
  }));
}
```

**Usage in Production:**

```typescript
// server/index.ts
const config = loadAppConfig(); // Validates all env vars
const services = await createProdServices(config);
const server = await registerRoutes(app, services);
```

**Usage in Tests:**

```typescript
// server/tests/my-test.spec.ts
const config = loadAppConfig();
const services = await createTestServices(config);
const server = await registerRoutes(app, services);

// Tests use fake in-memory storage, no database required
```

**Anti-Patterns to Avoid:**

❌ **Singleton Exports:**
```typescript
// server/storage.ts (BEFORE PRD 0005 - WRONG)
export const storage = new DatabaseStorage(); // Global state, untestable
```

❌ **Inline Service Instantiation:**
```typescript
// server/routes.ts (BEFORE PRD 0005 - WRONG)
export async function registerRoutes(app: Express) {
  const objectStorage = new ObjectStorageService(); // Cannot inject fakes
}
```

❌ **Module-Level Configuration:**
```typescript
// server/openai.ts (BEFORE PRD 0005 - WRONG)
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL, // No validation
});
```

✅ **Correct Pattern (PRD 0005):**
- Configuration validated once at startup via `loadAppConfig()`
- Services instantiated by factories (`createProdServices`, `createTestServices`)
- Services injected via function parameters (`registerRoutes(app, services)`)
- No global singletons or module-level service instances

**Test Isolation:**
Fake implementations enable deterministic, fast tests:

```typescript
// server/services.ts
export class FakeDatabaseStorage implements IStorage {
  private items = new Map<string, InventoryItem>();

  async createItem(item: InsertInventoryItem): Promise<InventoryItem> {
    const id = randomUUID();
    const newItem = { id, createdAt: new Date().toISOString(), ...item };
    this.items.set(id, newItem);
    return newItem;
  }

  clear() { this.items.clear(); } // Test helper
}
```

Tests use in-memory fakes instead of real database/API calls, ensuring:
- **Speed:** No network I/O, no database setup/teardown
- **Determinism:** Same inputs always produce same outputs
- **Isolation:** Tests don't depend on external services

**Future Extensions:**
- **Logging Service:** Centralized structured logging (e.g., Pino, Winston)
- **Cache Service:** Redis/in-memory cache for frequently accessed data
- **Email Service:** Transactional email notifications (e.g., SendGrid, Postmark)
- **Background Jobs:** Queue system for async processing (e.g., BullMQ, Graphile Worker)

All future services follow the same pattern: added to `AppServices` interface, implemented in production and test factories, injected into routes.

---

## Evolution Roadmap

### Multi-Image Migration (PRD 0004 - Est. 3-4 weeks)

**Phase 1: Schema Evolution**
- Add `imageUrls` array column to `inventory_items`
- Backfill existing data: `image_urls = ARRAY[image_url]`
- Dual-write period: Populate both `imageUrl` and `imageUrls`

**Phase 2: Backend Multi-Upload**
- Change `upload.single("image")` to `upload.array("images", 10)`
- Update storage logic to save multiple files: `/objects/items/{itemId}/{index}.{ext}`
- Update API response to include `imageUrls` array

**Phase 3: Frontend Gallery**
- Create `ImageGallery.tsx` component
- Update `ItemCard.tsx` to show primary image + count badge
- Add image viewer modal with prev/next navigation

**Phase 4: Upload UX**
- Extend `uploadService.ts` with `createItemMultiUploadFormData()`
- Add drag-and-drop multi-file upload
- Show upload progress for each file

**Phase 5: Migration Completion**
- UI fully migrated to `imageUrls[0]` instead of `imageUrl`
- Deprecate `imageUrl` column (6+ months after Phase 1)
- Update E2E tests to verify multi-image flows

**Estimated Complexity:** Medium (requires schema migration, backwards compatibility)

---

### Container Hierarchy Implementation (PRD 0005 - Est. 4-5 weeks)

**Phase 1: Schema & API**
- Add `containers` table with `parent_id` self-reference
- Add `/api/containers` CRUD endpoints
- Implement recursive CTE queries for subtree traversal

**Phase 2: UI Components**
- Create `ContainerTree.tsx` (hierarchical navigation)
- Add breadcrumb navigation: "Property > Room > Box"
- Drag-and-drop to move items between containers

**Phase 3: Migration from Location Field**
- Parse existing `location` text into container hierarchy
- Dual-write period: Update both `location` and `container_id`
- UI shows container path instead of free-text location

**Phase 4: Printable Index Sheets**
- Generate PDF with container barcode + item list
- Add QR codes for mobile scanning
- Support custom templates per vertical

**Estimated Complexity:** High (recursive queries, data migration, complex UI)

---

### Vertical Attribute Extensibility (PRD 0006 - Est. 2-3 weeks)

**Phase 1: Auto Parts Vertical**
- Create `auto_parts_attributes` table
- Add fitment search API: `/api/search/auto-parts`
- Build auto-parts-specific UI filters

**Phase 2: Storage Business Vertical**
- Create `storage_business_attributes` table
- Add client portal with restricted item access
- Implement contract/billing workflows

**Phase 3: JSONB Fallback**
- Add `vertical_attributes` JSONB column for experimental verticals
- Document promotion path (JSONB → dedicated table)

**Estimated Complexity:** Medium per vertical (separate table + API + UI)

---

## Integration Patterns

### Pattern 1: Adding New Media Types (Video, PDF)

**Problem:** Need to support video uploads, PDF manuals, 3D models.

**Solution:**

1. **Update File Validation:**
```typescript
// server/fileValidation.ts
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime', // NEW
  'application/pdf', // NEW
];

function getMimeTypeFromBuffer(buffer: Buffer): string | null {
  // ...existing image checks...

  // Video: MP4 signature (00 00 00 [18|20] 66 74 79 70)
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return 'video/mp4';
  }

  // PDF signature (25 50 44 46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }

  return null;
}
```

2. **Update MIME to Extension Mapping:**
```typescript
// server/routes.ts
const mimeToExt: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4', // NEW
  'video/quicktime': 'mov', // NEW
  'application/pdf': 'pdf', // NEW
};
```

3. **Update UI to Handle Media Types:**
```typescript
// client/src/components/MediaViewer.tsx
function MediaViewer({ url, mimeType }: { url: string; mimeType: string }) {
  if (mimeType.startsWith('image/')) {
    return <img src={url} alt="Item media" />;
  } else if (mimeType.startsWith('video/')) {
    return <video src={url} controls />;
  } else if (mimeType === 'application/pdf') {
    return <embed src={url} type="application/pdf" width="100%" height="600px" />;
  }
  return <a href={url} download>Download {mimeType}</a>;
}
```

---

### Pattern 2: Extending ObjectStorageService for New Backends

**Problem:** Need to support AWS S3, Azure Blob Storage, or other cloud providers.

**Solution (following PRD 0002 pattern):**

1. **Add Environment Variable:**
```bash
# .env
STORAGE_BACKEND=s3  # or 'gcs', 'local', 'azure'
AWS_REGION=us-east-1
AWS_S3_BUCKET=my-inventory-bucket
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

2. **Extend ObjectStorageService:**
```typescript
// server/objectStorage.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const storageBackend = process.env.STORAGE_BACKEND || (isReplit ? 'gcs' : 'local');
const s3Client = storageBackend === 's3' ? new S3Client({ region: process.env.AWS_REGION }) : null;

export class ObjectStorageService {
  // ...existing methods...

  async saveToS3(relativePath: string, buffer: Buffer, contentType: string): Promise<void> {
    if (!s3Client) throw new Error("S3 not configured");

    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: relativePath,
      Body: buffer,
      ContentType: contentType,
    }));
  }

  async downloadFromS3(relativePath: string, res: Response): Promise<void> {
    if (!s3Client) throw new Error("S3 not configured");

    const response = await s3Client.send(new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: relativePath,
    }));

    res.set("Content-Type", response.ContentType || "application/octet-stream");
    response.Body.pipe(res);
  }
}
```

3. **Update Routes to Use New Backend:**
```typescript
// server/routes.ts
app.post("/api/items", upload.single("image"), wrap(async (req, res) => {
  // ...validation...

  const ext = mimeToExt[req.file.mimetype] || 'jpg';
  const imageUrl = `/objects/items/${objectId}.${ext}`;

  if (storageBackend === 'gcs') {
    // Existing GCS logic
  } else if (storageBackend === 's3') {
    await objectStorageService.saveToS3(`items/${objectId}.${ext}`, req.file.buffer, req.file.mimetype);
  } else {
    // Local filesystem
    await objectStorageService.saveLocalFile(`items/${objectId}.${ext}`, req.file.buffer);
  }

  // ...rest of handler...
}));
```

**Key Point:** Follow the same pattern as PRD 0002:
- Environment variable controls backend
- Service methods are backend-agnostic where possible
- Routes handle backend dispatch logic
- Zero changes to UI (same `/objects/*` URLs)

---

### Pattern 3: Creating Vertical-Specific Customizations

**Problem:** Auto parts vertical needs custom UI, API, and business logic.

**Solution: Vertical Plugin Pattern**

**Structure:**
```
server/verticals/
  auto-parts/
    schema.ts        # Auto-parts-specific tables
    routes.ts        # Vertical-specific API endpoints
    search.ts        # Custom search logic
  storage-business/
    schema.ts
    routes.ts
    billing.ts       # Billing/contract logic

client/src/verticals/
  auto-parts/
    FitmentSearch.tsx   # Custom UI for fitment filters
    PartNumberLookup.tsx
  storage-business/
    ClientPortal.tsx
    ContractManager.tsx
```

**Backend Integration:**
```typescript
// server/index.ts
import { registerAutoPartsRoutes } from "./verticals/auto-parts/routes";
import { registerStorageBusinessRoutes } from "./verticals/storage-business/routes";

async function startServer() {
  // ...core routes...
  await registerRoutes(app);

  // Vertical-specific routes
  if (process.env.ENABLE_AUTO_PARTS_VERTICAL === 'true') {
    await registerAutoPartsRoutes(app);
  }
  if (process.env.ENABLE_STORAGE_BUSINESS_VERTICAL === 'true') {
    await registerStorageBusinessRoutes(app);
  }

  // ...start server...
}
```

**Frontend Integration:**
```typescript
// client/src/pages/home.tsx
import { AutoPartsFitmentSearch } from "@/verticals/auto-parts/FitmentSearch";

const isAutoPartsMode = import.meta.env.VITE_VERTICAL === 'auto-parts';

<SearchFilter {...props} />
{isAutoPartsMode && <AutoPartsFitmentSearch />}
```

**Benefits:**
- Vertical code is isolated (easy to maintain, test)
- Core system remains clean (no vertical-specific clutter)
- Verticals can be enabled/disabled via config
- Multiple verticals can coexist

---

## Anti-Patterns

### Anti-Pattern 1: Hard-Coding File Paths

**❌ Bad:**
```typescript
const imageUrl = `/objects/items/${objectId}.jpg`; // Always .jpg
```

**Why Bad:**
- Breaks when user uploads PNG or WebP
- Prevents future support for other formats (AVIF, HEIC)
- Misleading file extension (PNG saved as .jpg)

**✅ Good:**
```typescript
const ext = mimeToExt[req.file.mimetype] || 'jpg';
const imageUrl = `/objects/items/${objectId}.${ext}`;
```

**Lesson:** Infer file properties from validated data, don't assume.

---

### Anti-Pattern 2: Tight Coupling of Upload Logic to UI

**❌ Bad:**
```typescript
// home.tsx
const handleUpload = (file: File) => {
  const formData = new FormData();
  formData.append("image", file, file.name);
  mutate(formData);
};

// camera-capture.tsx (duplicated)
const handleCapture = (blob: Blob) => {
  const formData = new FormData();
  formData.append("image", blob, "capture.jpg");
  mutate(formData);
};
```

**Why Bad:**
- Logic duplicated across components
- Adding compression/validation requires updating multiple places
- Future multi-image upload would need to refactor all call sites

**✅ Good:**
```typescript
// lib/uploadService.ts
export function createItemUploadFormData(blob: Blob, filename: string): FormData {
  const formData = new FormData();
  formData.append("image", blob, filename);
  return formData;
}

// Both components use service:
mutate(createItemUploadFormData(file, file.name));
```

---

### Anti-Pattern 3: Testing Implementation Details

**❌ Bad:**
```typescript
test('Uppy state updates correctly', async () => {
  const uppy = mount(<ObjectUploader />).instance().uppy;
  expect(uppy.getFiles()).toHaveLength(0);
  uppy.addFile({ ... });
  expect(uppy.getState().files).toHaveLength(1);
});
```

**Why Bad:**
- Test breaks if Uppy replaced with native input
- Doesn't verify user-facing behavior
- Over-specifies internal implementation

**✅ Good:**
```typescript
test('user can upload file and see it in item list', async ({ page }) => {
  await page.locator('[data-testid="file-input"]').setInputFiles('test.jpg');
  await expect(page.locator('text=Test Item')).toBeVisible();
});
```

---

### Anti-Pattern 4: Schema Explosion for Verticals

**❌ Bad:**
```typescript
// Adding columns for every vertical
export const inventoryItems = pgTable("inventory_items", {
  // ...core fields...

  // Auto parts
  partNumber: text("part_number"),
  fitmentMake: text("fitment_make"),
  fitmentModel: text("fitment_model"),

  // Storage business
  clientId: varchar("client_id"),
  storageLocation: text("storage_location"),

  // Insurance
  policyNumber: text("policy_number"),
  claimDate: text("claim_date"),

  // ...50+ more columns for all verticals...
});
```

**Why Bad:**
- Most fields are NULL for most items (wasted space)
- Schema becomes unmanageable
- Migrations are expensive
- Hard to enforce vertical-specific constraints

**✅ Good:**
Use separate tables or JSONB:
```typescript
// Separate table for structured, searchable attributes
export const autoPartsAttributes = pgTable("auto_parts_attributes", {
  itemId: varchar("item_id").references(() => inventoryItems.id),
  partNumber: text("part_number").notNull(),
  fitmentMake: text("fitment_make"),
  // ...
});

// OR JSONB for flexible, rare attributes
export const inventoryItems = pgTable("inventory_items", {
  // ...core fields...
  verticalAttributes: jsonb("vertical_attributes").default({}),
});
```

---

## Cross-References

### Primary Documents
- **CONTEXT.md** - Project overview, current architecture, testing strategy
- **tasks/0003-prd-foundational-architecture.md** - This foundation's PRD
- **tasks/0002-prd-dual-env-image-persistence.md** - Dual-backend storage implementation

### Key Implementation Files
- **`server/objectStorage.ts:45-361`** - ObjectStorageService (Principle 2)
- **`server/objectStorage.ts:274-283`** - saveLocalFile (multi-file ready)
- **`server/routes.ts:51-120`** - POST /api/items upload handler
- **`server/fileValidation.ts:19-105`** - MIME type validation
- **`shared/schema.ts:6-32`** - Current database schema
- **`client/src/lib/uploadService.ts`** - Reusable upload utilities (Principle 3)

### Test References
- **`e2e/image-fallback.spec.ts`** - E2E determinism patterns (Principle 7)
- **`client/src/__tests__/ObjectUploader.spec.tsx`** - Component tests (to be updated)

### Design Guidelines
- **`design_guidelines.md`** - UI/UX patterns, component design

---

## Document Maintenance

**Last Updated:** 2025-11-13
**Version:** 1.0
**Next Review:** After PRD 0004 (Multi-Image) implementation

**Maintainers:**
- Update this document when architectural patterns change
- Add new principles if foundational patterns emerge
- Keep code examples synchronized with implementation
- Reference this document in all future PRDs

**Change Log:**
- 2025-11-13: Initial version (PRD 0003)

---

**End of FOUNDATION.md**
