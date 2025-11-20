# PRD 0003: Foundational Architecture for a Flexible, Multi-Vertical Inventory Platform

**Status:** Draft
**Created:** 2025-11-13
**Last Updated:** 2025-11-13
**Author:** AI Assistant
**Type:** Documentation + Minor Refactoring
**Related:** PRD 0002 (Dual-Environment Image Persistence)

---

## Overview

MyInventory AI is evolving from a single-use personal inventory tool into a flexible platform that can support multiple verticals (auto parts catalogs, storage business portals, insurance documentation, estate planning) with advanced capabilities (multi-image items, hierarchical containers, batch uploads, object detection workflows).

**The Problem:**
The current architecture has made pragmatic MVP decisions that, while sensible for initial development, risk becoming technical debt as we scale to multi-vertical, multi-image, and hierarchical use cases. Specifically:
- Items are hard-coded to a single `imageUrl` (text field)
- Upload flows are tightly coupled to page components
- Storage paths assume single files per item (`.jpg` hard-coded)
- No pattern exists for container hierarchies (property → room → box → item)
- No strategy for vertical-specific attributes (e.g., auto part numbers, fitment data)

**The Solution:**
PRD 0003 establishes a **foundational architecture** via a new `FOUNDATION.md` document and minor refactorings. This foundation:
- **Documents patterns** for future PRDs without implementing features prematurely
- **Removes limiting assumptions** (e.g., hard-coded file extensions)
- **Preserves stability** (no schema migrations, no API changes, no test disruption)
- **Enables extensibility** cheaply and safely

**Version:** Non-breaking, documentation-focused update (v0.3.x)

---

## Goals

### Primary Goals
1. **Document Architectural Principles**: Create `FOUNDATION.md` with clear patterns for multi-image, containers, extensible attributes, and vertical-specific customization
2. **Remove Hard-Coded Assumptions**: Eliminate `.jpg` extension hard-coding, decouple upload logic from UI components
3. **Define Evolution Paths**: Provide roadmap for future PRDs (multi-image migration, container hierarchy, attribute extensibility)
4. **Maintain Stability**: Zero schema changes, zero API contract changes, zero test breakage
5. **Align Existing Work**: Validate that PRD 0002 (dual-env storage) conforms to foundational principles

### Success Metrics
- ✅ `FOUNDATION.md` exists and comprehensively covers all 7 architectural principles
- ✅ No hard-coded file extensions in `server/routes.ts`
- ✅ Upload logic extracted to reusable utility (not in `home.tsx`)
- ✅ All existing tests pass without modification
- ✅ PRD 0002 implementation reviewed for compliance
- ✅ `CONTEXT.md` references foundation in architecture section

---

## User Stories

### US-1: Future PRD Author
**As a** developer creating PRD 0004 (multi-image support)
**I want to** reference clear architectural patterns for media evolution
**So that** I can design a schema migration path that aligns with the foundation

**Acceptance Criteria:**
- `FOUNDATION.md` documents how `imageUrl` → `imageUrls` migration should work
- Guidance on storage path strategy for multiple files per item
- API contract evolution strategy (backwards compatibility)

### US-2: Vertical Feature Developer
**As a** developer building the Jeep parts catalog vertical
**I want to** understand how to add structured attributes (part numbers, fitment, condition)
**So that** I don't pollute the core schema with vertical-specific columns

**Acceptance Criteria:**
- `FOUNDATION.md` defines extensibility patterns (separate tables, JSONB, or attribute entities)
- Guidance on search/indexing for structured attributes
- Examples of how different verticals can coexist

### US-3: Container Hierarchy Implementer
**As a** developer building property → room → box → item hierarchy
**I want to** understand the recommended pattern for nested relationships
**So that** I can query subtrees efficiently and generate index sheets

**Acceptance Criteria:**
- `FOUNDATION.md` describes container entity pattern with `parent_id`
- Guidance on recursive queries and indexing strategies
- Integration points with existing `items.location` field

