# PRD 0004: Media Model v1 - Multi-Image Support

**Status:** Draft
**Created:** 2025-11-13
**Related PRDs:** PRD 0002 (Dual-Environment Storage), PRD 0003 (Foundational Architecture)
**Foundation Reference:** FOUNDATION.md Principle 1 (Media as First-Class Concept)

---

## Overview

### Current State

MyInventory AI currently supports **one image per item**:
- Schema: Single `imageUrl` text field (not null)
- API: POST `/api/items` accepts single `image` file
- Storage: `/objects/items/{uuid}.{ext}` (one file per item)
- UI: Displays single image in item cards and detail views

This limitation prevents users from:
- Capturing multiple angles of an item (front, back, detail shots)
- Attaching supplemental documentation (receipts, manuals, warranty cards)
- Building comprehensive photo inventories for insurance or estate planning

### Problem Statement

Users need to attach **multiple images per item** to create complete documentation:
- **Insurance claims**: Multiple photos showing condition, serial numbers, receipts
- **Estate inventories**: Photos from different angles for appraisals
- **Auto parts catalogs**: Front/back/fitment photos for buyer confidence
- **Storage businesses**: Client-facing galleries showing stored items

The current single-image constraint forces users to:
1. Create separate items for each photo (pollutes inventory)
2. Use external tools to combine images (friction, data loss)
3. Choose only the "best" photo (incomplete documentation)

### Goals

**Primary Goals:**
1. Enable items to have **2-10 images** (typical use case: 2-3 images)
2. Maintain **backwards compatibility** with existing single-image items
3. Implement Phase 1 of FOUNDATION.md media evolution (dual-field approach)
4. Preserve existing UI/UX for single-image items (no regression)

**Secondary Goals:**
5. Lay foundation for future media types (PDFs, videos in PRD 0005+)
6. Enable batch upload flows (PRD 0006+)
7. Support mobile-friendly multi-image capture

### Non-Goals (Out of Scope)

- ❌ Media entity table (deferred to PRD 0005)
- ❌ Video or PDF uploads (image-only for v1)
- ❌ Batch folder ingestion (separate PRD)
- ❌ Object detection from single image (AI-assisted clustering)
- ❌ Image editing, cropping, or transformations
- ❌ EXIF metadata extraction or display
- ❌ Image reordering UI (first image is primary, rest are additional)
- ❌ Per-image captions or descriptions

---

## User Stories

### US-1: Insurance User with Multiple Photos
**As an** insurance policyholder documenting valuables,
**I want to** upload multiple photos of an item (front, back, serial number, receipt),
**So that** I have complete documentation for claims.

**Acceptance Criteria:**
- User can select 2-4 images during item creation
- All images are saved and associated with the item
- Primary image (first upload) displays in item card
- Detail view shows gallery of all images
- Existing single-image items continue to work

### US-2: Auto Parts Seller with Fitment Photos
**As a** Jeep parts collector selling online,
**I want to** photograph parts from multiple angles (installed, unboxed, fitment close-up),
**So that** potential buyers can see condition and compatibility.

**Acceptance Criteria:**
- User uploads 3+ images per part listing
- Primary photo shows in catalog grid
- Detail page displays image gallery with thumbnails
- Buyers can click to view full-size images

### US-3: Estate Planner with Angle Shots
**As an** estate executor documenting household items,
**I want to** capture items from different angles for appraisal,
**So that** heirs and appraisers have complete visual records.

**Acceptance Criteria:**
- User can upload 2-5 photos per item during inventory session
- All photos persist across sessions
- Photos display in detail view for review and verification

---

## Functional Requirements

### FR-1: Schema - Dual-Field Approach (Backwards Compatible)

**Add `imageUrls` array field to `inventory_items` table** while keeping `imageUrl`:

```typescript
// shared/schema.ts
export const inventoryItems = pgTable("inventory_items", {
  // ...existing fields...
  imageUrl: text("image_url").notNull(), // Keep for backwards compatibility
  imageUrls: text("image_urls").array().$type<string[]>(), // NEW: Multi-image support
});
```

**Migration Strategy:**
- `imageUrl` remains NOT NULL (preserves existing constraints)
- `imageUrls` is nullable (NULL = legacy single-image item)
- New items populate **both fields**: `imageUrl = images[0]`, `imageUrls = images[]`
- Existing data: `imageUrls` stays NULL initially (lazy migration on read)

**Rationale:**
- Backwards compatible (no breaking changes to API consumers)
- Gradual migration path (UI can check for imageUrls, fall back to imageUrl)
- Aligns with FOUNDATION.md Phase 1 recommendation

