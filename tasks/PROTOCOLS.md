# Inventory-AI Development Protocols

**Version:** 1.0
**Last Updated:** November 9, 2025
**Project:** myinventory-ai (Express + React + Neon PostgreSQL)

This document defines protocols for structured feature development in myinventory-ai, from PRD to tasks to delivery, with search and AI intake conventions.

---

## Table of Contents
1. [PRD Generation Protocol](#1-prd-generation-protocol)
2. [Task List Generation Protocol](#2-task-list-generation-protocol)
3. [Task Management Protocol](#3-task-management-protocol)
4. [Database & Test Data Cleanup Protocol](#4-database--test-data-cleanup-protocol)
5. [Project Conventions](#5-project-conventions)

---

## 1. PRD Generation Protocol

### Goal
Create a complete Markdown PRD from a brief prompt so a junior developer can implement the feature in myinventory-ai.

### Process
1. **Receive Prompt**
2. **Ask Clarifying Questions** focused on problem, user, data fields, search/filter needs, AI use, and acceptance criteria. Use brief lettered lists so the user can reply quickly.
3. **Generate PRD** using the structure below.
4. **Save** as `/tasks/[n]-prd-[feature-name].md` where `n` is a zero-padded sequence starting at `0001`.

### Clarifying Questions (inventory-specific)
- **Problem/Goal:** What user outcome is required? Capture, search, valuation, export.
- **Target User:** Single owner vs multi-user org.
- **Core Actions:** Add item (camera/upload), edit, bulk ops, search, export, share.
- **AI Use:** Which fields are AI-extracted? Required confidence threshold. Fallback behavior.
- **Search Needs:** Fields, filters, sort, semantic vs keyword, pagination.
- **Data Model:** Required columns, enums, tags, locations, quantities, barcodes.
- **Performance/Scale:** Max items and latency targets.
- **Security:** Auth scope, per-user ownership, rate limits on AI endpoints.
- **Non-Goals:** What is out of scope for this release.
- **Acceptance Criteria:** Exact UI flows, API shapes, and measurable success.

### PRD Structure
1. **Overview**
2. **Goals** (measurable)
3. **User Stories**
4. **Functional Requirements** (numbered "FR-#")
5. **Non-Goals**
6. **Design Considerations**
7. **Technical Considerations**
8. **Success Metrics**
9. **Decisions on Open Questions**

### Output
- **Format:** Markdown
- **Location:** `/tasks/`
- **Filename:** `[n]-prd-[feature-name].md`

### Final Instructions
- Do not implement.
- Ask clarifying questions first.
- Incorporate the answers and update the PRD.

---

## 2. Task List Generation Protocol

### Goal
Transform a specific PRD into an actionable task list for myinventory-ai.

### Output
- **Format:** Markdown
- **Location:** `/tasks/`
- **Filename:** `tasks-[prd-file-name].md`
  Example: `tasks-0003-prd-server-side-search.md`

### Process
1. **Receive PRD reference.**
2. **Analyze PRD** for FRs, data, and UX flows.
3. **Assess current state** of the repo:
   - Backend: `/server/routes.ts`, `/server/storage.ts`, `/server/db/*`, `/server/ai/*`
   - Frontend: `/client/src/pages/*`, `/client/src/components/*`, `/client/src/lib/*`
   - Schema/Migrations: `/server/db/migrations/*`
   - Tests: `/server/tests/*`, `/client/src/__tests__/*`
4. **Phase 1: Parent Tasks.** Propose ~5 high-level tasks. Output only parent tasks and the line:
   **"I have generated the high-level tasks based on the PRD. Ready to generate the sub-tasks? Respond with 'Go' to proceed."**
5. **Wait for "Go."**
6. **Phase 2: Sub-Tasks.** Break each parent into numbered sub-tasks.
7. **Relevant Files.** List files to create or modify, plus tests.
8. **Save** as `tasks-[prd-file-name].md`.

### Task List Format
```markdown
## Relevant Files
- server/routes.ts — HTTP routes for items/search/uploads
- server/storage.ts — DB queries (Drizzle or SQL)
- server/db/migrations/2025xxxx.sql — schema update
- server/tests/search.spec.ts — API tests for search
- client/src/pages/Home.tsx — search UI and list view
- client/src/lib/api.ts — fetch helpers and query client

### Notes
- Use Vitest for unit/integration. Supertest for API. Playwright for e2e.
- Keep tests deterministic with seeded data.

## Tasks
- [ ] 1.0 Parent Task Title
  - [ ] 1.1 Sub-task
  - [ ] 1.2 Sub-task
- [ ] 2.0 Parent Task Title
  - [ ] 2.1 Sub-task
```

---

## 3. Task Management Protocol

### Goal
Execute a task list with incremental commits and robust status tracking.

### Process
1. **Receive Task List.**
2. **Acknowledge** and confirm parent tasks.
3. **For Each Task:**
   - Mark as in_progress.
   - Make the necessary edits/creates.
   - Run tests or manual verification.
   - Mark as completed.
4. **Commit** after meaningful milestones (e.g., one parent task or 3-5 sub-tasks).
5. **Final Report** summarizing completion.

### Commit Conventions
- Use semantic prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- Message format: `<type>: <summary> (#<task-id>)`
- Example: `feat: add server-side search endpoint (#1.1)`

### Status Updates
- Use TodoWrite tool frequently (mark in_progress → completed).
- Never skip marking tasks as completed.
- If blocked, create new task describing the blocker.

---

## 4. Database & Test Data Cleanup Protocol

### Goal
Keep dev/test databases clean after feature completion or testing.

### Trigger Events
- After completing a feature with schema changes
- After running integration/e2e tests
- Weekly maintenance (scheduled)
- Before production deployment

### Process
1. **Identify Test Data**
   - Check for items with test names, test barcodes, or test tags
   - Look for orphaned images in GCS with no DB reference
   - Find items created during test runs (specific date ranges)

2. **Migration Cleanup**
   - Ensure all migrations have been applied
   - Check for failed/partial migrations
   - Verify schema consistency with `drizzle-kit push`

3. **Cleanup Commands**
   ```sql
   -- Remove test items
   DELETE FROM inventory_items WHERE name LIKE '%test%' OR name LIKE '%TEST%';

   -- Remove items without images
   DELETE FROM inventory_items WHERE image_url IS NULL OR image_url = '';

   -- Remove orphaned tags
   -- (if tags table exists)
   ```

4. **GCS Cleanup**
   - List all objects in `items/` bucket
   - Cross-reference with DB `image_url` values
   - Delete orphaned files
   ```bash
   gsutil ls gs://your-bucket/items/ > gcs-files.txt
   # Compare with DB query and delete orphans
   ```

5. **Verification**
   - Run item count queries
   - Check image accessibility
   - Verify search indices are up to date
   - Test critical user flows

### Frequency
- **Daily:** During active development
- **Weekly:** During maintenance periods
- **Pre-deployment:** Always before production push

---

## 5. Project Conventions

### File Organization
```
myinventory-ai/
├── server/
│   ├── routes.ts          # API endpoints
│   ├── storage.ts         # DB abstraction layer
│   ├── openai.ts          # AI image analysis
│   ├── objectStorage.ts   # GCS integration
│   ├── db/
│   │   ├── index.ts       # Drizzle setup
│   │   └── migrations/    # SQL migrations
│   └── tests/             # Backend tests
├── client/
│   ├── src/
│   │   ├── pages/         # Route pages
│   │   ├── components/    # React components
│   │   ├── lib/           # API clients, utils
│   │   └── __tests__/     # Frontend tests
├── shared/
│   └── schema.ts          # Shared types/schema
└── tasks/
    ├── PROTOCOLS.md       # This file
    ├── [n]-prd-*.md       # PRDs
    └── tasks-*.md         # Task lists
```

### Technology Standards
- **Backend:** Express + TypeScript, Drizzle ORM
- **Frontend:** React + TypeScript, TanStack Query, Tailwind
- **Database:** PostgreSQL (Neon), pgvector for embeddings
- **AI:** OpenAI GPT-5 (vision), text-embedding-3-small
- **Storage:** Google Cloud Storage
- **Testing:** Vitest (unit), Supertest (API), Playwright (e2e)

### Code Quality
- TypeScript strict mode enabled
- Zod schemas for API validation
- Error handling with ApiError class
- ESLint + Prettier for formatting
- Commit hooks with Husky (if configured)

### API Conventions
- RESTful routes: `/api/items`, `/api/items/:id`
- Error responses: `{ error: string }`
- Success responses: `{ data: T }` or direct object
- Pagination: `?limit=20&offset=0`
- Search: `?q=query&category=Electronics&minValue=0`

### Search Conventions
- Server-side search required for >100 items
- PostgreSQL full-text search for keyword queries
- Semantic search for conceptual queries
- Debounce client input (300ms)
- Max 100 results per page

### AI Integration Guidelines
- All AI calls must have timeout (30s max)
- Cache embeddings in database
- Rate limit: 10 requests/min per user
- Fallback behavior for AI failures
- Log confidence scores for monitoring

### Security Requirements
- All routes require authentication (except public assets)
- Input validation on all endpoints
- SQL injection prevention via parameterized queries
- XSS prevention via React auto-escaping
- CORS configured for production domain only
- Rate limiting on expensive endpoints

---

## Version History
- **1.0** (2025-11-09): Initial protocols for myinventory-ai