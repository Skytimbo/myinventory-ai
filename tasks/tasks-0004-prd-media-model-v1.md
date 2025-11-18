# Task List: PRD 0004 - Media Model v1: Multi-Image Support
1
**PRD:** `0004-prd-media-model-v1.md`
**Status:** COMPLETE
**Created:** 2025-11-13
**Completed:** 2025-11-18

---

## Relevant Files

### Documentation
- `FOUNDATION.md` — Architectural principles (Principle 1: Media as First-Class Concept)
- `CONTEXT.md` — Documentation map
- `tasks/0004-prd-media-model-v1.md` — This PRD

### Database
- `shared/schema.ts` — Database schema (add imageUrls array field)
- `server/storage.ts` — Data access layer (lazy migration logic)
- `scripts/db-reset.ts` — Database reset script
- `scripts/db-seed.ts` — Test data seeding (add multi-image test items)

### Backend
- `server/routes.ts` — API routes (extend POST /api/items for multi-image)
- `server/objectStorage.ts` — Storage abstraction (path validation update)
- `server/fileValidation.ts` — File validation (validate each image in array)

### Frontend
- `client/src/lib/uploadService.ts` — Upload utilities (add createItemMultiUploadFormData)
- `client/src/pages/home.tsx` — Upload flows (file input with multiple attribute)
- `client/src/components/ItemCard.tsx` — Item display (show primary image + count badge)
- `client/src/components/ItemDetailGallery.tsx` — NEW: Minimal gallery component (thumbnails + click to swap)

### Testing
- `e2e/multi-image-upload.spec.ts` — NEW: Multi-image E2E tests
- `e2e/backwards-compat.spec.ts` — NEW: Legacy single-image tests
- `server/tests/routes.spec.ts` — Backend multi-image upload tests
- `client/src/__tests__/uploadService.spec.ts` — Upload service unit tests

---

## Notes

**Scope Revision (2025-11-13):**
This task list reflects a **narrowed scope** focusing on minimal viable multi-image support:
- ✅ Multi-image file input (standard `<input type="file" multiple>`)
- ✅ Minimal gallery (primary image + thumbnail row, click to swap)
- ❌ Multi-image camera capture (deferred to future PRD)
- ❌ Advanced interactions (keyboard nav, swipe, animations - deferred)
- ❌ Complex preview UI with per-image removal (deferred)

**Core Constraints:**
- **Backwards compatibility is critical**: All existing single-image items must continue to work
- **Schema change is additive**: imageUrl remains NOT NULL, imageUrls is nullable
- **Lazy migration strategy**: Populate imageUrls from imageUrl on first read (no blocking scripts)
- **Storage paths**: Multi-image items use `/objects/items/{itemId}/{index}.{ext}` pattern
- **Max 10 images per item**: Configurable via multer limit
- **Primary image**: First image in imageUrls array is primary (displays in grid view)

---

## Parent Tasks

### 1.0 Database Schema & Migration Strategy

**Description**: Add `imageUrls` array column to inventory_items table, implement lazy migration from existing `imageUrl` to `imageUrls`, ensure backwards compatibility.

**Deliverables**:
- Add `imageUrls: text("image_urls").array()` to `shared/schema.ts`
- Update TypeScript types (InsertInventoryItem, InventoryItem)
- Implement lazy migration in `storage.getItem()` and `storage.getItems()`
- Create optional backfill migration script
- Update database seed script to include multi-image test items

**Acceptance Criteria**:
- `imageUrls` column exists in database (nullable)
- Legacy items with NULL `imageUrls` automatically populated on read
- TypeScript types reflect new schema (optional imageUrls field)
- Seed script creates 2-3 multi-image test items
- All existing single-image data preserved (imageUrl still NOT NULL)

**Estimated Effort**: 2-3 hours

**Files Modified**:
- `shared/schema.ts`
- `server/storage.ts`
- `scripts/db-seed.ts`
- `scripts/migrate-image-urls.sql` (NEW, optional)

---

### 2.0 Backend Multi-Image Upload & Storage

**Description**: Extend POST /api/items endpoint to accept multiple images, save each image with index-based naming, generate imageUrls array, maintain backwards compatibility with single-image uploads.

**Deliverables**:
- Change `upload.single("image")` to `upload.array("images", 10)` in routes.ts
- Implement multi-file processing loop (save each image with index)
- Update storage paths from `/objects/items/{uuid}.{ext}` to `/objects/items/{uuid}/{index}.{ext}`
- Update path validation regex in objectStorage.ts
- Populate both `imageUrl` (primary) and `imageUrls` (array) in createItem call
- Handle backwards compatibility (single `image` field still works)

**Acceptance Criteria**:
- POST /api/items accepts `images[]` field (array of files)
- Each image saved to storage with correct index-based filename
- imageUrls array contains all uploaded image URLs
- imageUrl contains first image URL (primary)
- Single-image uploads still work (backwards compatible)
- AI analysis runs only on first image (primary)
- Path validation allows both legacy and new multi-file patterns

**Estimated Effort**: 4-5 hours

**Files Modified**:
- `server/routes.ts`
- `server/objectStorage.ts`
- `server/storage.ts` (update createItem interface)

---

### 3.0 Upload Service & Multi-File Input

**Description**: Extend uploadService with multi-image FormData utility, update file input to support multiple selection. Single-image camera capture remains unchanged (multi-capture deferred to future PRD).

