# PRD-0006: Automatic Estimated Value Generation

## Document Information

| Field | Value |
|-------|-------|
| Status | Draft |
| Created | 2024-11-18 |
| Last Updated | 2024-11-18 |
| Author | Claude |
| Type | Feature Restoration |
| Related PRDs | PRD-0003 (Foundational Architecture), PRD-0004 (Multi-Image Support) |

## Foundation Reference

This PRD aligns with FOUNDATION.md principles:
- **Principle 1: Media as First-Class Concept** - Value estimation derives from image analysis
- **Principle 6: Search as First-Class Concern** - Value range filtering enabled

---

## Overview

### Problem Statement

The inventory management system has complete infrastructure for estimated value generation (schema fields, UI components, AI prompts) but the feature is currently disconnected. The `routes.ts` file calls `analyzeImagePolicy()` which returns a simplified result without value fields, causing all items to be created with hardcoded `estimatedValue: "0.00"`.

**Current broken flow:**
```typescript
// routes.ts creates items with hardcoded values
const item = await storage.createItem({
  name: "Item",                    // Hardcoded
  estimatedValue: "0.00",         // Hardcoded - never uses AI
  // valueConfidence and valueRationale are omitted entirely
});
```

### Solution

Restore the automatic value estimation feature by enhancing the model policy to return full analysis results including estimated values, and updating routes.ts to use these values. The solution prioritizes cost efficiency by using the cheap model (gpt-4o-mini) by default while maintaining quality through confidence-based fallback to the premium model.

---

## Goals

1. **Restore value estimation** - Every uploaded item receives an AI-generated estimated resale value
2. **Ensure cost efficiency** - Average cost per analysis < $0.001 USD
3. **Maintain determinism** - Consistent, reproducible results for testing
4. **Preserve existing UI** - No frontend changes required; UI already complete
5. **Enable filtering** - Support existing value range filter functionality

---

## User Stories

### US-1: Item Upload with Value Estimation

**As a** user uploading an item
**I want** the system to automatically estimate its resale value
**So that** I can track the worth of my inventory

**Acceptance Criteria:**
- [ ] Uploading an image generates a non-null `estimatedValue`
- [ ] Value is displayed in USD format (e.g., "$45.00")
- [ ] Confidence indicator appears next to value (low/medium/high)
- [ ] Hovering over confidence badge shows rationale tooltip

### US-2: Dashboard Value Aggregation

**As a** user viewing my inventory dashboard
**I want** to see total and average estimated values
**So that** I understand my inventory's overall worth

**Acceptance Criteria:**
- [ ] Total value sums all item `estimatedValue` fields
- [ ] Average value calculated correctly
- [ ] Items without values (null) are excluded from calculations

### US-3: Export with Values

**As a** user exporting my inventory
**I want** estimated values included in exports
**So that** I have complete records for insurance or sale purposes

**Acceptance Criteria:**
- [ ] CSV export includes `estimatedValue` column
- [ ] PDF export displays estimated value per item
- [ ] Null values render as empty/N/A, not "0.00"

### US-4: Value Range Filtering

**As a** user searching my inventory
**I want** to filter items by value range
**So that** I can find high-value or low-value items quickly

**Acceptance Criteria:**
- [ ] Min/max value filter works correctly
- [ ] Items with null values are excluded from filtered results
- [ ] Filter UI already exists and requires no changes

---

## Functional Requirements

### FR-1: Generate Value Fields on Upload

The system SHALL generate three value-related fields for every uploaded item:
- `estimatedValue`: Decimal string representing USD resale value (e.g., "45.00")
- `valueConfidence`: One of "low", "medium", or "high"
- `valueRationale`: Brief 1-sentence explanation of the valuation

### FR-2: Use Cheap Model by Default

The system SHALL use `gpt-4o-mini` as the default model for all image analysis to minimize costs.

**Cost target:** ~$0.00015 per image analysis

### FR-3: Confidence-Based Model Fallback

The system SHALL fall back to the premium model (`gpt-4o`) when the cheap model returns a confidence score below 0.4.

**Fallback cost:** ~$0.003 per image analysis

### FR-4: Persist Value Fields

The system SHALL store all three value fields in the database:
- `estimated_value` (decimal 10,2)
- `value_confidence` (text)
- `value_rationale` (text)

Note: Schema already exists; no migration required.

### FR-5: Return Values in API Response

The `POST /api/items` endpoint SHALL return all value fields in the response:

```json
{
  "id": "uuid",
  "name": "Vintage Camera",
  "estimatedValue": "150.00",
  "valueConfidence": "medium",
  "valueRationale": "Based on similar vintage 35mm cameras in working condition"
}
```

### FR-6: Graceful AI Failure Handling

When AI analysis fails, the system SHALL:
- Set `estimatedValue` to `null` (not "0.00")
- Set `valueConfidence` to `null`
- Set `valueRationale` to `null`
- Log the error for monitoring
- Continue item creation with other fields

### FR-7: Support Value Range Filtering

