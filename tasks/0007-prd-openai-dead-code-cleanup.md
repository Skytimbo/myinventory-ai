# PRD-0007: OpenAI Dead Code Cleanup & Refactor

## Document Header

| Field | Value |
|-------|-------|
| Status | Draft |
| Created | 2025-11-19 |
| Last Updated | 2025-11-19 |
| Author | Claude Code |
| Type | Technical Debt / Refactor |
| Related PRDs | PRD-0006 (Automatic Value Estimation) |

---

## 1. Overview

### Problem Statement

The codebase contains duplicate and unused OpenAI integration code that creates confusion and maintenance risk:

1. **`analyzeImage()` function** in `server/openai.ts` (lines 33-115) is exported but never called
2. **`imageAnalysis` service interface** in `server/services.ts` defines a legacy pattern that routes.ts bypasses
3. **Dead import** in `createProdServices()` imports `analyzeImage` but never uses it

The authoritative image analysis pipeline now lives in `server/modelPolicy.ts` via `analyzeImagePolicy()`, which was implemented in PRD-0006. The legacy code in `server/openai.ts` predates this implementation and uses the expensive `gpt-5` model (~$0.01+ per image) instead of the cost-efficient tiered approach.

### Solution Summary

Remove all unused OpenAI integration code to establish `analyzeImagePolicy()` as the single source of truth for image analysis. Add dead-code detection tooling to prevent future accumulation of unused exports.

---

## 2. Goals

1. **Single Source of Truth** - Ensure `analyzeImagePolicy()` is the only entry point for AI image analysis
2. **Remove Legacy Code** - Delete unused `analyzeImage()` function and related dead imports
3. **Improve Maintainability** - Eliminate confusion for future contributors
4. **Prevent Regression** - Add ts-prune or similar tool to detect unused exports in CI
5. **Zero Behavior Change** - System must function identically before and after cleanup

---

## 3. Non-Goals

- **No behavior changes** - Analysis results must remain identical
- **No model changes** - Continue using gpt-4o-mini → gpt-4o fallback strategy
- **No prompt changes** - Keep existing prompt engineering in modelPolicy.ts
- **No new features** - This is strictly cleanup, no new valuation or metadata features
- **No architectural redesign** - Keep current direct-import pattern (routes → modelPolicy)

---

## 4. User Stories

### US-1: Developer Clarity
**As a** developer working on AI features,
**I want** a single, clearly-defined image analysis function,
**So that** I don't have to investigate which of multiple functions is the correct one to use.

### US-2: Maintainability
**As a** code maintainer,
**I want** unused code removed from the repository,
**So that** I don't have to maintain or consider dead code paths.

### US-3: Future Prevention
**As a** CI pipeline,
**I want** to detect unused exports automatically,
**So that** dead code doesn't accumulate silently over time.

---

## 5. Functional Requirements

### FR-1: Remove Dead analyzeImage Function
Remove the `analyzeImage()` function from `server/openai.ts` (lines 33-115).

**Acceptance:** Function definition no longer exists in codebase.

### FR-2: Remove Dead Service Container Code
Remove the unused `imageAnalysis` service definition and imports from `server/services.ts`:
- Remove interface definition (lines 143-147)
- Remove dead import in `createProdServices()` (line 162)
- Remove service assignment (lines 173-175)
- Keep `fakeImageAnalysis` if used by tests, otherwise remove

**Acceptance:** `AppServices` interface no longer includes `imageAnalysis`.

### FR-3: Clean Up Exports
Ensure `server/openai.ts` only exports what is actually used:
- `openaiCheap` - Used by modelPolicy.ts
- `openaiPremium` - Used by modelPolicy.ts
- `ImageAnalysisResult` type - Used across codebase

**Acceptance:** All exports from openai.ts are imported elsewhere.

### FR-4: Add Dead Code Detection
Add `ts-prune` or equivalent to the CI pipeline to detect unused exports.

**Acceptance:** `pnpm check` or similar command fails if unused exports exist.

### FR-5: Update Tests
Update any tests that reference removed code paths.

**Acceptance:** All unit and E2E tests pass.

---

## 6. Design Considerations

### Architecture After Cleanup

```
┌─────────────────┐
│   routes.ts     │
│ POST /api/items │
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│   modelPolicy.ts    │
│ analyzeImagePolicy()│
└────────┬────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ cheap  │ │premium │
│gpt-4o- │ │ gpt-4o │
│  mini  │ │        │
└────────┘ └────────┘
         │
         ▼
┌─────────────────┐
│   openai.ts     │
│ Client exports  │
│ only            │
└─────────────────┘
```

### File Changes Summary