**Deliverables**:
- Add `createItemMultiUploadFormData(imageBlobs[], filenames?)` to uploadService.ts
- Update home.tsx file input to use `multiple` attribute
- Simple thumbnail preview list (optional, basic only - no removal UI)
- Integrate multi-image upload with TanStack mutation
- Camera capture remains single-image (unchanged)

**Acceptance Criteria**:
- `createItemMultiUploadFormData()` function exists and works
- File input allows selecting 1-10 images via `multiple` attribute
- Optional: Simple list showing selected filenames or small thumbnails
- Upload mutation uses correct FormData structure (images[] field)
- Single-image upload flow still works (backwards compatible)
- Camera capture unchanged (single image only)

**Estimated Effort**: 3-4 hours

**Files Modified**:
- `client/src/lib/uploadService.ts`
- `client/src/pages/home.tsx`

**Files NOT Modified** (out of scope):
- `client/src/components/CameraCapture.tsx` (no multi-capture changes)

---

### 4.0 Frontend Minimal Gallery Display

**Description**: Update ItemCard to show primary image + simple count badge, create basic ItemDetailGallery component with thumbnails and click-to-swap functionality. No advanced interactions (keyboard nav, swipe, animations deferred to future Gallery UX PRD).

**Deliverables**:
- Update ItemCard to use `imageUrls[0] || imageUrl` for primary image
- Add simple image count badge ("📷 3") for multi-image items
- Create basic ItemDetailGallery component:
  - Display primary image (large)
  - Row of thumbnails below
  - Click thumbnail to swap primary (no animations)
- Ensure legacy items display correctly (no gallery if imageUrls is null)
- Basic alt text on all images

**Acceptance Criteria**:
- ItemCard displays correct primary image (imageUrls[0] or imageUrl fallback)
- Multi-image items show count badge ("📷 3")
- Single-image items do not show badge or gallery
- ItemDetailGallery renders thumbnail row for multi-image items
- Clicking thumbnail swaps primary image (simple state update, no animation)
- Legacy single-image items display without gallery (backwards compatible)
- Alt text present on images (basic: "{itemName} - Image {index}")

**Out of Scope** (defer to future PRD):
- Keyboard navigation (arrow keys)
- Touch/swipe gestures
- Fullscreen/lightbox mode
- CSS animations/transitions
- Advanced accessibility beyond alt text

**Estimated Effort**: 3-4 hours

**Files Modified**:
- `client/src/components/ItemCard.tsx`
- `client/src/components/ItemDetailGallery.tsx` (NEW component, minimal)

**Files Deferred**:
- Advanced gallery styles (animations, transitions)
- Keyboard/touch interaction handlers

---

### 5.0 Minimal Testing & Backwards Compatibility

**Description**: Write narrow, behavior-focused tests for multi-image upload and display. Validate backwards compatibility with legacy single-image items. No tests for advanced interactions (deferred to future PRD).

**Deliverables**:
- **1 E2E test**: Upload 3 images via file input, verify all saved and displayed in gallery
- **1 E2E test**: Legacy single-image item displays correctly (no gallery, backwards compatible)
- **Unit test**: `createItemMultiUploadFormData()` with multiple images
- **Unit test**: `storage.getItem()` lazy migration (populate imageUrls from imageUrl)
- Verify all existing tests still pass (no regression)

**Acceptance Criteria**:
- Multi-image upload E2E test passes (file input → upload → display)
- Backwards compatibility E2E test passes (legacy items work)
- Unit tests cover new uploadService function and lazy migration logic
- All existing tests pass without modification (backwards compatible)
- E2E tests use deterministic stubbed responses
- Tests assert behavior only (not implementation details)

**Out of Scope** (defer to future PRD):
- Advanced interaction tests (keyboard nav, swipe, animations)
- Multi-image camera capture tests

**Estimated Effort**: 3-4 hours

**Files Created**:
- `e2e/multi-image-upload.spec.ts` (NEW, 1 test)
- `e2e/backwards-compat.spec.ts` (NEW, 1 test)

**Files Modified**:
- `server/tests/routes.spec.ts` (add multi-image upload test)
- `client/src/__tests__/uploadService.spec.ts` (add multi-image test)

---

## Task Dependencies

```
1.0 (Schema) ──┬──> 2.0 (Backend)
               │
               └──> 5.0 (Testing)

2.0 (Backend) ──┬──> 3.0 (Upload)
                │
                └──> 4.0 (Display)

3.0 (Upload) ───> 5.0 (Testing)
4.0 (Display) ──> 5.0 (Testing)
```

**Critical Path**:
1.0 → 2.0 → 3.0 → 4.0 → 5.0

**Parallelizable**:
- 3.0 and 4.0 can be worked on in parallel after 2.0 completes
- Testing can begin as soon as each component completes (incremental)

---

## Success Criteria Summary

**Functional:**
- [x] Users can upload 2-10 images during item creation
- [x] All images save to storage with correct paths
- [x] Item detail view shows image gallery
- [x] Primary image displays in grid view
- [x] Image count badge shows for multi-image items
- [x] Legacy single-image items work without regression

**Technical:**
- [x] `imageUrls` column in database schema
- [x] POST /api/items accepts images[] array
- [x] `createItemMultiUploadFormData()` in uploadService
- [x] ItemDetailGallery component exists
- [x] Lazy migration populates imageUrls on read
- [x] All tests pass (existing + new)

**Performance:**
- [x] 5-image upload completes in <10 seconds
- [x] Gallery renders without flicker
- [x] No regression in single-image load times

**UX:**
- [x] Multi-image upload works on mobile (file input)
- [x] Basic alt text on gallery images
- [x] No confusion for existing users (backwards compatible)