### FR-2: API - Multi-Image Upload Endpoint

**Extend POST `/api/items` to accept multiple images:**

```typescript
// server/routes.ts
app.post("/api/items", upload.array("images", 10), wrap(async (req, res) => {
  // req.files is array of UploadedFile[] (multer)
  // ...process multiple files...
}));
```

**Field Name:**
- Single image: `image` (existing, still supported)
- Multiple images: `images` (new, array)

**Backwards Compatibility:**
- If `req.file` exists (single), process as before → populate `imageUrl` only
- If `req.files` exists (array), process all → populate both `imageUrl` and `imageUrls`
- This allows gradual frontend migration

**Validation:**
- Max 10 images per upload (configurable via multer limit)
- Each file validated via existing `validateUploadedFile()` logic
- Total upload size limit: 100MB (10 files × 10MB each)

### FR-3: Storage - Multi-File Paths

**Storage Path Pattern:**
- Single image (legacy): `/objects/items/{itemId}.{ext}` (unchanged)
- Multiple images (new): `/objects/items/{itemId}/0.{ext}`, `/objects/items/{itemId}/1.{ext}`, etc.

**Path Validation Update:**
```typescript
// server/objectStorage.ts
// Update validateObjectPath() regex to allow:
// - /objects/items/{uuid}.{ext} (legacy single-file)
// - /objects/items/{uuid}/{index}.{ext} (new multi-file)
const pathRegex = /^\/objects\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_\-./]+$/;
```

**Storage Implementation:**
```typescript
// Save each image with index-based naming
for (let i = 0; i < req.files.length; i++) {
  const file = req.files[i];
  const ext = mimeToExt[file.mimetype] || 'jpg';
  const filename = `${i}.${ext}`;
  const path = `items/${itemId}/${filename}`;
  const url = `/objects/items/${itemId}/${filename}`;

  await objectStorageService.saveLocalFile(path, file.buffer);
  imageUrls.push(url);
}
```

### FR-4: Frontend - Multi-Image Upload UI

