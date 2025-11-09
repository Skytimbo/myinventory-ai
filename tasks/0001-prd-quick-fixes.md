# PRD: Week 1 Technical Debt Fixes

**PRD Number:** 0001
**Feature Name:** Quick Fixes - Technical Debt Resolution
**Created:** 2025-11-09
**Status:** Approved
**Priority:** High (Foundation for future work)

---

## 1. Overview

This PRD addresses four critical technical debt items identified during codebase analysis. These are low-effort, high-impact fixes that improve application stability, performance, and user experience. Completing these fixes provides a solid foundation for subsequent feature development.

**The Four Fixes:**
1. Fix Uppy memory leak in ObjectUploader component
2. Add search input debouncing for performance
3. Standardize error handling across all API endpoints
4. Add image loading fallbacks for broken/missing images

**Estimated Effort:** 4-6 hours total
**Risk Level:** Low (isolated changes, no breaking API changes)

---

## 2. Goals

### Primary Goals
1. **Eliminate memory leak** in file upload component to prevent browser performance degradation
2. **Improve search performance** by reducing unnecessary re-renders and computations
3. **Standardize error responses** so frontend can handle errors consistently
4. **Improve UX for failed images** with clear feedback and fallback UI

### Success Metrics
- **Memory:** No growth after 20+ file uploads (automated test + heap snapshot)
- **Search Performance:** CI must assert ≤1 effective search invocation per 300ms typing window
- **Error Consistency:** 100% of errors use `{error: string, code?: string}` format
- **Image Fallback:** <1s to show placeholder on failure, ≥90% retry success rate in e2e tests
- **CI Gate:** All tests must pass (unit, integration, e2e) before merge

---

## 3. User Stories

### US-1: Memory Stability
**As a** power user uploading many items
**I want** the app to remain responsive
**So that** I don't experience browser slowdowns or crashes

**Acceptance Criteria:**
- Uploading 50+ items in a session doesn't degrade performance
- Memory usage stays flat (no continuous growth)
- No console warnings about memory leaks

---

### US-2: Responsive Search
**As a** user searching through my inventory
**I want** instant visual feedback without lag
**So that** I can quickly find items

**Acceptance Criteria:**
- Typing in search feels smooth (no stuttering)
- Results update within 300ms of stopping typing
- No unnecessary re-filtering on every keystroke

---

### US-3: Clear Error Messages
**As a** user encountering an error
**I want** consistent, understandable error messages
**So that** I know what went wrong and how to fix it

**Acceptance Criteria:**
- All errors display in the same format
- Error messages are user-friendly (not stack traces)
- Console logs technical details for debugging

---

### US-4: Graceful Image Failures
**As a** user viewing my inventory
**I want** to see placeholder images when loading fails
**So that** I can still identify and interact with items

**Acceptance Criteria:**
- Broken images show a placeholder with item name
- Loading state is visible before image appears
- Option to retry loading with cache-busting
- Proper alt text and keyboard accessibility for all image states

---

## 4. Functional Requirements

### FR-1: Fix Uppy Memory Leak

**Problem:** ObjectUploader component creates Uppy instance in useState but never cleans it up on unmount. Simply calling `uppy.close()` may not detach all event listeners if plugins were added, and re-creating Uppy on prop changes can leave stale instances.

**Location:** `/client/src/components/ObjectUploader.tsx:32-48`

**Current Code:**
```typescript
const [uppy] = useState(() => new Uppy(...));
// No cleanup, event listeners accumulate
```

**Required Fix (Strict Cleanup):**
```typescript
// ObjectUploader.tsx
const uppyRef = useRef<Uppy | null>(null);

useEffect(() => {
  const uppy = new Uppy({ /* opts */ });
  uppyRef.current = uppy;

  // ... plugin setup, event subscriptions ...
  // If you register handlers, track them for cleanup:
  // uppy.on('upload-success', handleUploadSuccess);
  // uppy.on('error', handleError);

  return () => {
    const u = uppyRef.current;
    if (!u) return; // Guard against double-close

    // If you registered handlers explicitly, remove them:
    // u.off('upload-success', handleUploadSuccess);
    // u.off('error', handleError);

    // Detach plugins first
    for (const plugin of u.getPlugins()) {
      u.removePlugin(plugin);
    }

    // Close the instance (unbinds remaining events)
    u.close({ reason: 'unmount' });

    // Null out the ref
    uppyRef.current = null;
  };
}, []); // Never re-initialize
```