---

**Status Update**: Parent tasks approved. Expanded into detailed subtasks below.

---

---

# Detailed Subtasks

## Task 1.0: Database Schema & Migration Strategy (2-3 hours)

### 1.1 Add imageUrls Column to Schema (30 min)

**Description**: Add nullable `imageUrls` text array column to `inventoryItems` table definition in shared/schema.ts.

**File Changes**:
- `shared/schema.ts` (line ~12, after imageUrl field)

**Implementation**:
```typescript
// Add after line 12 (imageUrl field):
imageUrls: text("image_urls").array().$type<string[]>(), // FOUNDATION: Multi-image support (PRD 0004)
```

**Acceptance Criteria**:
- [ ] `imageUrls` field added to schema definition
- [ ] Field type is `text("image_urls").array()`
- [ ] Field is nullable (no `.notNull()`)
- [ ] TypeScript type annotation includes `.$type<string[]>()`
- [ ] Comment references PRD 0004

**Dependencies**: None

**Estimated Effort**: 30 minutes

---

### 1.2 Update TypeScript Types (15 min)

**Description**: Verify that `InsertInventoryItem` and `InventoryItem` types automatically include the new `imageUrls` field as optional.

**File Changes**:
- `shared/schema.ts` (types at bottom of file)

**Acceptance Criteria**:
- [ ] `InventoryItem` type includes `imageUrls?: string[] | null`
- [ ] `InsertInventoryItem` type includes optional `imageUrls`
- [ ] No manual type overrides needed (Drizzle infers correctly)
- [ ] TypeScript compilation succeeds

**Dependencies**: 1.1

**Estimated Effort**: 15 minutes

---

### 1.3 Run Database Migration (15 min)

**Description**: Generate and run Drizzle migration to add `image_urls` column to database.

**File Changes**:
- `migrations/` (new migration file generated)

**Commands**:
```bash
pnpm db:push  # or pnpm drizzle-kit push (depending on setup)
```

**Acceptance Criteria**:
- [ ] Migration file generated successfully
- [ ] `image_urls` column exists in `inventory_items` table
- [ ] Column type is `text[]` (PostgreSQL array)
- [ ] Column is nullable
- [ ] Existing rows have `image_urls` = NULL

**Dependencies**: 1.1, 1.2

**Estimated Effort**: 15 minutes

---

### 1.4 Implement Lazy Migration in storage.getItem() (45 min)

**Description**: Add logic to `storage.getItem()` to automatically populate `imageUrls` from `imageUrl` when `imageUrls` is null (backwards compatibility for legacy items).

**File Changes**:
- `server/storage.ts` (in `getItem()` function)

**Implementation**:
```typescript
async getItem(id: string): Promise<InventoryItem | null> {
  const item = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, id))
    .limit(1)
    .then(rows => rows[0] || null);

  // Lazy migration: populate imageUrls from imageUrl if null
  if (item && !item.imageUrls) {
    item.imageUrls = [item.imageUrl];
  }

  return item;
}
```

**Acceptance Criteria**:
- [ ] When `imageUrls` is null, it gets populated with `[imageUrl]`
- [ ] When `imageUrls` already has data, it's not modified
- [ ] Logic is read-only (no database writes)
- [ ] Works for legacy single-image items

**Dependencies**: 1.3

**Estimated Effort**: 45 minutes

---

### 1.5 Implement Lazy Migration in storage.getItems() (30 min)

**Description**: Add same lazy migration logic to `storage.getItems()` to handle batch queries.

**File Changes**:
- `server/storage.ts` (in `getItems()` function)

**Implementation**:
```typescript
async getItems(): Promise<InventoryItem[]> {
  const items = await db.select().from(inventoryItems);

  // Lazy migration: populate imageUrls from imageUrl if null
  return items.map(item => {
    if (!item.imageUrls) {
      item.imageUrls = [item.imageUrl];
    }
    return item;
  });
}
```

**Acceptance Criteria**:
- [ ] All returned items have populated `imageUrls`
- [ ] Logic matches `getItem()` implementation
- [ ] No database writes
- [ ] Performance impact negligible (in-memory operation)

**Dependencies**: 1.4

**Estimated Effort**: 30 minutes

---

### 1.6 Add Multi-Image Test Items to Seed Script (45 min)

**Description**: Update `scripts/db-seed.ts` to create 2-3 test items with multiple images (imageUrls populated).

**File Changes**:
- `scripts/db-seed.ts`

**Implementation**:
```typescript
// Add multi-image test items
await storage.createItem({
  name: "Vintage Camera Collection",
  description: "Three classic film cameras",
  category: "Photography",
  tags: ["vintage", "cameras"],
  imageUrl: "/objects/items/test-multi-1/0.jpg", // Primary
  imageUrls: [
    "/objects/items/test-multi-1/0.jpg",
    "/objects/items/test-multi-1/1.jpg",
    "/objects/items/test-multi-1/2.jpg",
  ],
  barcodeData: "MULTI001",
  // ... other fields
});
```

**Acceptance Criteria**:
- [ ] 2-3 new test items with `imageUrls` arrays (2-4 images each)
- [ ] `imageUrl` matches first element of `imageUrls`
- [ ] Image URLs follow pattern `/objects/items/{id}/{index}.jpg`
- [ ] Seed script runs without errors
- [ ] Items appear in database with correct data

**Dependencies**: 1.3

**Estimated Effort**: 45 minutes

---

### 1.7 (Optional) Create Backfill Migration Script (30 min)

