# Task List: PRD 0002 - Dual-Environment Image Persistence

**PRD:** `0002-prd-dual-env-image-persistence.md`
**Status:** Phase 1 - Parent Tasks
**Created:** 2025-11-12

---

## Relevant Files

### Backend
- `server/objectStorage.ts` — Storage abstraction with dual backend support
- `server/routes.ts` — API routes for image upload and serving
- `server/index.ts` — Environment validation at startup

### Frontend
- `client/src/pages/home.tsx` — Upload UI (replace Uppy with standard input)
- `client/src/components/ItemCard.tsx` — Image display (no changes expected)

### Configuration
- `.gitignore` — Add `uploads/` directory
- `.env.example` — Document new environment variables

### Tests
- `server/tests/objectStorage.spec.ts` — New unit tests for storage abstraction
- `server/tests/routes.spec.ts` — Update integration tests for dual-backend
- `client/src/__tests__/home.spec.tsx` — Update for new upload UI
- `e2e/` — Verify E2E tests maintain determinism

---

## Notes

- **No schema changes**: Database and API contracts remain unchanged
- **No shared/ changes**: Storage abstraction stays server-only
- **Backwards compatible**: Replit/GCS deployment unaffected
- **Test framework**: Vitest for unit/integration, Playwright for E2E
- **Version**: Non-breaking minor update (v0.2.x)

---

## Tasks

### 1.0 Refactor ObjectStorageService for dual-backend support

- [ ] **1.1 Add environment detection logic**
  - Import `fs/promises` and `path` at top of `server/objectStorage.ts`
  - Add `isReplit` constant: `const isReplit = process.env.REPL_ID !== undefined`
  - Add storage backend selection function that checks `STORAGE_BACKEND` env var first, then `REPL_ID`
  - Update `objectStorageClient` initialization to conditionally initialize GCS only when `isReplit === true`
  - **Acceptance:** `isReplit` correctly detects environment, GCS client null when local

- [ ] **1.2 Add local storage configuration methods**
  - Add `getLocalStorageDir()` method returning `process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), 'uploads')`
  - Update `getPrivateObjectDir()` to return local dir when `!isReplit`
  - Update `getPublicObjectSearchPaths()` to return `[getLocalStorageDir()]` when `!isReplit`
  - **Acceptance:** Methods return appropriate paths based on environment

- [ ] **1.3 Implement local filesystem save method**
  - Add `saveLocalFile(relativePath: string, buffer: Buffer): Promise<void>` method
  - Use `fs.mkdir()` with `{ recursive: true }` to create directories
  - Use `fs.writeFile()` to save buffer to disk
  - Handle errors with descriptive messages (no path exposure)
  - **Acceptance:** Files saved to `uploads/items/{uuid}.jpg`, directories created automatically

- [ ] **1.4 Implement local filesystem retrieval method**
  - Add `getLocalObjectFile(objectPath: string): Promise<string>` method
  - Validate path starts with `/objects/`, throw `ObjectNotFoundError` if not
  - Map `/objects/items/{uuid}.jpg` to `uploads/items/{uuid}.jpg`
  - Use `fs.access()` to check file exists, throw `ObjectNotFoundError` if not
  - Return absolute path for streaming
  - **Acceptance:** Correctly maps URLs to filesystem paths, validates existence

- [ ] **1.5 Implement local filesystem streaming method**
  - Add `downloadLocalObject(filePath: string, res: Response, cacheTtlSec: number): Promise<void>` method
  - Use `fs.stat()` to get file size and validate existence
  - Detect content type from extension (`.jpg`→`image/jpeg`, `.png`→`image/png`, `.webp`→`image/webp`)
  - Set response headers: `Content-Type`, `Content-Length`, `Cache-Control: public, max-age=${cacheTtlSec}`
  - Use `fs.createReadStream()` and pipe to response
  - Handle stream errors gracefully
  - **Acceptance:** Files stream correctly with proper headers, errors handled