**Key Changes:**
1. Use `useRef` instead of `useState` to track instance
2. Explicitly remove registered event handlers (no wildcard `off('*')` which is unsupported)
3. Detach all plugins before closing
4. `close()` unbinds remaining events automatically
5. Guard against double-close with null check
6. Empty dependency array ensures single initialization

**Testing:**
- **Automated:** Mount/unmount component 20× with React Testing Library, verify no duplicate handler invocations:
  1. Mount → trigger upload → count handler calls
  2. Unmount → mount → trigger upload → assert count == 1 (not 2)
- **Manual (supplemental):** Heap snapshots before/after 50 uploads to verify no retention

---

### FR-2: Add Search Debouncing

**Problem:** Search filter runs on every keystroke, causing unnecessary re-renders with large datasets. Debounced callback must be canceled on unmount to avoid late updates, and controlled input value must stay consistent while debounced callback updates results later.

**Location:** `/client/src/components/SearchFilter.tsx:59-60`

**Current Behavior:**
- `onChange` fires immediately on keystroke
- Parent component re-filters entire array
- Performance degrades with 100+ items

**Required Implementation (Lifecycle-Safe):**
```typescript
import { useMemo, useEffect, useState } from 'react';
import { debounce } from 'lodash-es';

const [inputValue, setInputValue] = useState('');

// Memoize debounced function with stable callback identity
const debouncedSearch = useMemo(
  () => debounce((value: string) => onSearchChange(value), 300, {
    leading: false,  // No early feedback
    trailing: true   // Execute after pause
  }),
  [onSearchChange]
);

// Cancel on unmount to prevent late updates
useEffect(() => {
  return () => debouncedSearch.cancel();
}, [debouncedSearch]);

// In JSX - update local state immediately, debounce parent update
<Input
  value={inputValue}
  onChange={(e) => {
    setInputValue(e.target.value);
    debouncedSearch(e.target.value);
  }}
/>

{/* Optional: Show "Searching..." indicator during debounce */}
{inputValue !== currentSearchQuery && (
  <span className="text-sm text-gray-500">Searching...</span>
)}
```

**Debounce Configuration:**
- Delay: 300ms (industry standard)
- Leading: false (no immediate execution)
- Trailing: true (execute after pause)

**Testing:**
- **Unit test:** Use fake timers, type "table" rapidly (5 keystrokes in 100ms), assert only 1 invocation at 300ms
- **Cancel test:** Unmount component with pending debounced work, advance fake timers, assert `onSearchChange` NOT called (verify cleanup works)
- **Performance test:** Log filter invocations, assert ≤ ceil(typingDuration / 300ms)
- **UX test:** Verify "Searching..." indicator appears during debounce window

---

### FR-3: Standardize Error Handling

**Problem:** API endpoints return mixed error formats: `{error: "..."}` vs `{message: "..."}`. Throwing inside async handlers without a wrapper can skip the error middleware. Zod and OpenAI errors produce non-uniform shapes.

**Locations:**
- `/server/routes.ts` (lines 21, 30, 95, 109, 120)
- `/server/index.ts:57` (error handler expects `message`)

**Standard Format:** `{error: string, code?: string}` with optional code for client logic

**Implementation Steps:**

1. Create unified error utilities in `/server/errors.ts`:
   ```typescript
   export class ApiError extends Error {
     constructor(
       public status: number,
       public code: string,
       message: string
     ) {
       super(message);
       this.name = 'ApiError';
     }
   }

   /**
    * Async route wrapper - catches unhandled promise rejections
    * IMPORTANT: ALL async route handlers MUST use this wrapper
    * to ensure errors are properly caught by the error middleware.
    *
    * Usage: app.get('/path', wrap(async (req, res) => { ... }))
    */
   export const wrap = (handler: any) =>
     (req: Request, res: Response, next: NextFunction) =>
       Promise.resolve(handler(req, res, next)).catch(next);
   ```

