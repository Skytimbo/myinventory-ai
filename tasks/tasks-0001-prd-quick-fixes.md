# Task List: PRD 0001 - Week 1 Technical Debt Fixes

> **⚠️ DEPRECATED**
>
> This file has been superseded by `tasks/0001-prd-quick-fixes.md` at commit `60d8ef62c510e7f64fbb719adf393bcb2f44a7f4`.
>
> **Do not update this file.** All future changes should be made to the canonical PRD file.

**Source PRD:** `tasks/0001-prd-quick-fixes.md`
**Created:** 2025-11-09
**Status:** Sub-tasks expanded, ready for implementation

---

## Relevant Files

### Backend
- `server/errors.ts` — NEW: ApiError class and wrap() async handler helper
- `server/index.ts` — Update error middleware (lines 53-59)
- `server/routes.ts` — Wrap all async handlers with wrap()
- `server/tests/errors.spec.ts` — NEW: Supertest API error tests

### Frontend
- `client/src/components/ObjectUploader.tsx` — Fix Uppy memory leak (lines 32-48)
- `client/src/components/SearchFilter.tsx` — Add debouncing (lines 59-60)
- `client/src/components/ItemCard.tsx` — Image fallback with retry (lines 42-48)
- `client/src/lib/api.ts` — NEW: Centralized error parser
- `client/src/__tests__/debounce.spec.ts` — NEW: Debounce unit tests
- `client/src/__tests__/ObjectUploader.spec.ts` — NEW: Memory leak test

### E2E
- `e2e/image-fallback.spec.ts` — NEW: Playwright image retry test

### Notes
- Use Vitest for unit/integration tests
- Use Supertest for API tests
- Use Playwright for e2e tests
- Keep tests deterministic with seeded data
- All tests must pass in CI before merge

---

## Tasks

---

### 1.0 Backend: Standardize Error Handling

- [ ] **1.1 Create `server/errors.ts` with ApiError class and wrap() helper**
  - Create new file `server/errors.ts`
  - Add ApiError class with `status`, `code`, and `message` properties
  - Add JSDoc comment explaining ALL async routes MUST use wrap()
  - Export wrap() helper function: `(handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)`
  - Add TypeScript types for proper inference

- [ ] **1.2 Update error middleware in `server/index.ts`**
  - Import ApiError and check `NODE_ENV` for production mode
  - Handle ApiError instances: return `{error: message, code: code}`
  - Handle Zod validation errors: return `{error: 'Invalid request', code: 'VALIDATION_ERROR', details: err.issues}` (hide details in prod)
  - Handle OpenAI errors: check `err?.name?.includes('OpenAI')`, return `{error: 'Upstream AI error', code: 'UPSTREAM_AI'}`
  - Handle unhandled errors: return `{error: message, code: 'UNHANDLED'}` (hide message in prod)
  - Add console.error for all unhandled errors

- [ ] **1.3 Wrap all async route handlers in `server/routes.ts`**
  - Import `wrap` from `./errors`
  - Wrap GET `/api/items` handler
  - Wrap GET `/api/items/:id` handler
  - Wrap POST `/api/items` handler
  - Wrap DELETE `/api/items/:id` handler
  - Wrap POST `/api/objects/upload` handler
  - Replace all `res.status(4xx).json({error: "..."})` with `throw new ApiError(status, code, message)`

- [ ] **1.4 Create frontend error parser in `client/src/lib/api.ts`**
  - Create new file if it doesn't exist
  - Export `parseError` function: `async (response: Response): Promise<string>`
  - Try to parse JSON, return `json.error ?? json.message ?? 'Unknown error'`
  - Handle JSON parse failures gracefully
  - Add JSDoc comment explaining transition period (support {message} until PRD 0002)

