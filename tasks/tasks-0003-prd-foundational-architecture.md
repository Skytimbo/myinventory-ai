# Task List: PRD 0003 - Foundational Architecture

**PRD:** `0003-prd-foundational-architecture.md`
**Status:** Phase 1 - Parent Tasks
**Created:** 2025-11-13

---

## Relevant Files

### Documentation
- `FOUNDATION.md` — New comprehensive architecture document (to be created)
- `CONTEXT.md` — Documentation map (to be updated)
- `tasks/0003-prd-foundational-architecture.md` — This PRD

### Backend
- `server/routes.ts` — API routes (remove hard-coded `.jpg`)
- `server/objectStorage.ts` — Storage abstraction (add multi-file support comments)
- `shared/schema.ts` — Database schema (add future migration comments)

### Frontend
- `client/src/pages/home.tsx` — Upload flows (to be refactored)
- `client/src/lib/uploadService.ts` — New reusable upload service (to be created)

### Related Work
- `tasks/0002-prd-dual-env-image-persistence.md` — Dual-backend storage (alignment review)

---

## Notes

- **No schema changes**: Database structure remains unchanged
- **No API changes**: Endpoints and contracts stay the same
- **No test changes**: All existing tests must pass unmodified
- **Documentation-focused**: Primary deliverable is `FOUNDATION.md`
- **Minor refactoring only**: Remove hard-coded assumptions, extract reusable utilities

---

## Parent Tasks

### 1.0 Create FOUNDATION.md with Architectural Principles

**Description**: Create comprehensive foundation document covering 7 core principles, evolution roadmap, integration patterns, and anti-patterns for future PRD authors.

**Deliverables**:
- New `FOUNDATION.md` file at repository root
- Cover all 7 principles: Media-First, Storage Abstraction, Upload Flexibility, Container Hierarchy, Extensible Attributes, Search Architecture, Test Philosophy
- Document evolution paths for multi-image migration, container hierarchy, vertical attributes
- Provide integration patterns with code examples
- Define anti-patterns to avoid

**Acceptance Criteria**:
- `FOUNDATION.md` exists with 1000+ lines of comprehensive guidance
- All 7 principles documented with rationale and examples
- Future migration paths clearly defined (imageUrl → imageUrls, flat → hierarchy, fixed → extensible)
- Integration patterns provide concrete code examples
- Document references current architecture files with line numbers

**Estimated Effort**: 2-3 hours

---

### 2.0 Refactor Hard-Coded Media Assumptions

**Description**: Remove hard-coded file extension assumptions in routes, infer extension from validated MIME type, ensure future format support.

**Deliverables**:
- Remove hard-coded `.jpg` from `server/routes.ts` line 70
- Create MIME type to extension mapping
- Infer extension dynamically based on validated file type
- Maintain backwards compatibility (default to `.jpg` for unknowns)
- Add comments in code explaining extensibility

**Acceptance Criteria**:
- No hard-coded file extensions in routes.ts
- Upload handler correctly saves `.jpg`, `.png`, `.webp` with proper extension
- Existing `.jpg` uploads continue working
- Tests pass without modification
- Code comments explain how to add future formats (AVIF, HEIC)

**Estimated Effort**: 1 hour

---

### 3.0 Extract Reusable Upload Logic

**Description**: Decouple upload FormData construction from home.tsx, create reusable upload service utility, ensure future multi-image flows can reuse logic.

**Deliverables**:
- New `client/src/lib/uploadService.ts` file
- Export `createItemUploadFormData(imageBlob, filename)` function
- Refactor `home.tsx` camera capture handler to use service
- Refactor `home.tsx` file input handler to use service
- Maintain exact same behavior (no UI changes)

**Acceptance Criteria**:
- `uploadService.ts` exists with reusable FormData utility
- Both camera capture and file input handlers use the service
- Upload behavior unchanged (same API calls, same FormData structure)
- Service is stateless and testable in isolation
- JSDoc comments explain usage for future multi-image extension

**Estimated Effort**: 1-1.5 hours

---

### 4.0 Update CONTEXT.md with Foundation References

**Description**: Integrate FOUNDATION.md into documentation map, update architecture section to reference foundational principles, maintain doc integrity.

**Deliverables**:
- Add `FOUNDATION.md` to `CONTEXT.md` sources list (Section 1)
- Update Section 3 (Architecture Overview) to reference foundation principles
- Add note in Section 11 (Environment Configuration) about foundational patterns
- Update SHA256 verification hash
- Maintain consistent formatting and section structure