---

## Functional Requirements

### FR-1: FOUNDATION.md Creation
The system shall have a comprehensive `FOUNDATION.md` document covering:
1. **Media-First Principle**: Path from single `imageUrl` to multi-media architecture
2. **Storage Abstraction**: How `ObjectStorageService` must remain environment-agnostic
3. **Upload Flexibility**: Pattern for reusable upload components/services
4. **Container Hierarchy**: Design for nested property/room/box/item relationships
5. **Extensible Attributes**: Strategy for vertical-specific fields without schema explosion
6. **Search Architecture**: Full-text + structured attribute filtering patterns
7. **Test Philosophy**: Assert behavior, not implementation; maintain determinism

### FR-2: Hard-Coded Extension Removal
The system shall:
- Remove `.jpg` hard-coding from `server/routes.ts` line 70
- Infer file extension from validated MIME type via `fileValidation.ts`
- Support `.jpeg`, `.jpg`, `.png`, `.webp` dynamically
- Maintain backwards compatibility with existing image URLs

### FR-3: Upload Logic Decoupling
The system shall:
- Extract FormData construction logic from `home.tsx` into reusable utility
- Create `client/src/lib/uploadService.ts` with `createItemUploadFormData()` helper
- Allow future upload flows (multi-image, batch) to reuse the service
- Maintain existing behavior for camera capture and file input flows

### FR-4: Schema Evolution Documentation
The system shall:
- Add comments in `shared/schema.ts` noting future `imageUrls` migration path
- Document backwards compatibility strategy (dual-field period)
- Define deprecation timeline for single `imageUrl` field

### FR-5: CONTEXT.md Integration
The system shall:
- Add `FOUNDATION.md` to `CONTEXT.md` sources list
- Reference architectural principles in Section 3 (Architecture Overview)
- Maintain documentation integrity (SHA256 verification)

### FR-6: PRD 0002 Alignment Validation
The system shall:
- Review `server/objectStorage.ts` for compliance with foundation
- Ensure dual-backend storage abstraction supports future multi-file scenarios
- Add clarifying comments if PRD 0002 implementation needs guidance

---

## Non-Goals

### Out of Scope for This PRD
1. **Schema Migrations**: No changes to `shared/schema.ts` structure (defer to PRD 0004+)
2. **Multi-Image Implementation**: No `imageUrls` array, no gallery UI, no multi-file upload (PRD 0004)
3. **Container Entities**: No `containers` table, no hierarchical queries (PRD 0005)
4. **Extensible Attributes**: No JSONB field, no vertical-specific tables (PRD 0006)
5. **API Changes**: No new endpoints, no payload format changes
6. **Test Rewrites**: No changes to E2E test stubs or determinism strategy
7. **UI Refactoring**: No gallery components, no multi-image display logic

---

## Design Considerations

### Foundation Document Structure

```markdown
FOUNDATION.md:
├── Introduction (Why this document exists)
├── Core Principles (7 foundational constraints)
│   ├── 1. Media as First-Class Concept
│   ├── 2. Storage as Environment-Agnostic Abstraction
│   ├── 3. Upload as Pluggable Mechanism
│   ├── 4. Containers as Hierarchical Entities
│   ├── 5. Attributes as Extensible Data
│   ├── 6. Search as First-Class Concern
│   └── 7. Tests as Behavior Assertions
├── Evolution Roadmap (How to migrate)
│   ├── Multi-Image Migration Path
│   ├── Container Hierarchy Implementation
│   └── Vertical Attribute Strategies
├── Integration Patterns (For PRD authors)
│   ├── Adding New Media Types
│   ├── Extending Storage Service
│   └── Creating Vertical Customizations
└── Anti-Patterns (What NOT to do)
```

### File Extension Inference Strategy

**Current (Hard-Coded):**
```typescript
const imageUrl = `/objects/items/${objectId}.jpg`; // Always .jpg
```

