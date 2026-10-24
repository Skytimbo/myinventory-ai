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

Automated tests use synthetic, mocked model responses. They prove the server enforces the contract, not that the model judges real photos well. `pnpm ai:eval` runs the real Identify and Estimate Value prompts on your photos.

### What it can and cannot touch

- It reads OpenAI settings from the **shell environment only**: `OPENAI_API_KEY`, `OPENAI_PROJECT_ID` (required for `sk-proj-` keys), and optionally `OPENAI_BASE_URL`. It does **not** load `.env`, so `DATABASE_URL` and other app settings never enter the process.
- It imports only the analyzer and the OpenAI SDK. No database, storage, or migration code is reachable, which `server/tests/aiEval.spec.ts` checks.
- It reads photos and writes only to `--out`. Inside the repository, `--out` must be under `ai-eval-results/` (gitignored). It may also point outside the repository, but never inside `uploads/` or `LOCAL_STORAGE_DIR`.
- API keys are redacted from everything it prints or saves, including OpenAI's masked key in `401` errors.

### Prepare photos

Put photos in `ai-eval-photos/` (gitignored), one folder per item, 1–4 photos each (`.jpg`, `.jpeg`, `.png`, `.webp`). An optional `expected-status.txt` holds `estimated`, `nonmarketable`, or `insufficient_information`.

```text
ai-eval-photos/
  river-rock/        1.jpg               expected-status.txt -> nonmarketable
  dewalt-drill/      1.jpg 2.jpg         expected-status.txt -> estimated
  plain-mug/         1.jpg
  stoneware-crock/   1.jpg 2.jpg 3.jpg   expected-status.txt -> insufficient_information
```

### Supply a temporary test key

Use a separate, low-limit key created for this test (OpenAI dashboard → API keys), not the production key. Enter it into the current shell only, so it is not saved in a file or in shell history:

```bash
read -rs "OPENAI_API_KEY?OpenAI test key: " && export OPENAI_API_KEY   # zsh; in bash: read -rsp "OpenAI test key: " OPENAI_API_KEY
export OPENAI_PROJECT_ID=proj_...    # only for sk-proj- keys; this is an ID, not a secret
```

Do not put the test key in `.env`, `.env.example`, or any tracked file. When finished, run `unset OPENAI_API_KEY OPENAI_PROJECT_ID`, close the terminal, and revoke the test key in the OpenAI dashboard.

### Run

```bash
pnpm ai:eval ai-eval-photos --mock --out    # free plumbing check first
pnpm ai:eval ai-eval-photos --out           # real calls: roughly 2-3 per item
pnpm ai:eval ai-eval-photos --identify-only --out   # Identify only, no valuation
```

`--out` with no directory writes to `ai-eval-results/run-<timestamp>/results.json`. Each run gets a new directory; earlier runs are never overwritten. The file records:

- the run: timestamps, mode, model names, prompt/contract versions (`identify-v1`, `valuation-v1`), and a credential-free description of the configuration;
- per item (identified by folder name): photo file names, sizes, and SHA-256 hashes;
- **Identify** and **Estimate Value** as separate actions, each with timestamps, model, prompt version, parsed result, and error;
- every raw OpenAI request and response, labelled by action. Image data is replaced by MIME type, size, and hash.

If OpenAI rejects the key (`401`/`403`), the run stops and the remaining items are marked skipped. The command exits with status 1 if any item failed, any result mismatched `expected-status.txt`, or the run stopped early. A rejected valuation (for example a $0 estimate or a status that contradicts marketability) is recorded as an `InvalidValuationError`, with the raw response kept for review.

Suggested set: an ordinary river rock (`nonmarketable`), a branded power tool (`estimated`), a plain mug (`estimated` or `nonmarketable`), and an antique without visible marks (`insufficient_information`).

## Evaluation log — 2026-10-24

Manual observations made by the owner in the production app after deploying commit `28e3b15`, using four real photos (one photo per item). Prompt versions in effect: `identify-v1` and `valuation-v1`. These are manual production observations of four items, not automated evaluation results, and they are not evidence of general model accuracy.

| Item | Identify | Estimate Value | Notes |
|---|---|---|---|
| River rock | Correctly identified as a river rock | `nonmarketable`; no price | No dollar amount fabricated. The legacy $10 estimate from the old combined analysis was preserved and excluded from totals. Minor issue: described as "polished", which the photo does not support. |
| Handmade ceramic mug | Correctly identified as a handcrafted ceramic mug | `insufficient_information`; asked for a maker's mark, an underside photo, or an appraisal | No fabricated price. Possibly too conservative: a handmade mug has an ordinary secondhand value even when its maker is unknown. |
| DeWalt XRP 18V cordless drill | Identified generically as "Cordless Drill" | `estimated`: $20–$60, likely $40, medium confidence; labelled AI judgment | Missed the clearly visible DeWalt brand, XRP, and 18V markings. Working condition and battery health were not visible but did not lower confidence. |
| Fur mukluks | Identified as traditional fur boots | `insufficient_information`; asked for origin, fur type, and markings | Avoided invented provenance and price. Unsupported claim of an interior fur lining. |

Likely causes in the `-v1` prompts:

- Identify discouraged guessed brands but never asked the model to read legible markings, so a clearly printed brand was treated like a guess.
- Identify did not forbid unsupported claims about surface treatments, materials, or interior construction ("polished", "fur lining").
- Valuation treated an unknown maker as a reason to give no price at all, rather than considering whether an ordinary secondhand baseline exists.
- Valuation did not ask for unverified working condition to be recorded or reflected in confidence.