**Upload Service Extension:**
```typescript
// client/src/lib/uploadService.ts
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

**Camera Capture Flow:**
- User taps "Add Item" → Camera opens
- After capture, show "Add More Photos" button
- User can capture 2-10 additional photos
- Submit triggers `createItemMultiUploadFormData(blobs)`

**File Input Flow:**
- User clicks "Upload Image" → File picker opens with `multiple` attribute
- User selects 1-10 images
- Preview thumbnails shown before upload
- Submit triggers `createItemMultiUploadFormData(files)`

### FR-5: Frontend - Multi-Image Display

**Item Card (Grid View):**
- Display `imageUrls[0]` if present, else fall back to `imageUrl`
- Badge showing image count: "📷 3" if `imageUrls.length > 1`
- No change to layout (still displays single primary image)

**Item Detail View:**
- Primary image (large): `imageUrls[0]` or `imageUrl`
- Thumbnail gallery below primary image (if `imageUrls.length > 1`)
- Click thumbnail → swap primary image
- Mobile: Swipe gallery for primary image navigation

**Backwards Compatibility Check:**
```typescript
// client/src/components/ItemCard.tsx
const primaryImageUrl = item.imageUrls?.[0] || item.imageUrl;
const imageCount = item.imageUrls?.length || 1;
```

### FR-6: Data Migration - Lazy Population

**Strategy: On-Read Migration (No Blocking Scripts)**

When rendering items, populate `imageUrls` from `imageUrl` if null:

```typescript
// server/storage.ts (modify getItems(), getItem())
async getItem(id: string): Promise<InventoryItem | null> {
  const item = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).get();

  if (item && !item.imageUrls) {
    // Lazy migration: Populate imageUrls from imageUrl
    item.imageUrls = [item.imageUrl];
  }

  return item;
}
```

**Optional: One-Time Backfill Script**
```sql
-- scripts/migrate-image-urls.sql
UPDATE inventory_items
SET image_urls = ARRAY[image_url]
WHERE image_urls IS NULL;
```

This can be run optionally in PRD 0004, or deferred to PRD 0005 cleanup phase.

---

## Non-Functional Requirements

### NFR-1: Performance
- Multi-image uploads must complete in <10 seconds for 5 images (total 20MB)
- Image display should not regress (existing single-image load times preserved)
- Storage backend should handle concurrent uploads (ObjectStorageService already supports this)

### NFR-2: Backwards Compatibility
- All existing API consumers continue to work (single-image uploads)
- Existing single-image items display identically in UI
- No breaking changes to `InventoryItem` type (imageUrl remains present)

### NFR-3: Storage Efficiency
- No duplicate storage of images (each image stored once)
- GCS and local filesystem paths consistent (ObjectStorageService handles both)

### NFR-4: Accessibility
- Image galleries must be keyboard navigable (arrow keys)
- Screen readers announce image count ("Item has 3 images")
- Alt text for all images (generated from item name + index)

### NFR-5: Mobile Experience
- Multi-image upload works on mobile browsers (file input `multiple` attribute)
- Gallery thumbnails are touch-friendly (min 48×48px tap targets)
- Swipe gestures for primary image navigation

---

## Technical Design

### Database Schema Changes

```typescript
// shared/schema.ts
export const inventoryItems = pgTable("inventory_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  imageUrl: text("image_url").notNull(), // Legacy single-image field
  imageUrls: text("image_urls").array().$type<string[]>(), // NEW: Multi-image array
  barcodeData: text("barcode_data").notNull(),
  estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }),
  valueConfidence: text("value_confidence"),
  valueRationale: text("value_rationale"),
  location: text("location"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

**Migration SQL:**
```sql
-- Add imageUrls column (nullable for backwards compatibility)
ALTER TABLE inventory_items ADD COLUMN image_urls text[];

-- Optional: Backfill existing data
UPDATE inventory_items SET image_urls = ARRAY[image_url] WHERE image_urls IS NULL;
```

### API Contract

**POST /api/items (Multi-Image Support)**

**Request (multipart/form-data):**
```
Content-Type: multipart/form-data

images: [File1, File2, File3] // Array of image files
location: "Garage" (optional)
```

**Response (201 Created):**
```json
{
  "id": "item-uuid",
  "name": "Vintage Clock",
  "description": "...",
  "category": "Household",
  "tags": ["antique", "clock"],
  "imageUrl": "/objects/items/item-uuid/0.jpg", // Primary image
  "imageUrls": [
    "/objects/items/item-uuid/0.jpg",
    "/objects/items/item-uuid/1.jpg",
    "/objects/items/item-uuid/2.jpg"
  ],
  "barcodeData": "INV-123",
  "estimatedValue": "150.00",
  "createdAt": "2025-11-13T..."
}
```

**Backwards Compatibility:**
- Single-image uploads still use `image` field name (singular)
- Response always includes `imageUrl` (primary image)
- `imageUrls` may be null for legacy items (UI falls back to `imageUrl`)

### Storage Implementation

**Backend Upload Logic:**
```typescript
// server/routes.ts
app.post("/api/items", upload.array("images", 10), wrap(async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    throw new ApiError(400, 'NO_IMAGE', 'No images provided');
  }

  // Validate all files
  for (const file of files) {
    const validation = validateUploadedFile(file);
    if (!validation.valid) {
      throw new ApiError(400, 'INVALID_FILE_TYPE', validation.error);
    }
  }

  // Analyze primary image with AI (first image only)
  const primaryImage = files[0];
  const imageBase64 = `data:${primaryImage.mimetype};base64,${primaryImage.buffer.toString("base64")}`;
  const analysis = await analyzeImage(imageBase64);

  // Generate item ID and storage paths
  const itemId = randomUUID();
  const imageUrls: string[] = [];

  // Save all images
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = mimeToExt[file.mimetype] || 'jpg';
    const filename = `${i}.${ext}`;
    const imageUrl = `/objects/items/${itemId}/${filename}`;

    if (isReplit) {
      // Replit GCS storage
      const fullPath = `${privateObjectDir}/items/${itemId}/${filename}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const gcsFile = bucket.file(objectName);
      await gcsFile.save(file.buffer, {
        contentType: file.mimetype,
        metadata: { metadata: { "custom:aclPolicy": JSON.stringify({ owner: "system", visibility: "public" }) } }
      });
    } else {
      // Local filesystem
      await objectStorageService.saveLocalFile(`items/${itemId}/${filename}`, file.buffer);
    }

    imageUrls.push(imageUrl);
  }

  // Create item with both imageUrl and imageUrls
  const item = await storage.createItem({
    name: analysis.name,
    description: analysis.description,
    category: analysis.category,
    tags: analysis.tags,
    imageUrl: imageUrls[0], // Primary image (backwards compatibility)
    imageUrls: imageUrls,   // All images (new field)
    barcodeData: `INV-${Date.now()}-${itemId.slice(0, 8).toUpperCase()}`,
    estimatedValue: analysis.estimatedValue,
  });

  res.json(item);
}));
```

### Frontend Implementation

**Upload Service:**
```typescript
// client/src/lib/uploadService.ts
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