**Refactored (Inferred):**
```typescript
const mimeToExt = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};
const ext = mimeToExt[req.file.mimetype] || 'jpg';
const imageUrl = `/objects/items/${objectId}.${ext}`;
```

**Rationale:**
- Preserves correct file semantics (PNG as PNG, not renamed to JPG)
- Enables future format support (AVIF, HEIC)
- Maintains backwards compatibility (default to `.jpg` for unknowns)

### Upload Service Abstraction

**Current (Tightly Coupled):**
```typescript
// home.tsx lines 68-69
const formData = new FormData();
formData.append("image", blob, "upload.jpg");
createItemMutation.mutate(formData);
```

**Refactored (Reusable Service):**
```typescript
// client/src/lib/uploadService.ts
export function createItemUploadFormData(
  imageBlob: Blob,
  filename: string = "upload.jpg"
): FormData {
  const formData = new FormData();
  formData.append("image", imageBlob, filename);
  return formData;
}

// home.tsx
import { createItemUploadFormData } from "@/lib/uploadService";
const formData = createItemUploadFormData(blob);
createItemMutation.mutate(formData);
```

**Benefits:**
- Future multi-image uploads can extend the service
- Batch upload flows reuse the same logic
- Testing upload logic becomes isolated from UI components

---

## Technical Considerations

### Module Boundaries

**Principle**: Storage, upload, and media logic must remain **server-only** for business logic, with **thin client utilities** for UI concerns.

**Boundaries:**
- `/server/objectStorage.ts` - Storage abstraction (no client dependencies)
- `/server/routes.ts` - API contracts (no UI coupling)
- `/client/src/lib/uploadService.ts` - Client-side FormData utilities (no business logic)
- `/shared/schema.ts` - Database schema (pure Drizzle definitions)

**Violations to Avoid:**
- ❌ Storage paths hard-coded in client components
- ❌ MIME type validation logic duplicated in client
- ❌ Business logic in upload UI components

### Backwards Compatibility Strategy

**For Future Multi-Image Migration (PRD 0004+):**

**Phase 1**: Add `imageUrls` array alongside `imageUrl`
```typescript
// shared/schema.ts
imageUrl: text("image_url").notNull(), // Keep for backwards compat
imageUrls: text("image_urls").array().$type<string[]>().default([]), // New field
```

**Phase 2**: Populate both fields during transition period
```typescript
// server/routes.ts
const imageUrl = `/objects/items/${objectId}.${ext}`;
const imageUrls = [imageUrl]; // First image becomes array element
await storage.createItem({ ...data, imageUrl, imageUrls });
```

**Phase 3**: Deprecate `imageUrl` field (6+ months later)
- Update UI to use `imageUrls[0]` instead of `imageUrl`
- Database migration: `UPDATE inventory_items SET image_urls = ARRAY[image_url] WHERE image_urls IS NULL`
- Drop `imageUrl` column after full migration

### Performance Considerations

**Foundation Principles Must Not Sacrifice Performance:**
- Storage abstraction must remain zero-cost (environment check at init, not per-request)
- Upload service should be stateless (no overhead from service instantiation)
- Container hierarchy queries must support efficient recursive CTEs (PostgreSQL)
- Search indexing strategy must scale to 10k+ items per vertical

### Security Considerations

**Foundation Must Reinforce Security Patterns:**
- Path validation remains mandatory for all object routes (prevent traversal)
- MIME type validation must use both declared type + magic numbers
- File size limits enforced at middleware level
- Container hierarchy must respect ownership/tenancy (future multi-user support)

---

## Success Metrics

### Definition of Done
1. ✅ `FOUNDATION.md` exists at repository root with all 7 principles documented
2. ✅ `server/routes.ts` no longer hard-codes `.jpg` extension
3. ✅ `client/src/lib/uploadService.ts` provides reusable FormData utility
4. ✅ `shared/schema.ts` has comments noting future migration path
5. ✅ `CONTEXT.md` references `FOUNDATION.md` in sources and architecture section
6. ✅ All existing tests pass without modification
7. ✅ PRD 0002 implementation reviewed, alignment confirmed