- [ ] **1.5 Add Supertest API error tests in `server/tests/errors.spec.ts`**
  - Create new test file
  - Test 404 error: request non-existent item, assert `{error: string, code: 'NOT_FOUND'}`
  - Test validation error: send invalid data, assert `{error: string, code: 'VALIDATION_ERROR'}` (check details only in dev)
  - Test unhandled error: mock database throw, assert `{error: string, code: 'UNHANDLED'}`
  - Test upstream AI error: stub route that throws `{ name: 'OpenAIError', status: 502, message: '...' }` OR check `err.response?.status`, assert `{error: 'Upstream AI error', code: 'UPSTREAM_AI'}`
  - Test wrap() catches async errors: create test route that throws, assert proper error response
  - Run tests with `pnpm --filter server test`

---

### 2.0 Frontend: Fix Uppy Memory Leak

- [ ] **2.1 Refactor `client/src/components/ObjectUploader.tsx` to use useRef**
  - Import `useRef` from React
  - Replace `const [uppy] = useState(...)` with `const uppyRef = useRef<Uppy | null>(null)`
  - Move Uppy initialization into `useEffect` with empty dependency array
  - Assign instance to `uppyRef.current = uppy`
  - Update all references from `uppy` to `uppyRef.current`

- [ ] **2.2 Add explicit cleanup in useEffect return**
  - In useEffect return function, check `if (!uppyRef.current) return`
  - If you registered explicit handlers (upload-success, error), remove them with `.off(eventName, handler)`
  - Loop through plugins: `for (const plugin of uppyRef.current.getPlugins()) { uppyRef.current.removePlugin(plugin); }`
  - Call `uppyRef.current.close({ reason: 'unmount' })`
  - Set `uppyRef.current = null`

- [ ] **2.3 Write automated memory test in `client/src/__tests__/ObjectUploader.spec.ts`**
  - Create new test file
  - Import `render, cleanup` from @testing-library/react
  - Test: "should not leak event handlers on mount/unmount"
  - Mount and unmount ObjectUploader 20 times in a loop
  - Track handler invocations: trigger mock upload after each mount
  - Assert handler called exactly once per mount (not accumulating)
  - Run with `pnpm --filter client test`

- [ ] **2.4 Manual heap snapshot verification (supplemental)**
  - Open app in Chrome DevTools
  - Take heap snapshot before uploading
  - Upload 50 items
  - Force garbage collection
  - Take second heap snapshot
  - Compare: verify no Uppy instances or handlers retained
  - Document findings in PR description

---

### 3.0 Frontend: Add Search Debouncing

- [ ] **3.1 Add debounce to `client/src/components/SearchFilter.tsx`**
  - Import `useMemo, useEffect, useState` from React
  - Import `debounce` from lodash-es
  - Add local state: `const [inputValue, setInputValue] = useState('')`
  - Create debounced function: `useMemo(() => debounce((value: string) => onSearchChange(value), 300, {leading: false, trailing: true}), [onSearchChange])`
  - Store in ref or variable: `const debouncedSearch = ...`

- [ ] **3.2 Add lifecycle cleanup for debounce**
  - Add useEffect: `useEffect(() => { return () => debouncedSearch.cancel(); }, [debouncedSearch])`
  - This ensures pending debounced calls are canceled on unmount

- [ ] **3.3 Update Input onChange handler**
  - Change `onChange={(e) => onSearchChange(e.target.value)}`
  - To: `onChange={(e) => { setInputValue(e.target.value); debouncedSearch(e.target.value); }}`
  - Add `value={inputValue}` prop to Input for controlled input

- [ ] **3.4 Add optional "Searching..." indicator**
  - Compare `inputValue !== currentSearchQuery` (get from parent or context)
  - Render: `{inputValue !== currentSearchQuery && <span className="text-xs text-gray-500 animate-pulse">Searching...</span>}`
  - Place near search input or results count