2. Update error handler in `/server/index.ts:53-59` with Zod support and production safety:
   ```typescript
   const isProd = process.env.NODE_ENV === 'production';

   app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
     // Handle ApiError
     if (err instanceof ApiError) {
       return res.status(err.status).json({
         error: err.message,
         code: err.code
       });
     }

     // Handle Zod validation errors (hide details in production)
     if (err?.issues?.length) {
       return res.status(400).json({
         error: 'Invalid request',
         code: 'VALIDATION_ERROR',
         ...(isProd ? {} : { details: err.issues }) // Dev-only details
       });
     }

     // Handle OpenAI/upstream SDK errors (normalize messages)
     if (err?.status && err?.message && err?.name?.includes('OpenAI')) {
       return res.status(err.status).json({
         error: 'Upstream AI error',
         code: 'UPSTREAM_AI'
       });
     }

     // Unhandled errors
     console.error('Unhandled error:', err);
     res.status(err.status || 500).json({
       error: isProd ? 'Internal Server Error' : err.message || 'Internal Server Error',
       code: 'UNHANDLED'
     });
   });
   ```

3. Wrap all async route handlers:
   ```typescript
   // Before:
   app.get("/api/items/:id", async (req, res) => { ... });

   // After:
   app.get("/api/items/:id", wrap(async (req, res) => {
     const item = await storage.getItem(req.params.id);
     if (!item) throw new ApiError(404, 'NOT_FOUND', 'Item not found');
     res.json(item);
   }));
   ```

4. Create centralized error parser in `/client/src/lib/api.ts`:
   ```typescript
   // Supports both formats during transition period
   export const parseError = async (response: Response): Promise<string> => {
     try {
       const json = await response.json();
       return json.error ?? json.message ?? 'Unknown error';
     } catch {
       return 'Unknown error';
     }
   };
   ```

**Transition Strategy:**
- Ship error format change behind feature flag (optional for v1)
- Frontend adapter accepts both `{error}` and `{message}` for one release
- Remove `{message}` support in next release

**Testing:**
- **API tests (Supertest):**
  - 404 error returns `{error: "Item not found", code: "NOT_FOUND"}`
  - Validation error returns `{error: "Invalid request", code: "VALIDATION_ERROR", details: [...]}`
  - Unhandled error returns `{error: "...", code: "UNHANDLED"}`
- **Negative test:** Force upstream error (e.g., database throws) to hit UNHANDLED path

---

### FR-4: Add Image Loading Fallbacks

**Problem:** When images fail to load, ItemCard shows blank space with no user feedback. Browser caches failed images, causing retries to hit cache. Missing proper alt text reduces accessibility.

**Location:** `/client/src/components/ItemCard.tsx:42-48`

**Current Code:**
```typescript
<img src={item.imageUrl} alt={item.name} />
```

**Required Implementation (Resilient with Cache-Busting):**

1. Add state for image loading with revision counter:
   ```typescript
   const [imageError, setImageError] = useState(false);
   const [imageLoading, setImageLoading] = useState(true);
   const [imageRevision, setImageRevision] = useState(0);
   ```

2. Add handlers and fallback UI with accessibility:
   ```typescript
   {/* Only render <img> when not in error state */}
   {!imageError && (
     <img
       src={`${item.imageUrl}?rev=${imageRevision}`}
       alt={item.name || 'Item image'}
       loading="lazy"  // Native lazy loading
       onLoad={() => setImageLoading(false)}
       onError={() => {
         setImageError(true);
         setImageLoading(false);
       }}
       className={clsx(
         'h-48 w-full object-cover',
         imageLoading && 'opacity-50'
       )}
     />
   )}

   {imageError && (
     <div
       role="img"
       aria-label={`No image available for ${item.name}`}
       className="flex h-48 flex-col items-center justify-center bg-gray-100"
     >
       <ImageIcon aria-hidden className="h-12 w-12 text-gray-400" />
       <p className="sr-only">Image failed to load</p>
       <p className="mt-2 text-sm text-gray-600">{item.name}</p>
       <button
         className="mt-2 text-sm underline hover:text-gray-900"
         onClick={() => {
           setImageError(false);
           setImageLoading(true);
           setImageRevision(r => r + 1); // Cache-busting
         }}
       >
         Retry loading image
       </button>
     </div>
   )}
   ```

