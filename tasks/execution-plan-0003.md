# Execution Plan: PRD 0003 - Foundational Architecture

**Created:** 2025-11-13
**PRD:** `tasks/0003-prd-foundational-architecture.md`
**Task List:** `tasks/tasks-0003-prd-foundational-architecture.md`

---

## File-Level Changes Summary

### Files to CREATE
1. **`FOUNDATION.md`** (new, ~1200 lines)
   - Comprehensive architectural principles document
   - 7 core principles, evolution roadmap, integration patterns, anti-patterns

2. **`client/src/lib/uploadService.ts`** (new, ~40 lines)
   - Reusable upload FormData utility
   - Single function: `createItemUploadFormData()`

### Files to MODIFY
1. **`server/routes.ts`**
   - Add MIME-to-extension mapping (lines ~50)
   - Remove hard-coded `.jpg` extension (line 70)
   - Update imageUrl construction with dynamic extension

2. **`client/src/pages/home.tsx`**
   - Import uploadService
   - Refactor camera capture handler (lines 65-76)
   - Refactor file input handler (lines 78-101)

3. **`server/objectStorage.ts`**
   - Add class-level JSDoc comment about multi-file support
   - Add method-level comment at saveLocalFile (line 274)
   - Add reference to FOUNDATION.md

4. **`shared/schema.ts`**
   - Add comment at line 12 (imageUrl field) noting future migration path
   - Reference FOUNDATION.md for evolution guidance

5. **`CONTEXT.md`**
   - Update YAML front matter (add FOUNDATION.md to sources)
   - Update Section 3 (Architecture Overview) with foundational principles
   - Update Section 11 (Environment Configuration) with foundation reference
   - Update Section 1 documentation inventory table
   - Update SHA256 verification hash

6. **`tasks/0003-prd-foundational-architecture.md`** (this file)
   - Update "Relationship to PRD 0002" section with alignment confirmation

### Files to READ/REVIEW (no changes)
- `server/fileValidation.ts` - Review for MIME type logic
- `tasks/0002-prd-dual-env-image-persistence.md` - Alignment validation
- `design_guidelines.md` - Reference for UI patterns
- `e2e/image-fallback.spec.ts` - Reference for test philosophy

---

## Task-by-Task Execution Plan

### Task 1.0: Create FOUNDATION.md (Tasks 1.1-1.12)

**New File: `/FOUNDATION.md`**

**Structure:**
```markdown
---
version: 1
last_updated: 2025-11-13
purpose: foundational-architecture
canonical: true
---

# FOUNDATION: MyInventory AI Architectural Principles

## Table of Contents
[Generated TOC for all sections]

## Introduction
[Why this document exists, relationship to CONTEXT.md]

## Core Principles

### 1. Media as First-Class Concept
[Evolution from imageUrl to imageUrls, backwards compatibility]

### 2. Storage as Environment-Agnostic Abstraction
[ObjectStorageService pattern, multi-file support]

### 3. Upload as Pluggable Mechanism
[Upload service pattern, separation of concerns]

### 4. Containers as Hierarchical Entities
[Adjacency list pattern, recursive CTEs]

### 5. Extensible Attributes as Flexible Data
[JSONB vs separate tables, decision framework]

### 6. Search as First-Class Concern
[Full-text + structured filtering, indexing]

### 7. Tests as Behavior Assertions
[E2E determinism, behavior vs implementation]

## Evolution Roadmap
[Multi-image migration, container hierarchy, vertical attributes]

## Integration Patterns
[Adding media types, extending storage, vertical customization]

## Anti-Patterns
[What NOT to do, consequences, refactoring guidance]

## Cross-References
[Links to CONTEXT.md, objectStorage.ts, routes.ts, PRD 0002]
```

**Estimated Lines**: 1200+
**Content Density**: High - comprehensive guidance with code examples
**Dependencies**: None (can start immediately)

---

### Task 2.0: Refactor Hard-Coded Media Assumptions (Tasks 2.1-2.4)

**File: `server/routes.ts`**

**Changes:**

1. **Add MIME mapping (after line 14, before upload middleware):**
```typescript
// MIME type to file extension mapping
// FOUNDATION: See FOUNDATION.md for guidance on adding new formats
const mimeToExt: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // Future formats: 'image/avif' → 'avif', 'image/heic' → 'heic'
};
```

2. **Update imageUrl construction (line 70):**
```typescript
// OLD:
const imageUrl = `/objects/items/${objectId}.jpg`;

// NEW:
const ext = mimeToExt[req.file.mimetype] || 'jpg'; // Fallback for backwards compat
const imageUrl = `/objects/items/${objectId}.${ext}`;
```