- [ ] **3.5 Write unit tests in `client/src/__tests__/debounce.spec.ts`**
  - Create new test file
  - Use `vi.useFakeTimers()` from Vitest
  - Test: "should debounce search to 1 invocation per 300ms"
    - Render SearchFilter with mock onSearchChange
    - Type "table" rapidly (5 keystrokes in 100ms)
    - Advance timers by 300ms
    - Assert onSearchChange called exactly once with "table"
  - Test: "should cancel pending search on unmount"
    - Render component, type value, unmount before 300ms
    - Advance timers
    - Assert onSearchChange NOT called
  - Run with `pnpm --filter client test`

- [ ] **3.6 Add telemetry (dev-only)**
  - Wrap telemetry code in `if (process.env.NODE_ENV !== 'production') { ... }`
  - Track `searchInvocations` (every keystroke) and `effectiveSearches` (after debounce)
  - Log ratio with `console.debug`: should be ≤ typingDuration / 300ms
  - This is for metric verification, not production monitoring

---

### 4.0 Frontend: Add Image Loading Fallbacks

- [ ] **4.1 Add state to `client/src/components/ItemCard.tsx`**
  - Import `useState` from React
  - Add state: `const [imageError, setImageError] = useState(false)`
  - Add state: `const [imageLoading, setImageLoading] = useState(true)`
  - Add state: `const [imageRevision, setImageRevision] = useState(0)`

- [ ] **4.2 Conditionally render img only when not in error state**
  - Wrap `<img>` in: `{!imageError && ( ... )}`
  - Update src to: `src={\`${item.imageUrl}?rev=${imageRevision}\`}`
  - Add `loading="lazy"` attribute
  - Add `alt={item.name || 'Item image'}`
  - Add `onLoad={() => setImageLoading(false)}`
  - Add `onError={() => { setImageError(true); setImageLoading(false); }}`
  - Add className: `clsx('h-48 w-full object-cover', imageLoading && 'opacity-50')`

- [ ] **4.3 Add accessible placeholder UI for error state**
  - Add: `{imageError && ( <div role="img" aria-label={\`No image available for ${item.name}\`} className="flex h-48 flex-col items-center justify-center bg-gray-100"> ... </div> )}`
  - Inside div: `<ImageIcon aria-hidden className="h-12 w-12 text-gray-400" />`
  - Add: `<p className="sr-only">Image failed to load</p>`
  - Add: `<p className="mt-2 text-sm text-gray-600">{item.name}</p>`
  - Add retry button: `<button className="mt-2 text-sm underline hover:text-gray-900" onClick={() => { setImageError(false); setImageLoading(true); setImageRevision(r => r + 1); }}>Retry loading image</button>`

- [ ] **4.4 Add loading skeleton**
  - Add: `{imageLoading && !imageError && ( <div className="h-48 animate-pulse bg-gray-200" /> )}`
  - Place before the img and error placeholder

- [ ] **4.5 Write Playwright e2e test in `e2e/image-fallback.spec.ts`**
  - Create new test file
  - Test: "should show placeholder and retry image on failure"
  - Navigate to home page with test item
  - Intercept first image request: `page.route('**/objects/items/**', route => route.fulfill({ status: 500 }))` (more stable than abort)
  - Assert placeholder visible with item name
  - Assert retry button present
  - Click retry button
  - Wait for retried request: `await page.waitForResponse(resp => resp.url().includes('?rev=') && resp.status() === 200)`
  - Allow retry request: `page.route('**/objects/items/**', route => route.continue())`
  - Assert image renders successfully
  - Calculate retry success rate (should be ≥90%)
  - Run with `pnpm e2e`

- [ ] **4.6 Run axe-core accessibility checks**
  - In same e2e test, import `injectAxe, checkA11y` from @axe-core/playwright
  - Inject axe: `await injectAxe(page)`
  - Check accessibility on placeholder state: `await checkA11y(page)`
  - Verify no violations for role="img", aria-label, keyboard access
  - Assert retry button is keyboard-accessible (focus + Enter)