3. Add loading skeleton:
   ```typescript
   {imageLoading && !imageError && (
     <div className="h-48 animate-pulse bg-gray-200" />
   )}
   ```

**Key Features:**
- **Cache-busting:** `?rev=${imageRevision}` query param forces fresh fetch on retry
- **No repeated errors:** `<img>` not rendered when `imageError === true` (prevents error loops and layout jank)
- **Lazy loading:** `loading="lazy"` defers off-screen images
- **Accessibility:**
  - `role="img"` and `aria-label` for placeholder
  - `sr-only` text for screen readers
  - `aria-hidden` on decorative icon
  - Keyboard-accessible retry button
- **Graceful degradation:** Fallback alt text if item.name is missing

**Fallback Strategy:**
- Show loading skeleton initially
- On error: accessible placeholder with item name + retry button
- On retry: increment revision counter to bypass cache

**Testing:**
- **E2E (Playwright):**
  - Intercept image request → return 500 status
  - Assert placeholder renders with item name
  - Click "Retry" button
  - Allow 200 response on retry
  - Assert image renders successfully
  - Verify ≥90% retry success rate
- **Accessibility (Axe):** Run axe-core checks on placeholder state, verify proper labels and focus order

---

## 5. Non-Goals

**Out of Scope for This PRD:**
- Full component audit for other memory leaks (only Uppy)
- Advanced error logging service integration (Sentry, etc.)
- Toast notification system (console errors only)
- Retry logic for AI/API failures (manual only)
- Image optimization or thumbnail generation
- Barcode re-generation fix (separate PR)

---

## 6. Design Considerations

### UI/UX Changes
- **Minimal visual changes** - mostly internal fixes
- Image fallback adds new UI state (placeholder)
- No changes to existing workflows or navigation

### Accessibility
- Placeholder should have proper alt text
- Loading states should announce to screen readers
- Error messages should be keyboard accessible

### Performance Impact
- **Positive:** Search debouncing reduces CPU usage
- **Positive:** Uppy cleanup prevents memory bloat
- **Neutral:** Error handling has no perf impact
- **Minimal:** Image fallback adds trivial overhead

---

## 7. Technical Considerations

### Dependencies
- **lodash-es** (already in package.json) for debounce
- **lucide-react** (already in package.json) for ImageIcon
- No new dependencies required

### Browser Compatibility
- All fixes use standard React patterns (React 18+)
- Debounce works in all modern browsers
- Image onError/onLoad supported universally

### Database Changes
- None required

### API Changes
- Error response format standardized to `{error: string, code?: string}`
- All endpoints return this format on failure
- **Transition:** Client adapter accepts `{message}` until PRD 0002, then remove support
- Validation details hidden in production (dev-only)
- OpenAI/upstream errors normalized to avoid leaking implementation details

### Testing Strategy

**Unit Tests (Vitest):**
- Debounce function with fake timers (assert 1 invocation per 300ms)
- Error handler with ApiError, Zod errors, unhandled errors
- Uppy cleanup (spy on addEventListener/removeEventListener counts)

**Integration Tests (Supertest):**
- API error responses: 404, 400 validation, 500 unhandled
- Verify `{error: string, code?: string}` format on all paths
- Test wrap() async handler catches errors correctly

**E2E Tests (Playwright):**
- Image failure → retry flow with cache-busting
- Search debouncing with rapid typing
- Error message display consistency

**Automated Memory Test:**
- Mount/unmount ObjectUploader 20× with RTL
- Assert no increase in active event listeners (track via spy)

**Manual Testing (Supplemental):**
- Heap snapshots before/after 50 uploads (DevTools Memory profiler)
- Visual QA of image placeholder and retry UX

**Accessibility Testing:**
- Run axe-core on image placeholder state
- Verify keyboard navigation and screen reader announcements

