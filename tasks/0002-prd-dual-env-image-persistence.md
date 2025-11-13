# PRD 0002: Dual-Environment Image Persistence

**Status:** Draft
**Created:** 2025-11-12
**Last Updated:** 2025-11-12
**Author:** AI Assistant
**Related Issues:** Image upload failure in local development

---

## Overview

Currently, MyInventory AI's image upload and retrieval system is configured exclusively for Replit's Google Cloud Storage sidecar, which is not available in local development environments. This causes image uploads to fail silently in local development, preventing developers from testing the full user experience and blocking feature development that depends on image functionality.

This PRD defines a dual-environment image persistence solution that:
- Uses local filesystem storage for development (macOS/Linux)
- Maintains Google Cloud Storage for production (Replit)
- Provides a unified abstraction with consistent URL patterns
- Ensures backwards compatibility with existing Replit deployments

**Version:** This is a non-breaking, minor-version update (v0.2.x). No migration required and no changes to existing stored images. All changes are internal to `server/objectStorage.ts` and do not affect the API contract, database schema, or shared types.

---

## Goals

### Primary Goals
1. **Enable local development**: Developers can upload, store, and retrieve images without Replit sidecar
2. **Maintain production compatibility**: Zero breaking changes to Replit/GCS deployment
3. **Unified abstraction**: Same API contract and URL patterns across environments
4. **Persistence**: Images survive server restarts in both environments
5. **Test coverage**: All existing tests pass, new tests cover storage abstraction

### Success Metrics
- ✅ Local dev: Upload image → item created → image displays → survives restart
- ✅ Replit: Existing GCS flow continues working unchanged
- ✅ All unit, integration, and E2E tests pass
- ✅ Zero changes required to UI components or API contracts
- ✅ Clear error messages for unsupported file types

---

## User Stories

### US-1: Developer Testing Locally
**As a** developer working on MyInventory AI locally
**I want to** upload images and see them persist across server restarts
**So that** I can test the full user experience without deploying to Replit

**Acceptance Criteria:**
- Can upload JPEG, PNG, or WebP images from local machine
- Images appear in item cards immediately after upload
- Images remain accessible after stopping and restarting dev server
- Non-image files are rejected with clear error message

### US-2: Production Deployment Stability
**As a** production deployment on Replit
**I want to** continue using Google Cloud Storage without any code changes
**So that** I maintain existing performance and reliability

**Acceptance Criteria:**
- Replit deployment detects environment automatically
- GCS credentials and sidecar continue to work as before
- No new environment variables required for Replit
- Image URLs remain consistent (e.g., `/objects/items/{uuid}.jpg`)

### US-3: Environment-Agnostic Frontend
**As a** React component developer
**I want to** use the same image URL patterns regardless of environment
**So that** I don't need environment-specific code in the UI

**Acceptance Criteria:**
- Same `/objects/*` URL pattern in local and production
- No conditional rendering based on environment
- Image error states handled uniformly

---

## Functional Requirements

### FR-1: Environment Detection
The system shall automatically detect whether it's running in Replit or local development by checking for the `REPL_ID` environment variable.

### FR-2: Local Filesystem Storage
When running locally (no `REPL_ID`), the system shall:
- Store uploaded images in a configurable directory (default: `./uploads/`)
- Create subdirectories as needed (e.g., `uploads/items/`)
- Support JPEG, PNG, and WebP formats
- Reject uploads exceeding the configured size limit (default: 10MB)
- Persist files across server restarts

### FR-3: Google Cloud Storage (Replit)
When running on Replit (`REPL_ID` present), the system shall:
- Use the existing Google Cloud Storage sidecar integration
- Maintain current authentication flow
- Preserve existing object paths and ACL policies
- No changes to current GCS behavior

### FR-4: Unified Storage Abstraction
The system shall provide a unified `ObjectStorageService` interface with methods:
- `saveFile(path: string, buffer: Buffer): Promise<void>` - Save file to storage
- `getFile(path: string): Promise<Buffer>` - Retrieve file from storage
- `getFileStream(path: string, res: Response): Promise<void>` - Stream file to HTTP response
- `fileExists(path: string): Promise<boolean>` - Check if file exists

### FR-5: URL Pattern Consistency
All image URLs shall follow the pattern `/objects/{category}/{uuid}.{ext}` regardless of storage backend.