**Acceptance Criteria**:
- `FOUNDATION.md` appears in sources list as canonical architecture document
- Section 3 references at least 3 core principles from foundation
- Documentation integrity verified (SHA256 matches)
- No broken references or formatting issues
- CONTEXT.md remains comprehensive and navigable

**Estimated Effort**: 30-45 minutes

---

### 5.0 Validate PRD 0002 Alignment with Foundation

**Description**: Review PRD 0002 (dual-env storage) implementation against foundational principles, add clarifying comments if needed, confirm no conflicts.

**Deliverables**:
- Review `server/objectStorage.ts` for foundation compliance
- Add comments noting multi-file support readiness
- Review `server/routes.ts` dual-backend upload logic
- Add notes in `tasks/0002-prd-dual-env-image-persistence.md` confirming alignment
- Document any adjustments needed for future PRDs

**Acceptance Criteria**:
- PRD 0002 implementation reviewed line-by-line
- Comments added in `objectStorage.ts` explaining how service supports future multi-file scenarios
- No conflicts found between PRD 0002 and foundation principles
- Alignment confirmation documented in PRD 0003 appendix
- Future PRD authors have clear guidance on extending storage service

**Estimated Effort**: 45 minutes - 1 hour

---

## Detailed Subtasks

### 1.0 Create FOUNDATION.md with Architectural Principles

- [ ] **1.1 Create FOUNDATION.md structure**
  - Create new file at repository root
  - Add YAML front matter (version, last_updated, purpose)
  - Create section outline (Introduction, 7 Principles, Evolution Roadmap, Integration Patterns, Anti-Patterns)
  - Add table of contents
  - **Acceptance:** File exists with proper structure, TOC navigates to all sections

- [ ] **1.2 Document Principle 1: Media as First-Class Concept**
  - Explain current `imageUrl` (text) limitation
  - Document evolution path: single imageUrl → imageUrls array → Media entity
  - Provide backwards compatibility strategy (dual-field period)
  - Include code examples from schema.ts
  - **Acceptance:** Clear migration path from single to multi-image with examples

- [ ] **1.3 Document Principle 2: Storage as Environment-Agnostic Abstraction**
  - Explain ObjectStorageService dual-backend pattern
  - Document how to extend for multi-file scenarios
  - Reference server/objectStorage.ts implementation
  - Define storage path conventions for future verticals
  - **Acceptance:** Clear guidance on extending storage service without breaking abstraction

- [ ] **1.4 Document Principle 3: Upload as Pluggable Mechanism**
  - Define upload service pattern (reusable FormData utilities)
  - Document camera capture, file input, future batch upload flows
  - Explain separation of concerns (UI components vs upload logic)
  - Provide examples of upload service extension
  - **Acceptance:** Pattern enables multiple upload mechanisms without code duplication

- [ ] **1.5 Document Principle 4: Containers as Hierarchical Entities**
  - Define container hierarchy pattern (adjacency list with parent_id)
  - Explain recursive query strategy (PostgreSQL CTEs)
  - Document integration with existing items.location field
  - Provide example queries for subtree traversal
  - **Acceptance:** Clear pattern for property → room → box → item hierarchy

- [ ] **1.6 Document Principle 5: Extensible Attributes as Flexible Data**
  - Define attribute extension strategies (JSONB vs separate tables)
  - Explain when to use each approach (structured/searchable vs unstructured)
  - Document vertical-specific attribute patterns (auto parts, insurance, storage)
  - Provide schema examples for both strategies
  - **Acceptance:** Clear decision framework for adding vertical-specific fields

- [ ] **1.7 Document Principle 6: Search as First-Class Concern**
  - Define full-text search strategy (PostgreSQL tsvector)
  - Document structured attribute filtering patterns
  - Explain indexing strategies for performance
  - Provide example queries combining full-text + filters
  - **Acceptance:** Search architecture supports 10k+ items with sub-second queries

- [ ] **1.8 Document Principle 7: Tests as Behavior Assertions**
  - Explain E2E determinism strategy (stub API responses, not implementations)
  - Document test philosophy (assert user behavior, not internal implementation)
  - Reference e2e/image-fallback.spec.ts patterns
  - Define anti-patterns (testing Uppy internals vs upload outcomes)
  - **Acceptance:** Clear guidance prevents brittle tests during refactors

- [ ] **1.9 Create Evolution Roadmap section**
  - Document multi-image migration timeline (3 phases)
  - Define container hierarchy implementation approach
  - Explain vertical attribute rollout strategy
  - Provide estimated complexity for each evolution
  - **Acceptance:** Future PRD authors have clear starting point for major features