---

### 5.0 CI & Testing Infrastructure

- [ ] **5.1 Create/update CI configuration file**
  - Create `.github/workflows/ci.yml` or update existing
  - Add job: `test-server` with steps:
    - Checkout code
    - Setup Node.js
    - Install dependencies: `pnpm install`
    - Set env: `DATABASE_URL_TEST`, `NODE_ENV=test`
    - Run: `pnpm db:reset && pnpm db:seed`
    - Run: `pnpm --filter server test`
  - Add job: `test-client` with steps:
    - Run: `pnpm --filter client test`
  - Add job: `test-e2e` with steps:
    - Run: `pnpm e2e`

- [ ] **5.2 Add telemetry verification (dev-only)**
  - In test runs, collect telemetry logs
  - Assert search ratio: effectiveSearches / searchInvocations ≤ expected
  - Assert image retry success rate ≥ 90%
  - Log results to CI output
  - Mark as required check for PR merge

- [ ] **5.3 Set up test database seeding scripts**
  - Create `scripts/db-reset.ts` (if not exists): drops and recreates test DB
  - Create `scripts/db-seed.ts` (if not exists): inserts deterministic test data
  - Add pnpm scripts: `"db:reset": "tsx scripts/db-reset.ts"`, `"db:seed": "tsx scripts/db-seed.ts"`
  - Ensure seed data includes items for image fallback testing

- [ ] **5.4 Verify all 4 quantitative success metrics**
  - Run full test suite locally: `pnpm --filter server test && pnpm --filter client test && pnpm e2e`
  - Check memory test: no handler accumulation (automated)
  - Check search performance: ≤1 invocation per 300ms (telemetry)
  - Check error format: 100% use {error, code?} (Supertest assertions)
  - Check image retry: ≥90% success rate (Playwright assertion)
  - Document metrics in PR description

- [ ] **5.5 Update CHANGELOG.md and create PR**
  - Add entry under "Unreleased" section:
    ```
    ### Fixed
    - Memory leak in ObjectUploader component (Uppy cleanup)
    - Search performance with debouncing (300ms delay)
    - Image loading fallbacks with retry and accessibility

    ### Changed
    - Standardized API error responses to {error, code?} format
    - All async route handlers now use wrap() helper
    ```
  - Commit changes with semantic messages:
    - `feat: add error handling standardization (#1.0)`
    - `fix: resolve Uppy memory leak (#2.0)`
    - `perf: add search debouncing (#3.0)`
    - `feat: add image loading fallbacks (#4.0)`
    - `ci: add comprehensive test pipeline (#5.0)`
  - Create PR with title: "Week 1 Technical Debt Fixes (PRD 0001)"
  - Add PR description with metrics snapshot
  - Link to PRD: `tasks/0001-prd-quick-fixes.md`
  - Request review

---

## Definition of Done

All checkboxes above must be completed AND:

- [ ] All tests pass locally (`pnpm --filter server test && pnpm --filter client test && pnpm e2e`)
- [ ] CI pipeline is green (all jobs pass)
- [ ] Memory metric verified: automated test + heap snapshot show no growth
- [ ] Search metric verified: telemetry shows ≤1 invocation per 300ms
- [ ] Error metric verified: 100% of API tests return {error, code?} format
- [ ] Image metric verified: Playwright test shows ≥90% retry success rate
- [ ] Code reviewed and approved
- [ ] CHANGELOG.md updated
- [ ] PR merged to main

---

## Notes for Implementation

- **Estimated Time:** 4-6 hours total (1-2h backend, 1-2h search, 2-3h memory+images, 1h CI)
- **Order:** Can work in parallel - backend and frontend are independent
- **Testing:** Run tests frequently during development, not just at the end
- **Commits:** Make incremental commits per sub-task for easy rollback
- **Questions:** Refer back to PRD sections for detailed specifications