**Description**: Create optional SQL script to backfill `imageUrls` for all existing items (non-blocking, can run later).

**File Changes**:
- `scripts/migrate-image-urls.sql` (NEW)

**Implementation**:
```sql
-- Backfill imageUrls from imageUrl for all items where imageUrls is NULL
UPDATE inventory_items
SET image_urls = ARRAY[image_url]
WHERE image_urls IS NULL;
```

**Acceptance Criteria**:
- [ ] SQL script exists in `scripts/` directory
- [ ] Script safely handles NULL checks
- [ ] Script is idempotent (can run multiple times)
- [ ] Documentation comment explains purpose
- [ ] Script is NOT required for lazy migration (optional optimization)

**Dependencies**: 1.3

**Estimated Effort**: 30 minutes (optional)

---

## Task 2.0: Backend Multi-Image Upload & Storage (4-5 hours)

### 2.1 Change Upload Middleware to Array Mode (30 min)

**Description**: Update POST /api/items endpoint to use `upload.array("images", 10)` instead of `upload.single("image")`.

**File Changes**:
- `server/routes.ts` (POST /api/items endpoint)

**Implementation**:
```typescript
// Change from:
app.post("/api/items", upload.single("image"), wrap(async (req, res) => {

// To:
app.post("/api/items", upload.array("images", 10), wrap(async (req, res) => {
  const files = req.files as Express.Multer.File[];
  // ...
```

**Acceptance Criteria**:
- [ ] Middleware accepts `images` field (plural)
- [ ] Maximum 10 files allowed
- [ ] `req.files` is array of files
- [ ] Endpoint still compiles and starts

**Dependencies**: None

**Estimated Effort**: 30 minutes

---

### 2.2 Add Backwards Compatibility for Single Image (45 min)

**Description**: Detect if client sends single `image` field vs. `images[]` array and normalize to array internally.

**File Changes**:
- `server/routes.ts` (POST /api/items handler)

**Implementation**:
```typescript
app.post("/api/items", upload.array("images", 10), wrap(async (req, res) => {
  let files = req.files as Express.Multer.File[];

  // Backwards compatibility: if no files, check for single image
  if (!files || files.length === 0) {
    const singleFile = req.file; // from upload.single() fallback
    if (singleFile) {
      files = [singleFile];
    }
  }

  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No images provided" });
  }

  // Continue with files array...
```

**Acceptance Criteria**:
- [ ] Single-image uploads still work (legacy clients)
- [ ] Multi-image uploads work (new clients)
- [ ] Error returned if no images provided
- [ ] Both flows normalized to `files[]` array

**Dependencies**: 2.1

**Estimated Effort**: 45 minutes

---

### 2.3 Generate Item ID and Prepare Storage Paths (30 min)

**Description**: Generate item UUID early, construct storage paths for each image using index pattern.

**File Changes**:
- `server/routes.ts` (POST /api/items handler)

**Implementation**:
```typescript
const itemId = randomUUID();

// Generate storage paths for each image
const imageStoragePaths: string[] = [];
const imageUrls: string[] = [];

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const ext = getExtensionForMimeType(file.mimetype) || "jpg";
  const storagePath = `items/${itemId}/${i}.${ext}`;
  const imageUrl = `/objects/items/${itemId}/${i}.${ext}`;

  imageStoragePaths.push(storagePath);
  imageUrls.push(imageUrl);
}
```

**Acceptance Criteria**:
- [ ] Item ID generated once for all images
- [ ] Storage paths use pattern `items/{itemId}/{index}.{ext}`
- [ ] Image URLs use pattern `/objects/items/{itemId}/{index}.{ext}`
- [ ] Extension determined from MIME type
- [ ] Arrays have same length as files array

**Dependencies**: 2.2

**Estimated Effort**: 30 minutes

---

### 2.4 Save All Images to Storage (1 hour)

**Description**: Loop through all uploaded files and save each to object storage using index-based paths.

**File Changes**:
- `server/routes.ts` (POST /api/items handler)

**Implementation**:
```typescript
// Save all images to storage
for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const storagePath = imageStoragePaths[i];

  await objectStorageService.saveLocalFile(storagePath, file.buffer);
}
```

**Acceptance Criteria**:
- [ ] All images saved to correct paths
- [ ] Files saved with correct index (0, 1, 2, ...)
- [ ] Storage directories created automatically
- [ ] Error handling for failed saves
- [ ] Works for both single and multiple images

**Dependencies**: 2.3

**Estimated Effort**: 1 hour

---

### 2.5 Run AI Analysis on Primary Image Only (45 min)

**Description**: Extract AI analysis logic to run only on first image (primary), not all images.

**File Changes**:
- `server/routes.ts` (POST /api/items handler)

**Implementation**:
```typescript
// Run AI analysis only on first image (primary)
const primaryFile = files[0];
const analysisResult = await analyzeImageWithAI(primaryFile.buffer);

// Extract fields from analysis
const { name, description, category, tags, estimatedValue, ... } = analysisResult;
```

**Acceptance Criteria**:
- [ ] AI analysis runs only once (primary image)
- [ ] Analysis uses `files[0]`
- [ ] All other images skip analysis
- [ ] Performance: multi-image upload not slower than single-image

**Dependencies**: 2.4

**Estimated Effort**: 45 minutes

---

### 2.6 Update createItem Call with imageUrls (30 min)

**Description**: Pass both `imageUrl` (primary) and `imageUrls` (array) to storage.createItem().