- [ ] **1.10 Create Integration Patterns section**
  - Document how to add new media types (video, PDF, receipts)
  - Explain extending ObjectStorageService for new backends (S3, Azure)
  - Provide vertical customization pattern (separate routes, services)
  - Include code examples for each pattern
  - **Acceptance:** Cookbook-style guidance with copy-paste examples

- [ ] **1.11 Create Anti-Patterns section**
  - Document what NOT to do (hard-coded paths, tight coupling, implementation tests)
  - Explain consequences of each anti-pattern
  - Provide refactoring guidance for common mistakes
  - Reference historical examples from codebase
  - **Acceptance:** Clear warnings prevent architectural regression

- [ ] **1.12 Add cross-references to existing architecture**
  - Link to CONTEXT.md Section 3 (Architecture Overview)
  - Reference server/objectStorage.ts, server/routes.ts with line numbers
  - Link to PRD 0002 for storage abstraction examples
  - Add references to design_guidelines.md for UI patterns
  - **Acceptance:** FOUNDATION.md integrates with existing documentation

---

### 2.0 Refactor Hard-Coded Media Assumptions

- [ ] **2.1 Create MIME type to extension mapping**
  - In server/routes.ts, add mimeToExt constant above POST /api/items handler
  - Map: 'image/jpeg' → 'jpg', 'image/png' → 'png', 'image/webp' → 'webp'
  - Add comment explaining how to extend for future formats (AVIF, HEIC)
  - **Acceptance:** Clean mapping object with extensibility comment

- [ ] **2.2 Refactor image URL construction**
  - Replace hard-coded `.jpg` at line 70 with dynamic extension
  - Extract extension from mimeToExt[req.file.mimetype] with 'jpg' fallback
  - Update imageUrl construction: `/objects/items/${objectId}.${ext}`
  - Maintain backwards compatibility (unknown MIME types default to .jpg)
  - **Acceptance:** Dynamic extension inference, no breaking changes

- [ ] **2.3 Update storage save logic**
  - Ensure local filesystem save uses correct extension (line 98)
  - Ensure GCS save metadata includes correct contentType (line 85-86)
  - Verify file extension matches actual file format
  - **Acceptance:** Files saved with correct extension on both backends

- [ ] **2.4 Add extensibility comments**
  - Add JSDoc comment above mimeToExt explaining future extension
  - Add comment in fileValidation.ts referencing FOUNDATION.md for new formats
  - Note in FOUNDATION.md which files need updates for new MIME types
  - **Acceptance:** Future developers have clear path to add formats

---

### 3.0 Extract Reusable Upload Logic

- [ ] **3.1 Create uploadService.ts file**
  - Create new file at client/src/lib/uploadService.ts
  - Add comprehensive JSDoc header explaining service purpose
  - Import types from @tanstack/react-query if needed
  - Export empty service object as starting point
  - **Acceptance:** File exists with proper structure and imports

- [ ] **3.2 Implement createItemUploadFormData utility**
  - Create function: `createItemUploadFormData(imageBlob: Blob, filename?: string): FormData`
  - Default filename to "upload.jpg" if not provided
  - Create FormData instance, append image with key "image"
  - Add JSDoc explaining parameters and return type
  - **Acceptance:** Function creates valid FormData for /api/items endpoint

- [ ] **3.3 Refactor home.tsx camera capture handler**
  - Import createItemUploadFormData from @/lib/uploadService
  - Replace lines 68-69 FormData construction with service call
  - Pass blob and inferred filename from MIME type
  - Maintain identical mutation behavior
  - **Acceptance:** Camera capture flow unchanged, uses service utility

- [ ] **3.4 Refactor home.tsx file input handler**
  - Import createItemUploadFormData from @/lib/uploadService
  - Replace lines 93-94 FormData construction with service call
  - Pass file and file.name as parameters
  - Maintain identical mutation behavior
  - **Acceptance:** File upload flow unchanged, uses service utility

- [ ] **3.5 Add extensibility documentation**
  - Add JSDoc comment explaining how to extend for multi-image uploads
  - Note in FOUNDATION.md that uploadService is the reusable abstraction
  - Add TODO comment for future createItemMultiUploadFormData function
  - **Acceptance:** Clear guidance for future multi-image implementation

---

### 4.0 Update CONTEXT.md with Foundation References

- [ ] **4.1 Add FOUNDATION.md to sources list**
  - In CONTEXT.md YAML front matter, add to sources array
  - Set path: FOUNDATION.md, role: foundational-architecture, canonical: true
  - Update last_updated timestamp
  - Increment audit phase if appropriate
  - **Acceptance:** FOUNDATION.md appears in sources list