| File | Action |
|------|--------|
| `server/openai.ts` | Remove `analyzeImage()` function |
| `server/services.ts` | Remove `imageAnalysis` service interface and implementation |
| `server/modelPolicy.ts` | No changes (already correct) |
| `server/routes.ts` | No changes (already uses correct function) |
| `package.json` | Add ts-prune as dev dependency |

---

## 7. Technical Considerations

### Code to Remove

**server/openai.ts - Remove lines 33-115:**
```typescript
// REMOVE THIS ENTIRE FUNCTION
export async function analyzeImage(imageBase64: string): Promise<ImageAnalysisResult> {
  // ... 80+ lines of dead code using gpt-5
}
```

**server/services.ts - Remove imageAnalysis service:**
```typescript
// REMOVE from AppServices interface
imageAnalysis: {
  analyzeImage(imageBase64: string): Promise<ImageAnalysisResult>;
};

// REMOVE from createProdServices
const { analyzeImage } = await import('./openai');

// REMOVE service assignment
imageAnalysis: {
  analyzeImage,
},
```

### ts-prune Integration

Add to `package.json`:
```json
{
  "devDependencies": {
    "ts-prune": "^0.10.3"
  },
  "scripts": {
    "check:dead-code": "ts-prune --error"
  }
}
```

Run in CI as part of `pnpm check`.

### Backward Compatibility

No concerns - the removed code is never called. The database schema, API contracts, and UI all remain unchanged.

---

## 8. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Unused exports | 0 | ts-prune output |
| Test pass rate | 100% | `pnpm test:server && pnpm e2e` |
| Lines removed | ~100 | git diff stats |
| Analysis behavior | Unchanged | E2E tests verify same results |

---

## 9. Acceptance Criteria

### AC-1: Code Removal Verified
- [ ] `analyzeImage()` function no longer exists in server/openai.ts
- [ ] `imageAnalysis` service no longer exists in server/services.ts
- [ ] No import statements reference removed code

### AC-2: Single Entry Point
- [ ] Only `analyzeImagePolicy()` is called for image analysis
- [ ] `grep -r "analyzeImage(" server/` returns only modelPolicy.ts references

### AC-3: Tests Pass
- [ ] All 34+ unit tests pass
- [ ] All 16+ E2E tests pass
- [ ] No regressions in value estimation

### AC-4: Dead Code Detection
- [ ] ts-prune is installed and configured
- [ ] `pnpm check:dead-code` returns 0 unused exports in OpenAI-related files
- [ ] CI pipeline includes dead-code check

### AC-5: System Behavior Unchanged
- [ ] Uploaded images receive estimated values
- [ ] Confidence levels (low/medium/high) work correctly
- [ ] Dashboard totals aggregate correctly

---

## 10. Test Plan

### Unit Tests
- Verify `value-estimation.spec.ts` tests still pass
- Remove or update any tests that reference `analyzeImage()` directly

### E2E Tests
- Run full `pnpm e2e` suite
- Verify `value-estimation.spec.ts` E2E tests pass
- Confirm image fallback tests still work

### Manual Smoke Test
1. Start dev server: `pnpm dev:mobile`
2. Upload an image via UI
3. Verify item appears with estimated value
4. Check dashboard shows correct totals

### ts-prune Verification
```bash
# After cleanup, this should return no results
npx ts-prune | grep -E "(openai|modelPolicy)"
```

---

## 11. Decisions on Open Questions

### Q1: Should we keep fakeImageAnalysis for tests?

**Decision:** Remove it unless tests explicitly use it.

**Rationale:** Current tests mock `openaiCheap.chat.completions.create` directly in `value-estimation.spec.ts`. The `fakeImageAnalysis` object is part of the unused service container pattern.

### Q2: Should we remove ImageAnalysisResult type?

**Decision:** Keep it - it's used in services.ts mock and could be useful.

**Rationale:** The type itself isn't dead code, just the function that returns it. It provides useful documentation.

### Q3: Should ts-prune block CI?

**Decision:** Yes, configure with `--error` flag.

**Rationale:** Preventing dead code accumulation requires enforcement, not just warnings.

---

## 12. Tasks

### High-Level Tasks

1. **Task 1.0: Remove Dead Code from openai.ts**
   - Remove analyzeImage() function
   - Verify exports are all used

2. **Task 2.0: Remove Dead Code from services.ts**
   - Remove imageAnalysis service interface
   - Remove dead import and assignment
   - Evaluate fakeImageAnalysis usage

3. **Task 3.0: Add Dead Code Detection**
   - Install ts-prune
   - Configure npm script
   - Add to CI pipeline

4. **Task 4.0: Update Tests and Verify**
   - Update any tests referencing removed code
   - Run full test suite
   - Document verification results

**Ready for high-level task approval.**