**CI Gating:**
- All tests must pass before merge
- Telemetry assertions: ≤1 search per 300ms, ≥90% image retry success

### Rollback Plan
- Each fix is isolated (can rollback individually)
- No database migrations to reverse
- Error handling change is backward compatible

---

## 8. Success Metrics

### Quantitative
- **Memory:** No growth after 20 uploads (DevTools heap snapshot)
- **Search Performance:** Max 1 filter operation per 300ms
- **Error Consistency:** 100% of errors use `{error: string}` format
- **Image Fallback:** <1s to show placeholder on failure

### Qualitative
- Developers can easily add new error handling
- Users report smoother search experience
- No more blank cards for broken images

### Monitoring
- Browser console warnings for memory leaks
- Error response format logged in API tests
- User feedback on search responsiveness

---

## 9. Implementation Plan

### Phase 1: Backend (1-2 hours)
1. Create `server/errors.ts` with ApiError class and wrap() helper
2. Update error handler in `server/index.ts` with Zod support
3. Wrap all async route handlers with wrap()
4. Update all routes to throw ApiError with status and code
5. Add Supertest API tests for all error types
6. Create `/client/src/lib/api.ts` with parseError() utility

### Phase 2: Frontend - Search (1-2 hours)
1. Add debounce to SearchFilter with lifecycle cleanup
2. Add local state for input value
3. Add "Searching..." indicator during debounce
4. Write unit test with fake timers
5. Test with large dataset (100+ items), log invocation count
6. Add telemetry for search metrics

### Phase 3: Frontend - Memory & Images (2-3 hours)
1. Fix Uppy cleanup in ObjectUploader with strict pattern (useRef, plugin removal, off('*'))
2. Write automated mount/unmount test (20 cycles)
3. Add image fallback to ItemCard with cache-busting and accessibility
4. Add loading skeleton and error state
5. Write Playwright e2e test for image retry flow
6. Run axe-core accessibility checks
7. Manual heap snapshot verification (supplemental)

### Phase 4: Cross-Cutting & CI (1 hour)
1. Add pino logger with request IDs (optional for v1)
2. Add telemetry counters for search and image metrics (dev-only, wrap with `NODE_ENV !== 'production'`)
3. Configure CI pipeline with exact commands:
   - `pnpm --filter server test` (set `DATABASE_URL_TEST` env)
   - `pnpm --filter client test`
   - `pnpm db:reset && pnpm db:seed` (test data setup)
   - `pnpm e2e` (Playwright)
4. Add CI gate: tests must pass before merge
5. Document "Definition of Done" requirements

### Phase 5: Documentation & Commit (30 min)
1. Run full test suite locally
2. Verify all 4 quantitative metrics in logs
3. Update CHANGELOG.md with changes
4. Commit with semantic messages per task
5. Create PR with metric snapshot

---

## 10. Cross-Cutting Additions

### CI Gate
- **Requirement:** Run Vitest (server + client), Supertest (API), and Playwright (e2e) on every PR
- **Enforcement:** Tests must pass before merge
- **Coverage:** Maintain or improve current coverage percentage
- **Exact Commands:**
  ```bash
  pnpm --filter server test        # Backend tests
  pnpm --filter client test        # Frontend tests
  pnpm db:reset && pnpm db:seed    # Seed test database
  pnpm e2e                          # Playwright e2e tests
  ```
- **Environment:** Set `DATABASE_URL_TEST` for server tests, `NODE_ENV=test` for all

### Telemetry for Success Metrics
Add lightweight counters to verify quantitative goals (dev-only):

```typescript
// Track search invocations (dev-only)
if (process.env.NODE_ENV !== 'production') {
  let searchInvocations = 0;
  let effectiveSearches = 0;

  const debouncedSearch = debounce((v: string) => {
    effectiveSearches++;
    onSearchChange(v);
  }, 300);

  // On every keystroke
  searchInvocations++;
  debouncedSearch(value);

  // Log ratio: should be ≤ (typingDuration / 300ms)
  console.debug(`Search ratio: ${effectiveSearches}/${searchInvocations}`);
}
```

