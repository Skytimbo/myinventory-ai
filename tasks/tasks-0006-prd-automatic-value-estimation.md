# Tasks for PRD-0006: Automatic Estimated Value Generation

**PRD:** `/tasks/0006-prd-automatic-value-estimation.md`
**Created:** 2024-11-18
**Status:** Pending

---

## Relevant Files

### Files to Modify
- `server/modelPolicy.ts` — Extend AnalysisResult interface, update prompts
- `server/routes.ts` — Use analysis value fields instead of hardcoded defaults
- `server/services.ts` — Update fakeImageAnalysis for deterministic testing

### Files to Create
- `server/tests/value-estimation.spec.ts` — Unit and integration tests
- `e2e/value-estimation.spec.ts` — E2E tests for full flow

### Files to Verify (No Changes Expected)
- `shared/schema.ts` — Confirm value fields exist
- `client/src/components/ItemCard.tsx` — Verify UI displays values
- `client/src/components/Dashboard.tsx` — Verify aggregation works

### Notes
- Use Vitest for unit/integration tests
- Use Playwright for e2e tests
- Schema already exists; no migrations required

---

## Tasks

- [ ] **1.0 Extend Model Policy Interface and Prompts**
  - [ ] 1.1 Add value fields to AnalysisResult interface (name, tags, estimatedValue, valueConfidence, valueRationale)
    - **File:** `server/modelPolicy.ts`
    - **Acceptance:** Interface compiles with all fields as appropriate types (string | null)
  - [ ] 1.2 Update cheap model prompt to request value fields with valuation guidance
    - **File:** `server/modelPolicy.ts` → `analyzeWithCheapModel()`
    - **Acceptance:** Prompt requests JSON with estimatedValue, valueConfidence, valueRationale; includes secondary market pricing guidance
  - [ ] 1.3 Update cheap model response parsing to extract all value fields
    - **File:** `server/modelPolicy.ts` → `analyzeWithCheapModel()`
    - **Acceptance:** Function returns complete AnalysisResult with value fields
  - [ ] 1.4 Update premium model prompt to request value fields with valuation guidance
    - **File:** `server/modelPolicy.ts` → `analyzeWithPremiumModel()`
    - **Acceptance:** Prompt matches cheap model structure for consistency
  - [ ] 1.5 Update premium model response parsing to extract all value fields
    - **File:** `server/modelPolicy.ts` → `analyzeWithPremiumModel()`
    - **Acceptance:** Function returns complete AnalysisResult with value fields
  - [ ] 1.6 Verify analyzeImagePolicy returns complete result with confidence fallback intact
    - **File:** `server/modelPolicy.ts` → `analyzeImagePolicy()`
    - **Acceptance:** Returns all fields; falls back to premium when confidence < 0.4

- [ ] **2.0 Integrate Value Fields in Routes**
  - [ ] 2.1 Replace hardcoded item fields with analysis results (name, tags, estimatedValue)
    - **File:** `server/routes.ts` → POST /api/items
    - **Acceptance:** Item creation uses `analysis.name || "Item"`, `analysis.tags || []`, `analysis.estimatedValue`
  - [ ] 2.2 Add valueConfidence and valueRationale fields to item creation
    - **File:** `server/routes.ts` → POST /api/items
    - **Acceptance:** Both fields passed to storage.createItem()
  - [ ] 2.3 Add validation for estimatedValue format (decimal string)
    - **File:** `server/routes.ts`
    - **Acceptance:** Invalid formats result in null, not crash; valid format: /^\d+\.\d{2}$/
  - [ ] 2.4 Add validation for valueConfidence (low/medium/high or null)
    - **File:** `server/routes.ts`
    - **Acceptance:** Invalid values result in null
  - [ ] 2.5 Update error fallback to set value fields to null instead of "0.00"
    - **File:** `server/routes.ts` → catch block
    - **Acceptance:** AI failure results in null for all value fields, item still created

- [ ] **3.0 Update Test Infrastructure**
  - [ ] 3.1 Update fakeImageAnalysis to return complete AnalysisResult with value fields
    - **File:** `server/services.ts`
    - **Acceptance:** Returns name, tags, estimatedValue: "42.00", valueConfidence: "high", valueRationale
  - [ ] 3.2 Ensure fakeImageAnalysis type matches AnalysisResult interface
    - **File:** `server/services.ts`
    - **Acceptance:** TypeScript compiles with no errors

- [ ] **4.0 Create Unit and Integration Tests**
  - [ ] 4.1 Test analyzeWithCheapModel returns all value fields
    - **File:** `server/tests/value-estimation.spec.ts`
    - **Acceptance:** Mock OpenAI, verify response includes estimatedValue, valueConfidence, valueRationale
  - [ ] 4.2 Test analyzeWithPremiumModel returns all value fields
    - **File:** `server/tests/value-estimation.spec.ts`
    - **Acceptance:** Mock OpenAI, verify response includes all value fields
  - [ ] 4.3 Test analyzeImagePolicy confidence-based fallback
    - **File:** `server/tests/value-estimation.spec.ts`
    - **Acceptance:** Verify premium called when cheap confidence < 0.4
  - [ ] 4.4 Test POST /api/items returns and persists value fields
    - **File:** `server/tests/value-estimation.spec.ts`
    - **Acceptance:** Upload image, verify response and database contain value fields
  - [ ] 4.5 Test AI failure results in null values, not "0.00"
    - **File:** `server/tests/value-estimation.spec.ts`
    - **Acceptance:** Mock AI failure, verify null values and successful 201 response
  - [ ] 4.6 Test value format validation
    - **File:** `server/tests/value-estimation.spec.ts`
    - **Acceptance:** Invalid formats handled gracefully

- [ ] **5.0 Create E2E Tests and Final Verification**
  - [ ] 5.1 Test upload displays estimated value in ItemCard
    - **File:** `e2e/value-estimation.spec.ts`
    - **Acceptance:** Upload image, verify value visible in UI
  - [ ] 5.2 Test confidence badge and rationale tooltip
    - **File:** `e2e/value-estimation.spec.ts`
    - **Acceptance:** Badge displays, hover shows rationale
  - [ ] 5.3 Test dashboard total value aggregation
    - **File:** `e2e/value-estimation.spec.ts`
    - **Acceptance:** Multiple items, verify total sum correct
  - [ ] 5.4 Run full test suite and verify no regressions
    - **Command:** `pnpm test && pnpm e2e`
    - **Acceptance:** All tests pass
  - [ ] 5.5 Manual smoke test with real image upload
    - **Acceptance:** Real image analyzed, value displayed in UI

---

## Commit Strategy

1. After 1.0: `feat(ai): extend model policy with value estimation prompts`
2. After 2.0: `feat(api): integrate value fields in item creation`
3. After 3.0-4.0: `test: add value estimation unit and integration tests`
4. After 5.0: `test(e2e): add e2e tests for value estimation flow`

---

**Ready for implementation approval. Respond with 'Go' to begin implementation.**