- [ ] **4.2 Update Section 3 (Architecture Overview)**
  - Add subsection "Foundational Principles" referencing FOUNDATION.md
  - List 7 core principles with brief descriptions
  - Link to FOUNDATION.md for detailed guidance
  - Note relationship to PRD 0002 (dual-env storage)
  - **Acceptance:** Section 3 clearly references foundation document

- [ ] **4.3 Update Section 11 (Environment Configuration)**
  - Add note about foundational storage abstraction
  - Reference FOUNDATION.md for storage extension patterns
  - Note future multi-image environment variables (if applicable)
  - **Acceptance:** Environment config section references foundation

- [ ] **4.4 Update documentation inventory table**
  - In Section 1, add row for FOUNDATION.md
  - Include size, last modified, role, canonical status
  - Update audit artifacts reference if needed
  - **Acceptance:** Documentation inventory complete and accurate

- [ ] **4.5 Verify documentation integrity**
  - Run SHA256 verification on updated CONTEXT.md
  - Update verification.sha256_of_this_file in front matter
  - Ensure no broken links or references
  - Test that all section links work correctly
  - **Acceptance:** CONTEXT.md verification passes, all links valid

---

### 5.0 Validate PRD 0002 Alignment with Foundation

- [ ] **5.1 Review ObjectStorageService for multi-file readiness**
  - Examine server/objectStorage.ts saveLocalFile method (line 274-283)
  - Verify method signature supports arbitrary file paths
  - Check that validateObjectPath allows multi-file patterns
  - Confirm environment detection doesn't limit file count
  - **Acceptance:** Storage service architecture supports future multi-file

- [ ] **5.2 Add multi-file support comments in objectStorage.ts**
  - Add comment at line 274: "// NOTE: This method supports arbitrary file paths, enabling future multi-image scenarios"
  - Add comment at class level: "// FOUNDATION: ObjectStorageService is designed for environment-agnostic, multi-file storage. See FOUNDATION.md for extension patterns."
  - Reference FOUNDATION.md in JSDoc comments
  - **Acceptance:** Comments clarify multi-file readiness

- [ ] **5.3 Review dual-backend upload logic in routes.ts**
  - Examine POST /api/items handler (lines 72-99)
  - Verify backend selection logic is reusable for multiple files
  - Check that error handling works for multi-file scenarios
  - Confirm storage paths don't assume single file
  - **Acceptance:** Upload logic extensible to multi-file uploads

- [ ] **5.4 Document PRD 0002 alignment in PRD 0003 appendix**
  - Update "Relationship to PRD 0002" section in PRD 0003
  - Confirm no conflicts between dual-env storage and foundation
  - Note that PRD 0002 implementation is foundation-compliant
  - List any clarifying comments added to codebase
  - **Acceptance:** PRD 0003 documents successful PRD 0002 alignment

- [ ] **5.5 Add guidance for future storage extensions**
  - In FOUNDATION.md Integration Patterns section, reference PRD 0002 as example
  - Document how to add third backend (S3, Azure) following PRD 0002 pattern
  - Explain environment detection hierarchy
  - Provide code example extending ObjectStorageService
  - **Acceptance:** PRD 0002 patterns serve as template for future work

---

## Task Completion Tracking

**Status:** Detailed subtasks generated, ready for implementation
**Next Step:** Begin implementation with Task 1.1 (FOUNDATION.md structure)
**Estimated Total:** ~5-7 hours for full implementation + testing

---

## Dependencies

- **Task 1.0** has no dependencies (can start immediately)
- **Task 2.0** should reference Task 1.0 for MIME type extension guidance
- **Task 3.0** is independent of Tasks 1-2
- **Task 4.0** depends on Task 1.0 completion (needs FOUNDATION.md to exist)
- **Task 5.0** depends on Task 1.0 completion (needs principles to validate against)

**Critical Path**: Task 1.0 → Tasks 4.0 & 5.0

---

## Success Criteria Summary

1. ✅ `FOUNDATION.md` exists with comprehensive architectural guidance
2. ✅ No hard-coded file extensions in codebase
3. ✅ Upload logic extracted to reusable service
4. ✅ `CONTEXT.md` references foundation
5. ✅ PRD 0002 confirmed aligned with foundation
6. ✅ All existing tests pass
7. ✅ Zero schema changes
8. ✅ Zero API changes
9. ✅ Zero test changes

**Final Validation**: Run `pnpm check && pnpm test && pnpm e2e` - all must pass.
