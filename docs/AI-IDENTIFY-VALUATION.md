# AI Identify and Estimate Value

MyInventory AI uses two independent AI actions. They replace the old combined analysis, which named an item and priced it in one call.

| Action | When it runs | Writes |
|---|---|---|
| **Identify** | On upload (unless Quick Capture is on), or when you click Identify / Re-identify | `name`, `description`, `category`, `tags`, `identification`, `analysis_metadata` |
| **Estimate Value** | Only when you click Estimate Value / Re-estimate | `valuation` |

Neither action writes `location`, and neither ever writes the legacy `estimated_value`, `value_confidence`, or `value_rationale` columns. If an AI call fails, the item is left exactly as it was.

## Contract

- Identification and valuation are independent operations.
- An unknown value is not zero. No value is stored or shown as `$0.00` to mean "unknown".
- An ordinary nonmarketable object (for example a river rock) gets no price.
- No external comparable-sales evidence is claimed unless it was actually retrieved. Today nothing is retrieved, so every valuation's evidence basis is `model_judgment`.
- User-entered information (`location`) is preserved.
- Failed AI operations do not erase existing data.
- Every stored valuation has an explicit status and evidence basis.
- Stale and legacy estimates never count as current valuations.

## Identify

The model returns a name, description, category, tags, a 0–1 confidence, uncertainty notes, and up to three alternative identifications. Up to four of the item's photos are sent.

- The prompt forbids prices, and the server only reads known identification fields. Sentences that state a price are also stripped from the description and notes.
- Confidence maps to uncertainty: `low` (≥ 0.75), `medium` (≥ 0.45), `high`.
- `gpt-4o-mini` runs first. If its confidence is below 0.4, `gpt-4o` runs instead.

**Re-identifying** replaces name, description, category, and tags (the UI asks for confirmation first). If the item has a valuation, it is kept but marked stale (`staleAt`, `staleReason: "reidentified"`). This happens on every successful re-identification; no AI judgment decides whether the identification "really" changed.

## Estimate Value

Uses `gpt-4o` with up to four photos and the current identification. The model must assess **marketability first**, then return exactly one outcome:

| Status | Meaning | Price |
|---|---|---|
| `estimated` | Marketable; a defensible private-party used range | `low`, `likely`, `high` (USD) |
| `nonmarketable` | No realistic resale market | none |
| `insufficient_information` | A value may exist but can't be established from these photos; `missingInformation` says what would help | none |

`not_evaluated` is not stored: it is the absence of a valuation.

The server validates every response and never reinterprets one. `nonmarketable` and `insufficient_information` are only ever the model's explicit judgments; the server never derives them from missing, zero, or invalid amounts. A response that breaks any rule below is rejected as invalid model output (`InvalidValuationError`, returned as `502 VALUATION_FAILED`), and the stored record, including any earlier valuation, is left unchanged.

- `status` and `marketability` must both be present and valid, and consistent with each other:

  | Status | Allowed marketability |
  |---|---|
  | `estimated` | `marketable` |
  | `nonmarketable` | `nonmarketable` |
  | `insufficient_information` | `marketable` or `uncertain` |

- `estimated` needs `low`, `likely`, and `high`, all positive (> $0), with `low ≤ likely ≤ high`, and a confidence of `low`, `medium`, or `high`. Zero, negative, missing, non-numeric, or reversed amounts are invalid. Sub-dollar positive amounts are allowed.
- `nonmarketable` and `insufficient_information` must not include any amount, including `0`. A confidence level sent with them is ignored.

Two things are still adjusted rather than rejected:

- Sentences claiming eBay, sold listings, comparable sales, auctions, or price guides are removed from the rationale and marketability reason.
- `evidence` is always set by the server to `{ basis: "model_judgment", note: "...No marketplace or sales data was retrieved." }`.

Because contradictory output is now rejected instead of repaired, expect some Estimate Value attempts to fail and need a retry. `pnpm ai:eval` reports these as failures.

Items that are not identified yet (Quick Capture, or AI failed at upload) must be identified first (`409 NOT_IDENTIFIED`). Items identified by the old combined analysis can be estimated directly.

## Legacy data

Rows created before migration 0003 may have `estimated_value` / `value_confidence` / `value_rationale` from the old combined analysis. These are kept unchanged and are never written again.

- They are shown as **"Legacy estimate $X from the old combined analysis (unverified, not counted in totals)"**.
- Any legacy amount of `0.00` or less is treated as an ambiguous placeholder, whatever confidence was recorded with it, because the old process used 0 to mean both "unknown" and "worthless". Placeholders appear only in AI details, are never shown as a price, and are not counted as legacy estimates. Positive legacy amounts are preserved and shown as legacy estimates.
- Running Estimate Value on a legacy item adds a new `valuation`; the legacy amount stays available.

## Totals

Dashboard totals, averages, and the value filter use only **current** estimates: status `estimated` and not stale. Stale, legacy, nonmarketable, insufficient, and not-evaluated items are excluded and counted separately. With no current estimates, the dashboard shows "—", not `$0.00`.

All of this is derived in one place: `shared/valuation.ts`.

## API