Follow-up: `identify-v2` and `valuation-v2` address these (see the commit that introduces them). Their effect has not yet been observed in production.

## Production deployment runbook

Do these in order. The code must not reach production before the migration: the app selects the new columns, so every item query would fail against an unmigrated database. The migration is safe for the currently deployed code, which ignores the extra columns.

1. **Back up first: the database and the images separately.** See [Pre-migration backups](#pre-migration-backups) below. Do not continue until both are verified.
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
   - Download a backup and run `pnpm restore:verify` on it. From this release on, Download Backup and the current `pnpm backup` work; both produce a records-plus-referenced-images archive, not a database dump.

### Pre-migration backups

Photos and records live in different places, so they are backed up separately. A database backup contains no image files, and an image backup contains no database rows.

| Backup | Where the data lives | Covers | Does not cover |
|---|---|---|---|
| **Database: Neon branch** | Neon project | Every row and column, instantly; doubles as the database rollback point | Image files |
| **Database: `pg_dump`** | A file on your machine | Every row and column, independent of Neon | Image files |
| **Images: Railway volume backup** (if your plan offers it) | Railway volume at `LOCAL_STORAGE_DIR` | Every file on the volume, including files no row references | Database rows |
| **Records + images archive: `ebbbac2` backup script** | A `.tar.gz` on your machine | Every row's data (`inventory.json`) and every image a row references, with hashes | Unreferenced volume files; it is not a full database dump |

Before migration 0003, use only these. **Do not use the current `pnpm backup`** (it requires migration 0003) and do not expect **Download Backup**, which is not in the version deployed before this release.

**Database.** Take at least one; both is better.

- **Neon branch:** in the Neon console, create a branch named `pre-0003-<date>` from the production branch. This applies only if production uses Neon; confirm Railway's `DATABASE_URL` host first.
- **`pg_dump`:** use the direct (non-pooler) connection string and a `pg_dump` at least as new as the server. Keep the connection string out of shell history and files.
  ```bash
  read -rs "PROD_DB_URL?Production direct connection string: " && echo
  pg_dump "$PROD_DB_URL" --format=custom --no-owner --no-privileges --file ~/MyInventoryBackups/pre-0003.dump
  unset PROD_DB_URL
  ```
  Verify it by restoring into a disposable local database (`createdb`, then `pg_restore --no-owner --no-privileges -d <db> ~/MyInventoryBackups/pre-0003.dump`) and comparing `SELECT count(*) FROM inventory_items` with production.

**Images.**

- **Railway volume backup:** if available, take one in the Railway dashboard for the service's volume. This is the only backup that also captures files no row references.
- **`ebbbac2` backup script:** run the previous version of `scripts/backup.ts` from a clean copy, so it cannot pick up `.env` or the new script. Start in the repository root:
  ```bash
  mkdir -p ~/MyInventoryBackups/backup-tool-ebbbac2
  git archive ebbbac2 | tar -x -C ~/MyInventoryBackups/backup-tool-ebbbac2
  ln -s "$PWD/node_modules" ~/MyInventoryBackups/backup-tool-ebbbac2/node_modules
  cd ~/MyInventoryBackups/backup-tool-ebbbac2
  read -rs "DATABASE_URL?Production connection string: " && echo && export DATABASE_URL
  read -rs "INVENTORY_PASSWORD?App password: " && echo && export INVENTORY_PASSWORD
  APP_URL=https://<your-app>.up.railway.app BACKUP_DIR=~/MyInventoryBackups pnpm backup
  unset DATABASE_URL INVENTORY_PASSWORD
  ```
  It writes a `0002_analysis_metadata` archive. Verify it with the current `pnpm restore:verify`, which accepts 0002 archives, using a disposable database that has migration 0003 applied as `DATABASE_URL_TEST`.

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

If it returns rows, take a database backup (a Neon branch or `pg_dump`; see [Pre-migration backups](#pre-migration-backups)), then mark exactly those rows stale before rolling forward. Set `valuation.staleAt` to the current time and `valuation.staleReason` to `"reidentified_during_rollback"`; leave every other field unchanged so the estimate stays visible as stale. The app does not do this automatically. If the query returns no rows, no action is needed.

```sql
BEGIN;
UPDATE inventory_items
SET valuation = valuation || jsonb_build_object(
  'staleAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'staleReason', 'reidentified_during_rollback')
WHERE id IN ('<id from the check>', '<id from the check>');
COMMIT;
```

Old Analyze also leaves the `identification` record in place, so an item it touched can still show uncertainty notes and alternatives from the earlier identification, even when it has no valuation. This read-only check finds those items:

```sql
SELECT id, name, identification->>'identifiedAt' AS identified_at,
       analysis_metadata->>'timestamp' AS last_identification_write
FROM inventory_items
WHERE identification IS NOT NULL
  AND (analysis_metadata->>'timestamp')::timestamptz > (identification->>'identifiedAt')::timestamptz;
```

**After rolling forward, re-identify every item returned by either check** with the new app's Re-identify. Then review each affected valuation: re-estimate it, or leave it marked stale. Until an item is re-identified, its identification details may describe the earlier identification.

The checks, the mark-stale update, and the old app's behaviour on the migrated schema were rehearsed on a local disposable PostgreSQL database with synthetic data (not on Neon).