### FR-6: File Type Validation
The system shall:
- Accept only JPEG (.jpg, .jpeg), PNG (.png), and WebP (.webp) files
- Reject other file types with HTTP 400 and error message: "Invalid file type. Only JPEG, PNG, and WebP images are supported."
- Validate based on MIME type, not just file extension

### FR-7: Size Limit Enforcement
The system shall reject uploads exceeding 10MB with HTTP 413 and error message: "File too large. Maximum size is 10MB."

### FR-8: Error Handling
The system shall:
- Return descriptive errors for storage failures
- Log detailed error information server-side
- Provide user-friendly error messages to the client
- Not expose internal paths or credentials in error responses

### FR-9: Backwards Compatibility
The system shall:
- Work with existing database schema (no migrations required)
- Maintain existing API contracts
- Not break existing UI components
- Pass all existing tests without modification

---

## Non-Goals

### Out of Scope for This Release
1. **Image optimization**: No resizing, compression, or thumbnail generation
2. **CDN integration**: No caching layer or CDN upload
3. **Image deletion**: No automatic cleanup when items are deleted (existing behavior maintained)
4. **Migration tools**: No tool to move images between storage backends
5. **Multi-region storage**: Single storage location per environment
6. **Image metadata extraction**: No EXIF reading or metadata parsing
7. **UI redesign**: No changes to upload flow or image display components

---

## Design Considerations

### Storage Location (Local)
- **Directory**: `./uploads/` at repository root
- **Structure**: Mirror GCS structure (`uploads/items/{uuid}.jpg`)
- **Gitignore**: Add `uploads/` to `.gitignore` to prevent committing user data
- **Permissions**: Use default filesystem permissions (no special security)

### Environment Configuration
- **Detection**: Automatic via `REPL_ID` environment variable
- **Override**: Optional `STORAGE_BACKEND=local|gcs` env var for testing
- **Defaults**: Safe defaults for both environments

### URL Routing
- **Pattern**: `/objects/:category/:filename`
- **Handler**: Single Express route with environment-specific backend
- **Caching**: Leverage browser caching with appropriate headers

---

## Technical Considerations

### Implementation Strategy
1. **Refactor `ObjectStorageService`** class to support dual backends
2. **Add local filesystem methods** alongside GCS methods
3. **Update `/objects/*` route** to dispatch based on environment
4. **Simplify frontend upload** to direct `/api/items` POST (no presigned URLs locally)
5. **Update `.gitignore`** to exclude `uploads/` directory

### Module Boundaries
**Storage abstraction is server-only.** No changes to `/shared`, no changes to schema or API contracts. Only replace internal implementations inside `server/objectStorage.ts`. This ensures:
- Business logic in `server/routes.ts` calls the storage service without environment awareness
- No storage paths or backend details leak into API responses
- Frontend remains completely agnostic to storage implementation
- Database schema (`shared/schema.ts`) requires no modifications

### Environment Selection Hierarchy
The system determines storage backend in this exact order:
1. **`STORAGE_BACKEND` environment variable** (if set): Explicit override for testing
   - `STORAGE_BACKEND=gcs` → Force Google Cloud Storage
   - `STORAGE_BACKEND=local` → Force local filesystem
2. **`REPL_ID` environment variable** (if `STORAGE_BACKEND` not set):
   - Present → Google Cloud Storage (Replit environment)
   - Absent → Local filesystem (development environment)
3. **`LOCAL_STORAGE_DIR` configuration** (only when storage=local):
   - Specifies directory for local uploads
   - Default: `./uploads` (relative to repository root)
   - Must be an absolute or relative path, validated at startup

### Files to Modify
- `server/objectStorage.ts` - Add local FS methods, environment detection
- `server/routes.ts` - Update image save and serve routes
- `client/src/pages/home.tsx` - Simplify upload to direct POST
- `.gitignore` - Add `uploads/` directory

### Files to Create
- `uploads/` directory structure (created automatically)
- Additional unit tests for storage abstraction

### Dependencies
- **No new dependencies** - Use Node.js built-in `fs/promises`
- Existing: `@google-cloud/storage`, `multer`, `express`