3. **Ensure storage uses correct extension (line 98):**
```typescript
// Update filename passed to saveLocalFile:
await objectStorageService.saveLocalFile(`items/${objectId}.${ext}`, req.file.buffer);
```

**Estimated Changes**: ~10 lines added, ~2 lines modified
**Dependencies**: None
**Testing**: Existing tests should pass (backwards compatible)

---

### Task 3.0: Extract Reusable Upload Logic (Tasks 3.1-3.5)

**New File: `client/src/lib/uploadService.ts`**

**Complete Implementation:**
```typescript
/**
 * Upload Service
 *
 * Provides reusable utilities for constructing FormData for image uploads.
 * Designed to support future multi-image and batch upload flows.
 *
 * FOUNDATION: See FOUNDATION.md Principle 3 (Upload as Pluggable Mechanism)
 */

/**
 * Creates FormData for single item image upload
 *
 * @param imageBlob - Image file as Blob
 * @param filename - Optional filename (defaults to "upload.jpg")
 * @returns FormData ready for POST /api/items
 *
 * @example
 * const formData = createItemUploadFormData(blob, "photo.jpg");
 * createItemMutation.mutate(formData);
 *
 * @future
 * TODO: Add createItemMultiUploadFormData for multi-image support (PRD 0004)
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

**Estimated Lines**: ~35-40 lines

**File: `client/src/pages/home.tsx`**

**Changes:**

1. **Add import (line ~13):**
```typescript
import { createItemUploadFormData } from "@/lib/uploadService";
```

2. **Refactor camera capture handler (lines 68-69):**
```typescript
// OLD:
const formData = new FormData();
formData.append("image", blob, "upload.jpg");

// NEW:
const formData = createItemUploadFormData(blob, "upload.jpg");
```

3. **Refactor file input handler (lines 93-94):**
```typescript
// OLD:
const formData = new FormData();
formData.append("image", file, file.name);

// NEW:
const formData = createItemUploadFormData(file, file.name);
```

**Estimated Changes**: 1 new file (~40 lines), ~3 lines modified in home.tsx
**Dependencies**: None
**Testing**: Existing behavior unchanged, upload flow identical

---

### Task 4.0: Update CONTEXT.md (Tasks 4.1-4.5)

**File: `CONTEXT.md`**

**Changes:**

1. **YAML Front Matter (lines 1-32):**
```yaml
sources:
  # ... existing sources ...
  - path: FOUNDATION.md
    role: foundational-architecture
    canonical: true
  # ... rest of sources ...
last_updated: 2025-11-13
```

2. **Section 1: Documentation Inventory (after line 76):**
```markdown
| `FOUNDATION.md` | [size] bytes | 2025-11-13 | Architectural Principles | ✓ | Active |
```

3. **Section 3: Architecture Overview (after line 165):**
```markdown
### Foundational Principles

MyInventory AI follows 7 core architectural principles defined in `FOUNDATION.md`:

1. **Media as First-Class Concept** - Items will support multiple media assets
2. **Storage as Environment-Agnostic Abstraction** - ObjectStorageService supports dual backends
3. **Upload as Pluggable Mechanism** - Reusable upload utilities, not page-coupled logic
4. **Containers as Hierarchical Entities** - Property → room → box → item pattern
5. **Extensible Attributes** - JSONB or separate tables for vertical-specific data
6. **Search as First-Class Concern** - Full-text + structured filters with indexing
7. **Tests as Behavior Assertions** - Assert user behavior, not implementation details

See [FOUNDATION.md](./FOUNDATION.md) for complete guidance and evolution roadmap.
```

4. **Section 11: Environment Configuration (after line 465):**
```markdown
### Foundational Storage Abstraction

MyInventory AI uses an environment-aware storage abstraction (see `FOUNDATION.md` Principle 2).
For extending storage backends or adding multi-file support, refer to `FOUNDATION.md` Integration Patterns.
```

5. **Update SHA256 hash (line 10):**
```yaml
verification:
  sha256_of_this_file: "[new hash after modifications]"
```

**Estimated Changes**: ~30 lines added, ~2 lines modified
**Dependencies**: Task 1.0 complete (FOUNDATION.md must exist)
**Testing**: Run SHA256 verification, check all links

---

### Task 5.0: Validate PRD 0002 Alignment (Tasks 5.1-5.5)

**File: `server/objectStorage.ts`**

**Changes:**

1. **Class-level JSDoc (before line 45):**
```typescript
/**
 * ObjectStorageService
 *
 * Environment-agnostic storage abstraction supporting dual backends:
 * - Local filesystem (development)
 * - Google Cloud Storage via Replit sidecar (production)
 *
 * FOUNDATION: This service is designed for multi-file scenarios. Methods accept
 * arbitrary file paths, enabling future multi-image uploads (PRD 0004+).
 * See FOUNDATION.md Principle 2 for extension patterns.
 */