**Image Metrics (dev-only):**
- Log `imageErrorCount` and `imageRetrySuccessCount`
- Calculate retry success rate: `retrySuccessCount / imageErrorCount`
- Target: ≥90% success rate
- **Important:** Wrap all telemetry with `NODE_ENV !== 'production'` check

### Logging (Optional for v1)
- Add `pino` logger with `x-request-id` in responses
- Log one line per request with latency
- Keep console noise low in development mode

### Frontend Error Adapter
Centralize error parsing in `/client/src/lib/api.ts`:

```typescript
export const parseError = async (response: Response): Promise<string> => {
  try {
    const json = await response.json();
    // Support both formats during transition
    return json.error ?? json.message ?? 'Unknown error';
  } catch {
    return 'Unknown error';
  }
};

// Usage in components:
const handleError = async (res: Response) => {
  const errorMsg = await parseError(res);
  toast.error(errorMsg);
};
```

### UX Enhancement: Search Status
While debounced, show subtle feedback:

```typescript
{inputValue !== currentSearchQuery && (
  <span className="text-xs text-gray-500 animate-pulse">
    Searching...
  </span>
)}
```

---

## 11. Definition of Done

**Code Complete:**
- All four fixes implemented per specifications
- Code reviewed and approved

**Tests Pass:**
- Unit tests: debounce, error handler, Uppy cleanup
- Integration tests: API error responses (Supertest)
- E2E tests: Image retry flow (Playwright)
- Accessibility: axe-core checks pass
- Automated memory test: 20 mount/unmount cycles, no listener growth

**Metrics Verified:**
- Memory: Automated test + heap snapshot show no growth
- Search: Telemetry shows ≤1 invocation per 300ms window
- Errors: 100% use `{error, code?}` format (Supertest assertions)
- Images: ≥90% retry success rate (Playwright)

**Documentation:**
- CHANGELOG.md updated with changes
- Metrics snapshot attached to PR
- Code comments explain non-obvious patterns

**CI:**
- All CI checks green (Vitest, Supertest, Playwright)
- No new warnings or errors
- Coverage maintained or improved

---

## 12. Open Questions & Decisions

### Q1: Should we add toast notifications for errors?
**Decision:** No, out of scope. Use console.error for now. Add in future PR.

### Q2: Should we audit all components for memory leaks?
**Decision:** No, only fix identified Uppy issue. Broader audit in separate PR if needed.

### Q3: What if debounce feels too slow for users?
**Decision:** Start with 300ms. Can reduce to 200ms if feedback warrants.

### Q4: Should image retry be automatic or manual?
**Decision:** Manual (button click) with cache-busting. Automatic retry can mask persistent issues and waste bandwidth.

### Q5: Use lodash debounce or custom implementation?
**Decision:** lodash-es (already a dependency, well-tested, tree-shakeable). Must cancel on unmount.

### Q6: Should error format change ship behind feature flag?
**Decision:** No flag for v1, but frontend adapter supports both `{error}` and `{message}` for one release as transition period, then remove `{message}` support.

### Q7: Add pino logger now or later?
**Decision:** Optional for v1. Can add in separate PR if needed. Keep console.error for now.

---

## 13. Appendix

### References
- Original codebase analysis document
- `/tasks/PROTOCOLS.md` - Development protocols
- React 18 useEffect cleanup patterns
- Uppy.js documentation on cleanup

### Related PRDs
- None yet (this is 0001)

### Changelog
- 2025-11-09: Initial PRD created
- 2025-11-09: Enhanced with stricter cleanup, lifecycle-safe debouncing, production-grade error handling, and resilient image retry with accessibility
- 2025-11-09: Added CI gating, telemetry, automated tests, and Definition of Done
- 2025-11-09: Final corrections - removed unsupported `off('*')`, added cancel test, hide validation details in prod, don't render `<img>` in error state, exact CI commands, dev-only telemetry
- 2025-11-09: Approved for implementation

---

**Next Steps:**
1. Generate task list from this PRD (`tasks-0001-prd-quick-fixes.md`)
2. Implement fixes following task list
3. Test and verify all success metrics
4. Commit with semantic messages