### Testing Strategy
1. **Unit tests**: Storage abstraction methods (save, retrieve, stream)
2. **Integration tests**: Upload → save → retrieve → display flow
3. **E2E tests**: Complete user flow in both mock environments
4. **Manual testing**: Local dev server upload and persistence

**E2E Determinism Requirements:**
All E2E tests must continue using deterministic image stubs. Real uploads should not break or alter any Playwright mocks. New storage logic must be guarded behind `process.env.NODE_ENV !== 'test'` or equivalent to prevent side effects in CI. E2E tests stub `/api/items` to return predictable data with deterministic 404→retry→200 image flows (1×1 PNG). This PRD's changes must not interfere with this established pattern.

### Security Considerations
- **Path traversal**: Validate file paths to prevent directory traversal attacks
- **File type validation**: Validate MIME type using **both** `multer`'s `file.mimetype` **and** magic-number sniffing of the first bytes of the file for robustness. This prevents spoofed extensions or manipulated MIME headers from bypassing validation.
- **Size limits**: Enforce at multer middleware level
- **Access control**: Serve local files only through controlled route, not static serving
- **Error exposure**: Never expose internal filesystem paths or GCS bucket details in error responses

### Performance Considerations
- **Local I/O**: Fast enough for development (sub-10ms reads)
- **Streaming**: Use `fs.createReadStream()` to avoid loading large files into memory
- **Concurrent uploads**: No locking required (UUIDs prevent collisions)

---

## Success Metrics

### Definition of Done
1. ✅ Developer can `pnpm dev` and upload image locally
2. ✅ Image displays in UI immediately after upload
3. ✅ Image persists after `Ctrl+C` and restart
4. ✅ Replit deployment continues working without changes
5. ✅ All existing tests pass without modification
6. ✅ New tests added for storage abstraction
7. ✅ Documentation updated (README or CONTEXT.md)

### Measurable Outcomes
- **Test Coverage**: 100% of new storage abstraction code covered by tests
- **Zero Regressions**: All 15+ existing tests pass
- **Fast Local Storage**: <10ms average read latency for images <1MB
- **Clear Errors**: All error responses include `error` and `code` fields

---

## Decisions on Open Questions

### Q: Should we support S3 or other cloud storage providers?
**Decision:** No. Keep GCS for Replit, local FS for dev. Other providers are out of scope.

### Q: Should we validate image dimensions or content?
**Decision:** No. Only validate file type (MIME) and size. Content validation is out of scope.

### Q: Should we implement image deletion when items are deleted?
**Decision:** Not in this PR. Maintain existing behavior (no automatic cleanup).

### Q: Should we add a migration path from GCS to local or vice versa?
**Decision:** No. Each environment's images stay in that environment. No migration tooling.

### Q: Should we support the existing ObjectUploader (Uppy) component?
**Decision:** Simplify to standard file input for now. Uppy can be re-added later if needed. Direct POST to `/api/items` is simpler and works in both environments.

**UI Contract Stability:** If removing Uppy breaks tests that reference its UI selectors (e.g., `data-testid="object-uploader"`, Uppy-specific buttons), update only those selectors—not the underlying E2E workflows. The test semantics (upload → verify item appears with image) remain unchanged; only the mechanism changes from Uppy to standard file input.

### Q: Should `uploads/` be configurable via environment variable?
**Decision:** Yes, but with a safe default. Add `LOCAL_STORAGE_DIR` env var, default to `./uploads`.

---

## Appendix: Current Issues

### Problem Statement
In local development, attempting to upload an image results in:
1. OpenAI API error (due to mock endpoint configuration issue)
2. Google Cloud Storage error: `ECONNREFUSED 127.0.0.1:1106`
3. HTTP 500 response to client
4. No image saved or displayed

### Root Cause
The codebase is tightly coupled to Replit's GCS sidecar, which exposes credentials at `http://127.0.0.1:1106/credential`. This endpoint doesn't exist in local development, causing all storage operations to fail.

### Proposed Solution
Introduce environment-aware storage backend selection:
- **Local**: Use Node.js `fs/promises` to save files to `./uploads/`
- **Replit**: Use existing `@google-cloud/storage` client with sidecar credentials
- **Abstraction**: Unified interface hides implementation details from routes and UI

This approach requires minimal code changes, maintains backwards compatibility, and enables full local development testing.