**File Changes**:
- `server/routes.ts` (POST /api/items handler)
- `server/storage.ts` (update `createItem` interface)

**Implementation**:
```typescript
// In routes.ts:
const newItem = await storage.createItem({
  name,
  description,
  category,
  tags,
  imageUrl: imageUrls[0], // Primary image
  imageUrls: imageUrls,   // All images
  barcodeData,
  // ... other fields
});

// In storage.ts - update InsertInventoryItem to accept imageUrls:
async createItem(item: InsertInventoryItem): Promise<InventoryItem> {
  // ... existing logic
}
```

**Acceptance Criteria**:
- [ ] `imageUrl` set to first URL in array
- [ ] `imageUrls` contains all URLs
- [ ] TypeScript types allow `imageUrls` field
- [ ] Database insert includes both fields
- [ ] Legacy single-image still works

**Dependencies**: 2.5

**Estimated Effort**: 30 minutes

---

### 2.7 Update Path Validation Regex (45 min)

**Description**: Update `validateObjectPath()` in objectStorage.ts to allow both legacy single-file paths and new multi-file directory paths.

**File Changes**:
- `server/objectStorage.ts` (line ~94, `validateObjectPath()`)

**Implementation**:
```typescript
// Update regex to allow both patterns:
// Legacy: /objects/items/uuid.jpg
// New: /objects/items/uuid/0.jpg
const pathRegex = /^\\/objects\\/[a-zA-Z0-9_-]+\\/([a-zA-Z0-9_\\-.]+|[a-zA-Z0-9_-]+\\/[0-9]+\\.[a-zA-Z0-9]+)$/;
```

**Acceptance Criteria**:
- [ ] Legacy paths still validate: `/objects/items/abc123.jpg`
- [ ] New paths validate: `/objects/items/abc123/0.jpg`
- [ ] Invalid paths rejected: `/objects/../etc/passwd`
- [ ] Security tests pass (no path traversal)
- [ ] Both patterns work in production

**Dependencies**: None (can be done in parallel)

**Estimated Effort**: 45 minutes

---

### 2.8 Test Backend Multi-Image Endpoint Manually (1 hour)

**Description**: Use curl or Postman to test multi-image upload endpoint before writing automated tests.

**Commands**:
```bash
# Test multi-image upload
curl -X POST http://localhost:3000/api/items \
  -F "images=@test1.jpg" \
  -F "images=@test2.jpg" \
  -F "images=@test3.jpg"

# Test single-image upload (backwards compat)
curl -X POST http://localhost:3000/api/items \
  -F "image=@test.jpg"
```

**Acceptance Criteria**:
- [ ] Multi-image upload returns 200 OK
- [ ] Response includes `imageUrls` array
- [ ] All images accessible via returned URLs
- [ ] Single-image upload still works
- [ ] Legacy clients not broken
- [ ] Database contains correct data

**Dependencies**: 2.1-2.6

**Estimated Effort**: 1 hour

---

## Task 3.0: Upload Service & Multi-File Input (3-4 hours)

### 3.1 Create createItemMultiUploadFormData Function (1 hour)

**Description**: Add new utility function to uploadService.ts for creating FormData with multiple images.

**File Changes**:
- `client/src/lib/uploadService.ts`

**Implementation**:
```typescript
/**
 * Create FormData for multi-image item upload
 *
 * @param imageBlobs - Array of image blobs (1-10 images)
 * @param filenames - Optional array of filenames (defaults to upload-{index}.jpg)
 * @returns FormData object with images[] field
 */
export function createItemMultiUploadFormData(
  imageBlobs: Blob[],
  filenames?: string[]
): FormData {
  const formData = new FormData();

  imageBlobs.forEach((blob, index) => {
    const filename = filenames?.[index] || `upload-${index}.jpg`;
    formData.append("images", blob, filename);
  });

  return formData;
}
```

**Acceptance Criteria**:
- [ ] Function accepts `Blob[]` and optional `string[]`
- [ ] FormData uses `images` field name (matches backend)
- [ ] Default filenames generated if not provided
- [ ] Works with 1-10 images
- [ ] TypeScript types correct

**Dependencies**: None

**Estimated Effort**: 1 hour

---

### 3.2 Update File Input to Support Multiple Selection (30 min)

**Description**: Add `multiple` attribute to file input in home.tsx to allow selecting multiple images.

**File Changes**:
- `client/src/pages/home.tsx` (file input element)

**Implementation**:
```typescript
<input
  type="file"
  accept="image/*"
  multiple  // NEW: Allow multiple file selection
  onChange={handleFileSelect}
  className="..."
/>
```

**Acceptance Criteria**:
- [ ] File input has `multiple` attribute
- [ ] Users can select 1-10 images
- [ ] File picker shows "multiple files" UI
- [ ] `onChange` handler receives FileList with multiple files
- [ ] Works on desktop and mobile browsers

**Dependencies**: None

**Estimated Effort**: 30 minutes

---

### 3.3 Handle Multiple File Selection in onChange Handler (1 hour)

**Description**: Update file input `onChange` handler to handle FileList with multiple files.

**File Changes**:
- `client/src/pages/home.tsx` (handleFileSelect or similar)

**Implementation**:
```typescript
const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
  const fileList = event.target.files;
  if (!fileList || fileList.length === 0) return;

  // Convert FileList to array
  const filesArray = Array.from(fileList);

  // Validate count (max 10)
  if (filesArray.length > 10) {
    alert("Maximum 10 images allowed");
    return;
  }

  // Convert to Blobs and store
  const blobs = filesArray.map(file => file as Blob);
  setSelectedImages(blobs);
  setFilenames(filesArray.map(f => f.name));
};
```