- [ ] **1.6 Add startup configuration validation**
  - In `server/index.ts`, validate environment configuration before starting server
  - If local mode, check `LOCAL_STORAGE_DIR` is accessible (or use default)
  - If Replit mode, verify GCS credentials available
  - Log storage backend being used at startup
  - **Acceptance:** Clear startup logs, early failure if misconfigured

### 2.0 Implement robust file validation and security

- [ ] **2.1 Add magic-number MIME validation utility**
  - Create `server/fileValidation.ts` with `getMimeTypeFromBuffer(buffer: Buffer): string | null`
  - Check first bytes for JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), WebP (`52 49 46 46 ... 57 45 42 50`)
  - Return standardized MIME type (`image/jpeg`, `image/png`, `image/webp`) or null
  - **Acceptance:** Correctly identifies image types from raw bytes, rejects spoofed files

- [ ] **2.2 Add comprehensive file validation function**
  - Create `validateUploadedFile(file: Express.Multer.File): { valid: boolean, error?: string }`
  - Check `file.mimetype` matches allowed types
  - Check magic-number MIME type matches declared MIME type
  - Reject if mismatch or invalid type
  - Return descriptive error messages
  - **Acceptance:** Both checks must pass, clear error messages for failures

- [ ] **2.3 Add path traversal validation**
  - Create `validateObjectPath(objectPath: string): boolean` in `server/objectStorage.ts`
  - Check path doesn't contain `..`, absolute paths, or suspicious patterns
  - Ensure path starts with `/objects/` and matches expected pattern
  - **Acceptance:** Rejects malicious paths, accepts valid object URLs

- [ ] **2.4 Update multer configuration with size limits**
  - In `server/routes.ts`, verify multer middleware has `limits: { fileSize: 10485760 }`
  - Add error handler for multer size limit errors
  - Return HTTP 413 with message: "File too large. Maximum size is 10MB."
  - **Acceptance:** Files >10MB rejected with clear error before processing

### 3.0 Update API routes for environment-aware storage

- [ ] **3.1 Refactor POST /api/items for dual-backend**
  - In `server/routes.ts`, replace direct GCS save with abstraction
  - Call `validateUploadedFile(req.file)` before processing
  - Use `if (isReplit)` to choose GCS path, else use `objectStorageService.saveLocalFile()`
  - Maintain existing `imageUrl = /objects/items/${objectId}.jpg` pattern
  - **Acceptance:** Uploads work in both environments, same URL pattern