export class ObjectStorageService {
```

2. **Method comment at saveLocalFile (before line 274):**
```typescript
/**
 * Save file to local filesystem storage
 *
 * NOTE: This method supports arbitrary file paths, enabling future multi-image
 * scenarios. Path structure: uploads/{relativePath} where relativePath can be
 * items/{uuid}.jpg or items/{uuid}/0.jpg for multi-image support.
 *
 * @param relativePath - Path relative to uploads directory (e.g., "items/uuid.jpg")
 * @param buffer - File content as Buffer
 */
async saveLocalFile(relativePath: string, buffer: Buffer): Promise<void> {
```

**Estimated Changes**: ~15 lines of comments added
**Dependencies**: Task 1.0 complete (references FOUNDATION.md)
**Testing**: No functional changes, comments only

**File: `tasks/0003-prd-foundational-architecture.md`**

**Changes:**

1. **Update "Relationship to PRD 0002" section (line ~600):**
```markdown
## Relationship to PRD 0002

**PRD 0002 (Dual-Environment Image Persistence)** implemented environment-aware storage.
**Alignment Validation (Task 5.0) Findings:**

✅ **Compliance Confirmed:**
- Storage abstraction is environment-agnostic (ObjectStorageService class)
- Path validation prevents traversal attacks (validateObjectPath())
- Dual backend supports future multi-file scenarios (save/retrieve methods are generic)
- Method signatures accept arbitrary paths (saveLocalFile, getLocalObjectFile)

✅ **Clarifications Added:**
- Class-level JSDoc documents multi-file readiness (objectStorage.ts:45)
- Method comments explain path structure extensibility (objectStorage.ts:274)
- FOUNDATION.md references PRD 0002 as exemplary dual-backend implementation

✅ **No Conflicts**: PRD 0002 implementation is fully foundation-compliant.
```

**Estimated Changes**: ~15 lines in PRD appendix
**Dependencies**: Tasks 1.0 and 5.1-5.3 complete

---

## Testing Strategy

### No Test File Changes
- All existing tests must pass without modification
- E2E determinism maintained (stub patterns unchanged)
- Upload behavior identical (FormData structure unchanged)

### Manual Testing Checklist
1. **MIME Type Extension**:
   - Upload `.jpg` → verify saved as `.jpg`
   - Upload `.png` → verify saved as `.png`
   - Upload `.webp` → verify saved as `.webp`
   - Verify existing `.jpg` images still load

2. **Upload Service**:
   - Camera capture → verify FormData identical to before
   - File input → verify FormData identical to before
   - Check uploadService is imported and used in both handlers

3. **Documentation**:
   - Verify all FOUNDATION.md links work
   - Check CONTEXT.md SHA256 verification passes
   - Ensure all cross-references resolve correctly

### Automated Testing
```bash
# Type checking
pnpm check

# Unit tests (should all pass)
pnpm test

# E2E tests (should all pass, no changes needed)
pnpm e2e
```

**Expected Result**: All tests pass without modification.

---

## Rollback Plan

### If Issues Arise:

1. **FOUNDATION.md**: Delete file, revert CONTEXT.md changes (Task 4.0)
2. **Routes refactoring**: Revert routes.ts to hard-coded `.jpg` (Task 2.0)
3. **Upload service**: Delete uploadService.ts, revert home.tsx (Task 3.0)
4. **Comments**: Revert objectStorage.ts, schema.ts comments (Task 5.0)

**Atomic Commits**: Each task should be a separate commit for easy rollback.

---

## Summary

**Total Files**:
- 2 new files (`FOUNDATION.md`, `uploadService.ts`)
- 5 modified files (`routes.ts`, `home.tsx`, `objectStorage.ts`, `schema.ts`, `CONTEXT.md`)
- 1 PRD update (`0003-prd-foundational-architecture.md`)

**Total Changes**:
- ~1240 lines added (mostly FOUNDATION.md documentation)
- ~50 lines modified (refactoring, comments)
- ~0 lines deleted

**Breaking Changes**: None
**Schema Changes**: None
**API Changes**: None
**Test Changes**: None (all must pass as-is)

**Estimated Implementation Time**: 5-7 hours
**Risk Level**: Low (documentation-focused, minor refactoring)

---

**Next Step**: Await approval, then proceed to Step 9 (Generate diffs)