| Endpoint | Success | Errors |
|---|---|---|
| `POST /api/items/:id/identify` | Updated item | `404 NOT_FOUND`, `502 IDENTIFY_FAILED` (item unchanged), `429 AI_RATE_LIMITED` |
| `POST /api/items/:id/analyze`, `/reanalyze` | Aliases of `/identify` for older clients | same |
| `POST /api/items/:id/estimate-value` | Updated item | `404 NOT_FOUND`, `409 NOT_IDENTIFIED`, `502 VALUATION_FAILED` (data unchanged), `429 AI_RATE_LIMITED` |

All require a signed-in session and share the AI rate limit (30 requests per hour).

## Data model (migration 0003)

`migrations/0003_identify_valuation.sql` adds two nullable JSONB columns, `identification` and `valuation`. It is additive: no rows are rewritten and nothing is dropped. Their shapes are defined in `shared/schema.ts` (`identificationSchema`, `valuationSchema`).

Backups include both columns (archive schema version `0003_identify_valuation`). `pnpm restore:verify` still accepts `0002_analysis_metadata` archives and restores the new columns as null.

## Manual evaluation with real photos

Automated tests use synthetic, mocked model responses. They prove the server enforces the contract, not that the model judges real photos well. To check real behaviour:

```bash
# photos/<item-name>/*.jpg, optionally photos/<item-name>/expected-status.txt
pnpm ai:eval photos/           # real OpenAI calls, a few cents per item
pnpm ai:eval photos/ --mock    # plumbing check only
```

It reads no database and writes nothing. Suggested set: an ordinary river rock (`nonmarketable`), a branded power tool (`estimated`), a plain mug (`estimated` or `nonmarketable`), and an antique without visible marks (`insufficient_information`).

## Production deployment runbook

Do these in order. The code must not reach production before the migration: the app selects the new columns, so every item query would fail against an unmigrated database. The migration is safe for the currently deployed code, which ignores the extra columns.

1. **Back up first.** Use Download Backup in the current app, or `pnpm backup`. Confirm the archive with `pnpm restore:verify` against a test database.
2. **Rehearse on a non-production database.** Apply the migration to a Neon branch or test database, then run the app (or `pnpm restore:verify` with a fresh archive) against it.
3. **Apply the migration to production.** Run `migrations/0003_identify_valuation.sql` in the Neon SQL Editor. Or run `pnpm exec tsx scripts/run-migration.ts migrations/0003_identify_valuation.sql`, but note that the script uses `DATABASE_URL_TEST` first, then `DATABASE_URL`, and loads `.env`. Check which database it will target before running it.
4. **Verify the columns:**
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'inventory_items' AND column_name IN ('identification', 'valuation');
   ```
5. **Deploy the application.**
6. **Smoke test:**
   - Legacy items show "Legacy estimate …" and the dashboard does not count them.
   - Identify one item.
   - Estimate its value.
   - Re-identify it and confirm the estimate shows as stale.
   - Download a backup and run `pnpm restore:verify` on it.

### Rollback

Redeploy the previous application version. The two new columns can stay: the old code neither reads nor writes them. Do not drop them unless you accept losing every identification and valuation created since the migration.

**Known hazard while rolled back.** The old app's combined **Analyze** (`/analyze`, `/reanalyze`) overwrites `name`, `description`, `category`, `tags`, `analysis_metadata`, and the legacy value columns. It does not touch `identification` or `valuation`. A valuation saved before the rollback therefore stays unmarked even though the item it describes has been re-identified, and after rolling forward the new app would show and total it as a current estimate.

While rolled back:

- Do not use Analyze on any item.
- Creating new items is fine: they get no `identification` or `valuation`, so they show as legacy-identified and not evaluated after rolling forward.

Before rolling forward again, check whether any identification changed while rolled back. A stored valuation must be marked stale if any of these is true for its row:

1. `valuation.basedOn.name` differs from the row's current `name`, or `valuation.basedOn.category` differs from its current `category`.
2. `analysis_metadata.timestamp` is later than `valuation.evaluatedAt`. Only an identification writes `analysis_metadata`, so this means the item was re-identified after it was valued, even if the name happened to stay the same.
3. `valuation.basedOn.identifiedAt` differs from `identification.identifiedAt`. The new app keeps these equal, so a difference is a sign of manual edits or partial restores.

Read-only check (run it on a Neon branch or with a read-only role first):

```sql
SELECT id, name, valuation->'basedOn'->>'name' AS valued_as, valuation->>'evaluatedAt' AS evaluated_at
FROM inventory_items
WHERE valuation IS NOT NULL
  AND valuation->>'staleAt' IS NULL
  AND (
    valuation->'basedOn'->>'name' IS DISTINCT FROM name
    OR valuation->'basedOn'->>'category' IS DISTINCT FROM category
    OR (analysis_metadata->>'timestamp')::timestamptz > (valuation->>'evaluatedAt')::timestamptz
    OR valuation->'basedOn'->>'identifiedAt' IS DISTINCT FROM identification->>'identifiedAt'
  );
```

If it returns rows, take a backup, then mark exactly those rows stale before rolling forward. Set `valuation.staleAt` to the current time and `valuation.staleReason` to `"reidentified_during_rollback"`; leave every other field unchanged so the estimate stays visible as stale. The app does not do this automatically. If the query returns no rows, no action is needed.