**Multi-Image Capture Component:**
```typescript
// client/src/components/MultiImageCapture.tsx
export function MultiImageCapture({ onImagesCapture }) {
  const [capturedImages, setCapturedImages] = useState<string[]>([]);

  const handleCapture = (imageDataUrl: string) => {
    setCapturedImages(prev => [...prev, imageDataUrl]);
  };

  const handleSubmit = async () => {
    const blobs = await Promise.all(
      capturedImages.map(dataUrl => fetch(dataUrl).then(r => r.blob()))
    );
    onImagesCapture(blobs);
  };

  return (
    <div>
      <CameraCapture onCapture={handleCapture} />
      <div className="thumbnails">
        {capturedImages.map((img, i) => (
          <img key={i} src={img} alt={`Capture ${i + 1}`} />
        ))}
      </div>
      {capturedImages.length > 0 && (
        <Button onClick={handleSubmit}>
          Upload {capturedImages.length} Images
        </Button>
      )}
      {capturedImages.length > 0 && capturedImages.length < 10 && (
        <Button onClick={() => { /* re-open camera */ }}>
          Add More Photos
        </Button>
      )}
    </div>
  );
}
```

**Item Detail with Gallery:**
```typescript
// client/src/components/ItemDetailGallery.tsx
export function ItemDetailGallery({ item }: { item: InventoryItem }) {
  const images = item.imageUrls || [item.imageUrl];
  const [primaryIndex, setPrimaryIndex] = useState(0);

  return (
    <div>
      <img src={images[primaryIndex]} alt={item.name} className="primary-image" />
      {images.length > 1 && (
        <div className="thumbnails">
          {images.map((url, index) => (
            <img
              key={index}
              src={url}
              alt={`${item.name} - Image ${index + 1}`}
              className={index === primaryIndex ? 'active' : ''}
              onClick={() => setPrimaryIndex(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Migration & Compatibility Strategy

### Phase 1: Schema Migration (Week 1)
1. Add `imageUrls` column to database (nullable)
2. Update `shared/schema.ts` type definitions
3. Deploy schema change to staging/production

### Phase 2: Backend Implementation (Week 1-2)
4. Update POST `/api/items` to handle `upload.array("images")`
5. Implement multi-file storage logic (iterate and save)
6. Update `storage.createItem()` to accept `imageUrls` field
7. Implement lazy migration in `storage.getItem()` (populate imageUrls from imageUrl)

### Phase 3: Frontend Implementation (Week 2)
8. Add `createItemMultiUploadFormData()` to uploadService
9. Update file input to support `multiple` attribute
10. Implement multi-image preview before upload
11. Update ItemCard to show primary image + count badge
12. Implement ItemDetailGallery component

### Phase 4: Testing & Rollout (Week 3)
13. Add E2E tests for multi-image upload flow
14. Update existing tests to handle `imageUrls` field (backwards compatible assertions)
15. Test legacy single-image items (ensure no regression)
16. Deploy to production with feature flag (gradual rollout)

### Rollback Plan
- If issues arise, set `imageUrls` to NULL for new items (revert to single-image mode)
- Existing single-image items unaffected
- No data loss (imageUrl always populated)

---

## Testing Strategy

### Unit Tests

**Backend:**
- `POST /api/items` with single image (existing test, should still pass)
- `POST /api/items` with 2-5 images (new test)
- `POST /api/items` with 10 images (max limit test)
- `POST /api/items` with 11 images (error case: exceeds limit)
- File validation for each image in array

**Frontend:**
- `createItemMultiUploadFormData()` with 1 image
- `createItemMultiUploadFormData()` with 5 images
- ItemDetailGallery thumbnail click (swap primary image)

### Integration Tests

- Upload 3 images → Verify all 3 saved to storage
- Upload 3 images → Verify `imageUrls` array has 3 URLs
- Retrieve legacy item (imageUrls = null) → Verify falls back to `imageUrl`
- Retrieve new item → Verify `imageUrls` array returned

### E2E Tests

```typescript
// e2e/multi-image-upload.spec.ts
test('user can upload multiple images', async ({ page }) => {
  await page.goto('/');

  // Select 3 images
  const fileInput = page.locator('[data-testid="file-input"]');
  await fileInput.setInputFiles([
    'fixtures/test-image-1.jpg',
    'fixtures/test-image-2.jpg',
    'fixtures/test-image-3.jpg'
  ]);

  // Verify upload triggered
  const apiCall = page.waitForRequest(req =>
    req.url().includes('/api/items') && req.method() === 'POST'
  );
  await apiCall;

  // Verify item appears with image count badge
  await expect(page.locator('[data-testid^="item-"]')).toHaveCount(1);
  await expect(page.locator('text=📷 3')).toBeVisible();
});