### Measurable Outcomes
- **Documentation Coverage**: 100% of 7 principles documented with examples
- **Zero Regressions**: All unit, integration, and E2E tests pass
- **Zero Breaking Changes**: No API contract changes, no schema migrations
- **Code Reusability**: Upload service function has 2+ call sites (camera + file input)

---

## Implementation Phases

### Phase 1: Foundation Documentation
- Create `FOUNDATION.md` with comprehensive architectural principles
- Document evolution roadmap for multi-image, containers, attributes
- Define integration patterns for future PRD authors

### Phase 2: Minor Refactoring
- Remove hard-coded `.jpg` extension in routes
- Extract upload FormData logic to reusable service
- Add schema comments for future migration guidance

### Phase 3: CONTEXT.md Integration
- Add `FOUNDATION.md` to sources list
- Update architecture section with principle references
- Verify documentation integrity

### Phase 4: Alignment Validation
- Review PRD 0002 implementation
- Add clarifying comments if needed
- Confirm no conflicts with foundation principles

---

## Decisions on Open Questions

### Q: Should we define a strict file naming convention now?
**Decision:** No. Keep current UUID-based naming (`{uuid}.{ext}`). Future PRDs can extend to `{uuid}-{index}.{ext}` for multi-image.

### Q: Should extensible attributes use JSONB or separate tables?
**Decision:** Document both patterns in `FOUNDATION.md`. Let vertical-specific PRDs choose based on query needs. Auto parts (structured, searchable) → separate table. Insurance notes (unstructured) → JSONB.

### Q: Should container hierarchy use adjacency list or nested sets?
**Decision:** Document adjacency list pattern (simpler, PostgreSQL recursive CTEs are efficient). Nested sets add complexity without clear benefit for our use case.

### Q: Should we enforce foundation compliance with linting/validation?
**Decision:** Not yet. Document principles first, add enforcement tooling in future PRD if violations occur.

---

## Appendix: Current Architectural Constraints

### Single-Image Limitations (from Agent Analysis)

**Database** (`shared/schema.ts:12`):
```typescript
imageUrl: text("image_url").notNull() // Single text field, not array
```

**API** (`server/routes.ts:51`):
```typescript
upload.single("image") // Enforces single file upload
```

**Storage** (`server/routes.ts:70`):
```typescript
const imageUrl = `/objects/items/${objectId}.jpg`; // Hard-coded .jpg
```

**UI** (`client/src/components/ItemCard.tsx:60`):
```typescript
<img src={item.imageUrl} /> // Expects single URL string
```

### Tight Coupling Issues

**Upload Logic** (`client/src/pages/home.tsx:68-69, 93-94`):
- Direct FormData construction in two separate handlers
- No reusable service for upload flow
- Camera capture and file input duplicate logic

**Storage Path Assumptions** (`server/routes.ts:70`):
- Items always go to `/objects/items/` prefix
- No category-based path organization
- No provision for multi-file scenarios

---

## Relationship to PRD 0002

**PRD 0002 (Dual-Environment Image Persistence)** implemented environment-aware storage (local filesystem vs GCS). PRD 0003 ensures PRD 0002's abstractions align with future multi-image needs:

**Compliance Checklist:**
- ✅ Storage abstraction is environment-agnostic (`ObjectStorageService` class)
- ✅ Path validation prevents traversal attacks (`validateObjectPath()`)
- ✅ Dual backend supports future multi-file scenarios (save/retrieve methods are generic)
- ⚠️ Minor adjustment needed: Comment in `objectStorage.ts` noting multi-file support readiness

**No Conflicts**: PRD 0002 implementation is foundation-compliant. Only clarifying comments needed.

---

**Document Status:** Draft
**Next Review:** After implementation (estimated: 2025-11-15)
**Maintainer:** Project team
**Questions?** See `tasks/PROTOCOLS.md` for PRD generation guidelines