The existing value range filter SHALL work correctly with restored values:
- Filter by minimum value
- Filter by maximum value
- Exclude items with null values from filtered results

### FR-8: Include Values in Exports

Export functionality SHALL include value fields:
- CSV: Include `estimatedValue`, `valueConfidence`, `valueRationale` columns
- PDF: Display formatted value with confidence indicator

---

## Non-Goals

The following are explicitly out of scope for this PRD:

1. **User manual override** - Users cannot edit AI-generated values (future PRD)
2. **Historical value tracking** - No history of value changes over time
3. **Currency conversion** - All values in USD only
4. **Batch re-estimation** - No endpoint to re-estimate existing items
5. **Market data integration** - No external pricing APIs (eBay, etc.)
6. **Value alerts** - No notifications for value thresholds

---

## Design Considerations

### UI Components (No Changes Required)

The UI is already complete and requires no modifications:

**ItemCard.tsx** - Value display with confidence badge:
```tsx
{item.estimatedValue && (
  <div className="flex items-center gap-2">
    <p className="text-base font-semibold text-foreground font-mono">
      ${parseFloat(item.estimatedValue).toFixed(2)}
    </p>
    {item.valueConfidence && (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={...}>
            {/* Icon based on confidence level */}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Confidence: {item.valueConfidence}</p>
          {item.valueRationale && <p>{item.valueRationale}</p>}
        </TooltipContent>
      </Tooltip>
    )}
  </div>
)}
```

**Dashboard.tsx** - Total and average value aggregation already implemented

**ExportModal.tsx** - CSV and PDF exports already include value fields

**SearchFilter** - Value range filter already exists

### Confidence Badge Styling

| Confidence | Icon | Color |
|------------|------|-------|
| high | TrendingUp | Green (success) |
| medium | Minus | Yellow (warning) |
| low | TrendingDown | Red (destructive) |

---

## Technical Considerations

### 1. Enhance Model Policy

Update `server/modelPolicy.ts` to include value fields in the analysis result:

```typescript
export interface AnalysisResult {
  description: string;
  category: string;
  confidence: number;
  raw: unknown;
  // Add value fields
  name: string;
  tags: string[];
  estimatedValue: string;
  valueConfidence: string;
  valueRationale: string;
}
```

### 2. Update Analysis Prompts

Enhance the prompts in `modelPolicy.ts` to include valuation guidance:

**Cheap Model Prompt Enhancement:**
```typescript
const cheapPrompt = `Analyze this image and return JSON:
{
  "name": "Item name",
  "description": "Brief description",
  "category": "Category",
  "tags": ["tag1", "tag2"],
  "confidence": 0.0-1.0,
  "estimatedValue": "USD resale value (e.g., '45.00')",
  "valueConfidence": "low|medium|high",
  "valueRationale": "Brief explanation"
}

For value estimation:
- Base on secondary market prices (eBay, Craigslist), NOT retail
- Be conservative - account for negotiation room
- Consider: brand, condition, age, demand, completeness`;
```

### 3. Update Routes to Use Full Analysis

Modify `server/routes.ts` to pass through all analysis fields:

```typescript
// Current (broken)
const item = await storage.createItem({
  name: "Item",
  description: analysis.description,
  category: analysis.category,
  tags: [],
  estimatedValue: "0.00",
});

// Fixed
const item = await storage.createItem({
  name: analysis.name || "Item",
  description: analysis.description,
  category: analysis.category,
  tags: analysis.tags || [],
  estimatedValue: analysis.estimatedValue || null,
  valueConfidence: analysis.valueConfidence || null,
  valueRationale: analysis.valueRationale || null,
  // ... other fields
});
```

### 4. Ensure Type Safety

Update TypeScript types to ensure value fields flow through correctly:

```typescript
// shared/schema.ts - already correct
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;

// Ensure InsertInventoryItem includes optional value fields
// estimatedValue?: string
// valueConfidence?: string
// valueRationale?: string
```

### 5. Test Fixtures

Update `fakeImageAnalysis` in `server/services.ts` for deterministic testing:

```typescript
export const fakeImageAnalysis = {
  async analyzeImage(_imageBase64: string): Promise<ImageAnalysisResult> {
    return {
      name: "Test Item",
      description: "A test item for development",
      category: "Electronics",
      tags: ["test", "fake", "deterministic"],
      estimatedValue: "42.00",
      valueConfidence: "high",
      valueRationale: "Fake analysis always returns this value",
    };
  },
};
```

---

## Model Policy Scoping Notes

### Cost Analysis

| Model | Cost per 1K tokens | Est. per Image | Use Case |
|-------|-------------------|----------------|----------|
| gpt-4o-mini | $0.00015 input, $0.0006 output | ~$0.00015 | Default |
| gpt-4o | $0.0025 input, $0.01 output | ~$0.003 | Fallback |
| gpt-5 | Higher | ~$0.01+ | Not used |

### Policy Decision