**Acceptance Criteria**:
- [ ] Handles FileList with 1-10 files
- [ ] Converts FileList to array
- [ ] Validates max 10 images
- [ ] Shows error if limit exceeded
- [ ] Stores blobs and filenames in state

**Dependencies**: 3.2

**Estimated Effort**: 1 hour

---

### 3.4 Integrate Multi-Image Upload with Mutation (45 min)

**Description**: Update TanStack Query mutation to use `createItemMultiUploadFormData` when multiple images selected.

**File Changes**:
- `client/src/pages/home.tsx` (upload mutation)

**Implementation**:
```typescript
const uploadMutation = useMutation({
  mutationFn: async () => {
    let formData: FormData;

    if (selectedImages.length > 1) {
      // Multi-image upload
      formData = createItemMultiUploadFormData(selectedImages, filenames);
    } else {
      // Single-image upload (backwards compatible)
      formData = createItemUploadFormData(selectedImages[0], filenames[0]);
    }

    const response = await fetch("/api/items", {
      method: "POST",
      body: formData,
    });

    return response.json();
  },
  // ... onSuccess, onError, etc.
});
```

**Acceptance Criteria**:
- [ ] Multi-image path uses new function
- [ ] Single-image path uses existing function
- [ ] Both paths work correctly
- [ ] Mutation handles errors
- [ ] Loading states work

**Dependencies**: 3.1, 3.3

**Estimated Effort**: 45 minutes

---

### 3.5 Add Simple Selected Files Preview (Optional) (1 hour)

**Description**: Display simple list of selected filenames or small thumbnails (basic UI, no removal).

**File Changes**:
- `client/src/pages/home.tsx`

**Implementation**:
```typescript
{selectedImages.length > 0 && (
  <div className="selected-files">
    <p>{selectedImages.length} image(s) selected:</p>
    <ul>
      {filenames.map((name, i) => (
        <li key={i}>{name}</li>
      ))}
    </ul>
  </div>
)}
```

**Acceptance Criteria**:
- [ ] Shows count of selected images
- [ ] Lists filenames (or thumbnails)
- [ ] Simple styling (no complex UI)
- [ ] No per-image removal buttons (out of scope)
- [ ] Optional: Can skip if not needed

**Dependencies**: 3.3

**Estimated Effort**: 1 hour (optional)

---

## Task 4.0: Frontend Minimal Gallery Display (3-4 hours)

### 4.1 Update ItemCard to Use Primary Image (30 min)

**Description**: Change ItemCard to display `imageUrls[0] || imageUrl` for backwards compatibility.

**File Changes**:
- `client/src/components/ItemCard.tsx`

**Implementation**:
```typescript
const ItemCard = ({ item }: { item: InventoryItem }) => {
  // Use imageUrls[0] if available, fallback to imageUrl
  const primaryImageUrl = item.imageUrls?.[0] || item.imageUrl;

  return (
    <div className="item-card">
      <img src={primaryImageUrl} alt={item.name} />
      {/* ... rest of card */}
    </div>
  );
};
```

**Acceptance Criteria**:
- [ ] Multi-image items show first image from `imageUrls`
- [ ] Legacy items show `imageUrl`
- [ ] No broken images
- [ ] TypeScript types correct
- [ ] Backwards compatible

**Dependencies**: None

**Estimated Effort**: 30 minutes

---

### 4.2 Add Image Count Badge to ItemCard (45 min)

**Description**: Show simple badge ("📷 3") on cards with multiple images.

**File Changes**:
- `client/src/components/ItemCard.tsx`

**Implementation**:
```typescript
const ItemCard = ({ item }: { item: InventoryItem }) => {
  const primaryImageUrl = item.imageUrls?.[0] || item.imageUrl;
  const imageCount = item.imageUrls?.length || 1;
  const hasMultipleImages = imageCount > 1;

  return (
    <div className="item-card">
      <div className="image-container">
        <img src={primaryImageUrl} alt={item.name} />
        {hasMultipleImages && (
          <span className="image-count-badge">
            📷 {imageCount}
          </span>
        )}
      </div>
      {/* ... rest of card */}
    </div>
  );
};
```

**Acceptance Criteria**:
- [ ] Badge shows for items with 2+ images
- [ ] Badge hidden for single-image items
- [ ] Badge displays count correctly
- [ ] Simple styling (corner badge)
- [ ] Accessible (visible contrast)

**Dependencies**: 4.1

**Estimated Effort**: 45 minutes

---

### 4.3 Create ItemDetailGallery Component (1.5 hours)

**Description**: Create new minimal gallery component with primary image + thumbnail row.

**File Changes**:
- `client/src/components/ItemDetailGallery.tsx` (NEW)