test('item detail shows image gallery', async ({ page }) => {
  // Stub item with 3 images
  await page.route('/api/items', async (route) => {
    await route.fulfill({
      json: [{
        id: 'test-item-1',
        name: 'Test Item',
        imageUrl: '/objects/items/test-item-1/0.jpg',
        imageUrls: [
          '/objects/items/test-item-1/0.jpg',
          '/objects/items/test-item-1/1.jpg',
          '/objects/items/test-item-1/2.jpg'
        ],
        // ...other fields...
      }]
    });
  });

  await page.goto('/');
  await page.click('[data-testid="item-test-item-1"]');

  // Verify gallery shows 3 thumbnails
  await expect(page.locator('.thumbnails img')).toHaveCount(3);

  // Click second thumbnail
  await page.click('.thumbnails img:nth-child(2)');

  // Verify primary image updated
  await expect(page.locator('.primary-image')).toHaveAttribute(
    'src',
    '/objects/items/test-item-1/1.jpg'
  );
});
```

### Backwards Compatibility Tests

```typescript
test('legacy single-image items still display', async ({ page }) => {
  // Stub legacy item (imageUrls = null)
  await page.route('/api/items', async (route) => {
    await route.fulfill({
      json: [{
        id: 'legacy-item',
        name: 'Legacy Item',
        imageUrl: '/objects/items/legacy-item.jpg',
        imageUrls: null, // Legacy format
        // ...other fields...
      }]
    });
  });

  await page.goto('/');

  // Verify item displays with single image (no gallery)
  await expect(page.locator('[data-testid="item-legacy-item"]')).toBeVisible();
  await expect(page.locator('.thumbnails')).not.toBeVisible();
});
```

---

## Success Criteria

### Functional Success
- [ ] Users can upload 2-10 images during item creation
- [ ] All images save to correct storage paths (`/objects/items/{itemId}/{index}.{ext}`)
- [ ] Item detail view displays image gallery with clickable thumbnails
- [ ] Primary image displays in item card grid view
- [ ] Image count badge shows for multi-image items ("📷 3")
- [ ] Existing single-image items continue to work (no regression)

### Technical Success
- [ ] `imageUrls` column added to database schema
- [ ] POST `/api/items` accepts `images[]` array
- [ ] `createItemMultiUploadFormData()` function in uploadService
- [ ] Lazy migration populates `imageUrls` from `imageUrl` on read
- [ ] All existing tests pass (backwards compatible)
- [ ] New E2E tests for multi-image flow pass

### Performance Success
- [ ] 5-image upload completes in <10 seconds
- [ ] Image gallery renders without flicker
- [ ] Storage backend handles concurrent uploads

### UX Success
- [ ] Multi-image upload works on mobile (file input + camera)
- [ ] Gallery is keyboard navigable (arrow keys)
- [ ] Screen readers announce image count
- [ ] No confusion for existing single-image users (UI identical for them)

---

## Future Considerations (PRD 0005+)

### Media Entity Table
After PRD 0004 stabilizes, consider migrating to first-class Media entity:
- Separate `media` table with `itemId` foreign key
- Per-media metadata (captions, EXIF, order)
- Support for non-image media (PDFs, videos)

### Image Reordering
- Drag-and-drop to set primary image
- Reorder gallery via UI

### Batch Upload
- Upload entire folder of images (10-100 files)
- AI-assisted clustering into items

### Advanced Features
- Image editing (crop, rotate, brightness)
- EXIF metadata display (camera model, timestamp)
- Per-image captions/descriptions

---

## Appendix

### FOUNDATION.md Alignment

This PRD implements **Phase 1** of Principle 1 (Media as First-Class Concept):
- ✅ Adds `imageUrls` array alongside `imageUrl`
- ✅ Maintains backwards compatibility
- ✅ Uses existing ObjectStorageService (multi-file ready)
- ✅ Follows storage path conventions (`/objects/items/{itemId}/{index}.{ext}`)
- ✅ Uses upload service abstraction (no inline FormData)

### Related Documentation

- **FOUNDATION.md**: Principle 1 (Media as First-Class Concept)
- **PRD 0002**: Dual-Environment Image Persistence (storage foundation)
- **PRD 0003**: Foundational Architecture (upload service, MIME mapping)
- **CONTEXT.md**: Section 10 (Database Schema)

---

**End of PRD 0004**