**Use gpt-4o-mini as default** to maintain low-cost behavior:
- Adequate for most items with clear images
- 20x cheaper than gpt-4o
- Confidence threshold (0.4) triggers fallback only when necessary

**Do NOT use gpt-5** despite existing prompt in `openai.ts`:
- Cost prohibitive for every upload
- Reserve for future premium features

### Deterministic Behavior

For testing and predictability:
1. Use `fakeImageAnalysis` in development/test environments
2. Log all AI responses for debugging
3. Set temperature to 0 for reproducible results
4. Cache identical image hashes (future optimization)

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Value generation rate | 100% | % of uploads with non-null estimatedValue |
| Average API cost | < $0.001 | Total AI cost / number of uploads |
| Analysis latency | < 5s | 95th percentile response time |
| Confidence distribution | Healthy spread | % low/medium/high should not be all one value |
| User satisfaction | No regressions | No increase in support tickets about values |

---

## Acceptance Tests

### AT-1: Basic Value Generation

```typescript
test('uploaded item receives estimated value', async () => {
  const response = await uploadItem('camera.jpg');

  expect(response.estimatedValue).not.toBeNull();
  expect(parseFloat(response.estimatedValue)).toBeGreaterThan(0);
  expect(['low', 'medium', 'high']).toContain(response.valueConfidence);
  expect(response.valueRationale).toBeTruthy();
});
```

### AT-2: Value Persistence

```typescript
test('value fields are persisted to database', async () => {
  const created = await uploadItem('camera.jpg');
  const retrieved = await getItem(created.id);

  expect(retrieved.estimatedValue).toBe(created.estimatedValue);
  expect(retrieved.valueConfidence).toBe(created.valueConfidence);
  expect(retrieved.valueRationale).toBe(created.valueRationale);
});
```

### AT-3: AI Failure Graceful Degradation

```typescript
test('AI failure results in null values, not zero', async () => {
  // Mock AI to fail
  mockAIFailure();

  const response = await uploadItem('camera.jpg');

  expect(response.estimatedValue).toBeNull();
  expect(response.valueConfidence).toBeNull();
  expect(response.name).toBe('Item'); // Fallback name
});
```

### AT-4: Dashboard Aggregation

```typescript
test('dashboard calculates total value correctly', async () => {
  await uploadItem('item1.jpg'); // $50
  await uploadItem('item2.jpg'); // $100

  const dashboard = await getDashboard();

  expect(dashboard.totalValue).toBe(150);
  expect(dashboard.averageValue).toBe(75);
});
```

### AT-5: Value Range Filter

```typescript
test('value range filter returns correct items', async () => {
  await createItemWithValue(50);
  await createItemWithValue(100);
  await createItemWithValue(200);

  const filtered = await getItems({ minValue: 75, maxValue: 150 });

  expect(filtered).toHaveLength(1);
  expect(filtered[0].estimatedValue).toBe('100.00');
});
```

### AT-6: Export Includes Values

```typescript
test('CSV export includes value columns', async () => {
  await uploadItem('camera.jpg');

  const csv = await exportCSV();

  expect(csv).toContain('estimatedValue');
  expect(csv).toContain('valueConfidence');
  expect(csv).toContain('valueRationale');
});
```

---

## Decisions on Open Questions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Which model for values? | gpt-4o-mini default | Cost efficiency; adequate quality for most items |
| What if AI returns invalid value? | Set to null | "0.00" implies worthless; null implies unknown |
| Should we validate value format? | Yes, regex check | Ensure decimal format before storage |
| Cache identical images? | Future optimization | Out of scope for initial restoration |
| Allow user override? | Future PRD | Keep this PRD focused on AI generation |

---

## Implementation Phases

### Phase 1: Core Restoration (Estimated: 2-4 hours)

1. Update `modelPolicy.ts` prompts to include value fields
2. Extend `AnalysisResult` interface with value fields
3. Modify `routes.ts` to use analysis value fields
4. Update fake services for testing

### Phase 2: Validation & Error Handling (Estimated: 1-2 hours)

1. Add value format validation (decimal string)
2. Implement graceful failure handling (null values)
3. Add logging for monitoring

### Phase 3: Testing (Estimated: 2-3 hours)

1. Unit tests for value generation
2. Integration tests for API flow
3. E2E tests for full user journey
4. Verify existing UI works with restored values

---

## Appendix: Existing Infrastructure

### Schema (shared/schema.ts)
```typescript
estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }),
valueConfidence: text("value_confidence"),
valueRationale: text("value_rationale"),
```

### UI Components
- `ItemCard.tsx` - Value display with confidence tooltip
- `Dashboard.tsx` - Total/average aggregation
- `ExportModal.tsx` - CSV/PDF with values
- `home.tsx` - Value range filter

### AI Prompts
- `openai.ts` - Full appraiser prompt (not currently used)
- `modelPolicy.ts` - Simplified prompts (need enhancement)

### Test Fixtures
- `services.ts` - fakeImageAnalysis with value fields
- `storage.spec.ts` - Test data with values