- [ ] **3.2 Update GET /objects/* for dual-backend**
  - Replace direct GCS retrieval with environment-aware logic
  - If `isReplit`: use existing `getObjectEntityFile()` + `downloadObject()`
  - If local: use `getLocalObjectFile()` + `downloadLocalObject()`
  - Maintain error handling (404 for ObjectNotFoundError)
  - **Acceptance:** Images serve correctly from both backends

- [ ] **3.3 Add descriptive API error responses**
  - Update file validation errors to use `ApiError` class
  - File type error: `ApiError(400, 'INVALID_FILE_TYPE', 'Only JPEG, PNG, and WebP images are supported')`
  - File size error: `ApiError(413, 'FILE_TOO_LARGE', 'File exceeds 10MB limit')`
  - Storage error: `ApiError(500, 'STORAGE_ERROR', 'Failed to save image')`
  - **Acceptance:** All errors follow `{error, code}` format, no internal paths exposed

- [ ] **3.4 Remove unused /api/objects/upload endpoint**
  - Delete POST `/api/objects/upload` route (presigned URL generation, not needed for local)
  - Update any references in comments or documentation
  - **Acceptance:** Route removed, no broken references

### 4.0 Update frontend upload mechanism

- [ ] **4.1 Replace Uppy with standard file input**
  - In `client/src/pages/home.tsx`, remove `ObjectUploader` import and usage
  - Remove `@uppy/core` type imports
  - Add `useRef<HTMLInputElement>(null)` for file input
  - Replace ObjectUploader component with hidden `<input type="file" accept="image/*">`
  - Add visible button that triggers `fileInputRef.current?.click()`
  - **Acceptance:** UI shows "Upload Image" button, clicking opens file picker

- [ ] **4.2 Implement direct upload handler**
  - Add `handleFileSelect(event: React.ChangeEvent<HTMLInputElement>)` function
  - Extract `file` from `event.target.files[0]`
  - Validate file type client-side (`.type.startsWith('image/')`), show toast if invalid
  - Create FormData, append file, call `createItemMutation.mutate(formData)`
  - Reset file input after upload
  - **Acceptance:** File uploads directly to /api/items, proper error handling

- [ ] **4.3 Update UI test selectors**
  - Change `data-testid="object-uploader"` to `data-testid="button-upload-image"`
  - Ensure file input has `data-testid="file-input"` for testing
  - Keep semantic meaning: "upload image" action
  - **Acceptance:** Test selectors updated, no breaking changes to E2E test semantics

- [ ] **4.4 Add user-friendly error messages**
  - Show toast for invalid file types: "Please select an image file (JPEG, PNG, or WebP)"
  - Show toast for upload failures: "Failed to upload image. Please try again."
  - Reuse existing `useToast` hook and error handling
  - **Acceptance:** Clear error messages displayed to user

### 5.0 Add comprehensive tests and documentation

- [ ] **5.1 Create unit tests for storage abstraction**
  - Create `server/tests/objectStorage.spec.ts`
  - Mock `fs/promises` functions
  - Test `saveLocalFile()`: creates directories, writes files, handles errors
  - Test `getLocalObjectFile()`: validates paths, checks existence, throws ObjectNotFoundError
  - Test `downloadLocalObject()`: sets headers, streams file, handles errors
  - Test environment detection logic
  - **Acceptance:** 100% coverage of new storage methods, all tests pass

- [ ] **5.2 Update integration tests for dual-backend**
  - In `server/tests/routes.spec.ts`, add tests for POST /api/items with file upload
  - Mock `ObjectStorageService` to test both local and GCS paths
  - Test file validation (valid/invalid types, size limits)
  - Test error responses (400, 413, 500 with proper `{error, code}`)
  - **Acceptance:** Upload flow tested for both backends, validation tested

- [ ] **5.3 Update frontend unit tests**
  - In `client/src/__tests__/home.spec.tsx`, update tests for new file input
  - Remove Uppy-specific test mocks
  - Test file selection handler, validation, FormData creation
  - Test error toast display for invalid files
  - **Acceptance:** Frontend upload logic fully tested, no Uppy dependencies

- [ ] **5.4 Verify E2E test determinism**
  - Run `pnpm e2e` to ensure existing tests still pass
  - Verify E2E tests use mocked `/api/items` responses (not real uploads)
  - Ensure new storage logic doesn't affect test data or fixtures
  - Add `process.env.NODE_ENV !== 'test'` guards if needed
  - **Acceptance:** All E2E tests pass, deterministic behavior maintained

- [ ] **5.5 Update documentation**
  - Add `uploads/` to `.gitignore` (already done in earlier work)
  - Update `CONTEXT.md` Section 11 to document `LOCAL_STORAGE_DIR` env var
  - Update `.env.example` with `LOCAL_STORAGE_DIR=./uploads` (optional, with comment)
  - Add comment in `server/objectStorage.ts` explaining dual-backend strategy
  - **Acceptance:** Documentation clear, env vars documented, comments helpful

- [ ] **5.6 Manual testing checklist**
  - Local dev: Upload image → verify saved to `uploads/items/` → restart server → verify persists
  - Local dev: Try invalid file type → verify 400 error with clear message
  - Local dev: Try >10MB file → verify 413 error
  - Verify existing Replit deployment not affected (GCS path unchanged)
  - **Acceptance:** All manual tests pass, both environments work

---

## Task Completion Tracking

**Status:** Ready for implementation
**Next Step:** Begin with Task 1.1 (environment detection)
**Estimated Total:** ~15-20 sub-tasks, ~4-6 hours implementation + testing