**Implementation**:
```typescript
import { useState } from "react";
import type { InventoryItem } from "@shared/schema";

interface ItemDetailGalleryProps {
  item: InventoryItem;
}

export function ItemDetailGallery({ item }: ItemDetailGalleryProps) {
  const images = item.imageUrls || [item.imageUrl];
  const [primaryIndex, setPrimaryIndex] = useState(0);

  // Don't show gallery for single-image items
  if (images.length <= 1) {
    return (
      <img
        src={item.imageUrl}
        alt={item.name}
        className="single-image"
      />
    );
  }

  return (
    <div className="gallery">
      {/* Primary image */}
      <img
        src={images[primaryIndex]}
        alt={`${item.name} - Image ${primaryIndex + 1}`}
        className="gallery-primary"
      />

      {/* Thumbnail row */}
      <div className="gallery-thumbnails">
        {images.map((url, index) => (
          <button
            key={index}
            onClick={() => setPrimaryIndex(index)}
            className={index === primaryIndex ? "active" : ""}
          >
            <img
              src={url}
              alt={`${item.name} - Thumbnail ${index + 1}`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Acceptance Criteria**:
- [ ] Displays primary image (large)
- [ ] Shows thumbnail row below
- [ ] Click thumbnail to swap primary
- [ ] Active thumbnail highlighted
- [ ] Single-image items show simple img (no gallery)
- [ ] Alt text on all images
- [ ] No animations (simple state swap)

**Dependencies**: None

**Estimated Effort**: 1.5 hours

---

### 4.4 Add Basic Gallery Styles (45 min)

**Description**: Add minimal CSS for gallery layout (no animations).

**File Changes**:
- `client/src/components/ItemDetailGallery.tsx` or separate CSS file

**Implementation**:
```css
.gallery {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.gallery-primary {
  width: 100%;
  max-height: 500px;
  object-fit: contain;
}

.gallery-thumbnails {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
}

.gallery-thumbnails button {
  border: 2px solid transparent;
  padding: 0;
  cursor: pointer;
}

.gallery-thumbnails button.active {
  border-color: blue;
}

.gallery-thumbnails img {
  width: 80px;
  height: 80px;
  object-fit: cover;
}
```

**Acceptance Criteria**:
- [ ] Gallery layout responsive
- [ ] Thumbnails scrollable if many images
- [ ] Active thumbnail visually distinct
- [ ] Mobile-friendly sizing
- [ ] No animations (instant state change)

**Dependencies**: 4.3

**Estimated Effort**: 45 minutes

---

### 4.5 Integrate Gallery into Item Detail View (30 min)

**Description**: Import and use ItemDetailGallery in item detail page/modal.

**File Changes**:
- Item detail page (location TBD - may be modal in home.tsx or separate route)

**Implementation**:
```typescript
import { ItemDetailGallery } from "../components/ItemDetailGallery";

// In item detail view:
<ItemDetailGallery item={selectedItem} />
```

**Acceptance Criteria**:
- [ ] Gallery appears in item detail view
- [ ] Replaces single image display
- [ ] Works for both single and multi-image items
- [ ] No layout breaks
- [ ] Responsive on mobile

**Dependencies**: 4.3, 4.4

**Estimated Effort**: 30 minutes

---

## Task 5.0: Minimal Testing & Backwards Compatibility (3-4 hours)

### 5.1 Write E2E Test: Multi-Image Upload (1.5 hours)

**Description**: Write Playwright test for uploading 3 images via file input and verifying display.

**File Changes**:
- `e2e/multi-image-upload.spec.ts` (NEW)

**Implementation**:
```typescript
import { test, expect } from "@playwright/test";

test("multi-image upload via file input", async ({ page }) => {
  await page.goto("/");

  // Select 3 images via file input
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles([
    "e2e/fixtures/test1.jpg",
    "e2e/fixtures/test2.jpg",
    "e2e/fixtures/test3.jpg",
  ]);

  // Submit upload
  await page.click('button:has-text("Upload")');

  // Wait for success
  await expect(page.locator('.success-message')).toBeVisible();

  // Verify item appears in grid
  const itemCard = page.locator('.item-card').first();
  await expect(itemCard).toBeVisible();

  // Verify count badge shows "3"
  await expect(itemCard.locator('.image-count-badge')).toContainText("3");

  // Click to open detail view
  await itemCard.click();

  // Verify gallery shows 3 thumbnails
  await expect(page.locator('.gallery-thumbnails button')).toHaveCount(3);

  // Click second thumbnail
  await page.locator('.gallery-thumbnails button').nth(1).click();

  // Verify primary image changes
  const primaryImg = page.locator('.gallery-primary');
  await expect(primaryImg).toHaveAttribute('src', /\/1\./); // Contains "/1." for second image
});
```

**Acceptance Criteria**:
- [ ] Test uploads 3 images
- [ ] Verifies count badge
- [ ] Tests gallery thumbnail click
- [ ] Uses deterministic fixtures
- [ ] Passes in CI
- [ ] No flakiness

**Dependencies**: 2.8, 3.4, 4.5

**Estimated Effort**: 1.5 hours

---

### 5.2 Write E2E Test: Backwards Compatibility (1 hour)

**Description**: Verify legacy single-image items display correctly without gallery.

**File Changes**:
- `e2e/backwards-compat.spec.ts` (NEW)

**Implementation**:
```typescript
import { test, expect } from "@playwright/test";

test("legacy single-image items display without gallery", async ({ page }) => {
  await page.goto("/");

  // Find a legacy item (seeded with imageUrl only, no imageUrls)
  const legacyItem = page.locator('.item-card').filter({ hasText: "Legacy Item" }).first();
  await expect(legacyItem).toBeVisible();

  // Verify no count badge
  await expect(legacyItem.locator('.image-count-badge')).not.toBeVisible();

  // Click to open detail
  await legacyItem.click();

  // Verify simple image display (no gallery)
  await expect(page.locator('.single-image')).toBeVisible();
  await expect(page.locator('.gallery-thumbnails')).not.toBeVisible();
});
```

**Acceptance Criteria**:
- [ ] Tests legacy single-image item
- [ ] Verifies no count badge
- [ ] Verifies no gallery UI
- [ ] Tests backwards compatibility
- [ ] Passes with seed data

**Dependencies**: 1.6 (seed script must include legacy item)

**Estimated Effort**: 1 hour

---

### 5.3 Write Unit Test: createItemMultiUploadFormData (30 min)

**Description**: Test uploadService function with multiple blobs.

**File Changes**:
- `client/src/__tests__/uploadService.spec.ts`

**Implementation**:
```typescript
import { describe, it, expect } from "vitest";
import { createItemMultiUploadFormData } from "../lib/uploadService";

describe("createItemMultiUploadFormData", () => {
  it("creates FormData with multiple images", () => {
    const blob1 = new Blob(["image1"], { type: "image/jpeg" });
    const blob2 = new Blob(["image2"], { type: "image/jpeg" });
    const blob3 = new Blob(["image3"], { type: "image/jpeg" });

    const formData = createItemMultiUploadFormData(
      [blob1, blob2, blob3],
      ["test1.jpg", "test2.jpg", "test3.jpg"]
    );

    // Verify images field
    const images = formData.getAll("images");
    expect(images).toHaveLength(3);
  });

  it("uses default filenames if not provided", () => {
    const blobs = [
      new Blob(["img1"], { type: "image/jpeg" }),
      new Blob(["img2"], { type: "image/jpeg" }),
    ];

    const formData = createItemMultiUploadFormData(blobs);
    const images = formData.getAll("images") as File[];

    expect(images[0].name).toBe("upload-0.jpg");
    expect(images[1].name).toBe("upload-1.jpg");
  });
});
```

**Acceptance Criteria**:
- [ ] Tests multiple blobs
- [ ] Tests custom filenames
- [ ] Tests default filenames
- [ ] All assertions pass
- [ ] Runs in test suite

**Dependencies**: 3.1

**Estimated Effort**: 30 minutes

---

### 5.4 Write Unit Test: Lazy Migration Logic (45 min)

**Description**: Test storage.getItem() lazy migration for legacy items.

**File Changes**:
- `server/tests/storage.spec.ts` (or create new file)

**Implementation**:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { storage } from "../storage";
import { db } from "../../shared/db";

describe("Lazy migration", () => {
  it("populates imageUrls from imageUrl when null", async () => {
    // Insert legacy item (no imageUrls)
    await db.insert(inventoryItems).values({
      name: "Legacy Item",
      imageUrl: "/objects/items/legacy.jpg",
      imageUrls: null, // NULL - legacy item
      // ... other fields
    });

    // Retrieve item
    const item = await storage.getItem(insertedId);

    // Verify lazy migration
    expect(item?.imageUrls).toEqual(["/objects/items/legacy.jpg"]);
  });

  it("does not modify imageUrls if already populated", async () => {
    // Insert multi-image item
    await db.insert(inventoryItems).values({
      name: "Multi Item",
      imageUrl: "/objects/items/multi/0.jpg",
      imageUrls: [
        "/objects/items/multi/0.jpg",
        "/objects/items/multi/1.jpg",
      ],
      // ... other fields
    });

    const item = await storage.getItem(insertedId);

    // Verify not modified
    expect(item?.imageUrls).toHaveLength(2);
  });
});
```

**Acceptance Criteria**:
- [ ] Tests NULL imageUrls gets populated
- [ ] Tests existing imageUrls not modified
- [ ] Tests both getItem() and getItems()
- [ ] All tests pass
- [ ] Uses test database

**Dependencies**: 1.4, 1.5

**Estimated Effort**: 45 minutes

---

### 5.5 Verify All Existing Tests Pass (30 min)

**Description**: Run full test suite and ensure no regressions from schema/API changes.

**Commands**:
```bash
pnpm test        # Run all unit tests
pnpm e2e         # Run all E2E tests
```

**Acceptance Criteria**:
- [ ] All existing unit tests pass
- [ ] All existing E2E tests pass
- [ ] No flaky tests introduced
- [ ] No breaking changes detected
- [ ] CI pipeline green

**Dependencies**: All previous subtasks

**Estimated Effort**: 30 minutes

---

---

# Execution Plan (File-Level Changes)

Once subtasks are approved, the execution plan will detail exact file changes:

## Phase 1: Schema & Database
1. Edit `shared/schema.ts` (add imageUrls field)
2. Run migration (pnpm db:push)
3. Edit `server/storage.ts` (lazy migration logic)
4. Edit `scripts/db-seed.ts` (multi-image test items)

## Phase 2: Backend API
5. Edit `server/routes.ts` (upload.array, multi-image handling)
6. Edit `server/objectStorage.ts` (path validation regex)

## Phase 3: Frontend Upload
7. Edit `client/src/lib/uploadService.ts` (createItemMultiUploadFormData)
8. Edit `client/src/pages/home.tsx` (multiple file input)

## Phase 4: Frontend Display
9. Edit `client/src/components/ItemCard.tsx` (primary image + badge)
10. Create `client/src/components/ItemDetailGallery.tsx` (NEW)
11. Integrate gallery into detail view

## Phase 5: Testing
12. Create `e2e/multi-image-upload.spec.ts` (NEW)
13. Create `e2e/backwards-compat.spec.ts` (NEW)
14. Edit `client/src/__tests__/uploadService.spec.ts` (unit tests)
15. Edit `server/tests/storage.spec.ts` (lazy migration tests)

**Total Estimated Effort**: 15-19 hours across 32 subtasks

---

**Next Step**: Await approval for detailed subtasks and execution plan before generating diffs.
