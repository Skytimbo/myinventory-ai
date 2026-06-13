---
version: 1
last_updated: 2025-11-13
project_name: myinventory-ai
audit_phase: 1
format_spec: v1-phase1-yaml-front-matter-sections-0-15
source_commit: "683dd31d18875a9cf9620678bd89f315c4ac7002"
machine_readable_index: ".context_audit/doc_inventory.csv"
verification:
  sha256_of_this_file: "3472f8a99b0f43828a61d459b577f107fe9aa2d2513fec673cf21aa4cf9f63cc"
sources:
  - path: FOUNDATION.md
    role: foundational-architecture
    canonical: true
  - path: tasks/0001-prd-quick-fixes.md
    role: prd-task-plan
    canonical: true
  - path: tasks/tasks-0001-prd-quick-fixes.md
    role: prd-task-plan-duplicate
    canonical: false
    status: deprecated
  - path: tasks/PROTOCOLS.md
    role: process-protocols
    canonical: true
  - path: CHANGELOG.md
    role: release-history
    canonical: true
  - path: design_guidelines.md
    role: design-style
    canonical: true
  - path: replit.md
    role: historic-ops-notes
    canonical: false
    status: archived
---

# CONTEXT.md

[![Context Guard](https://github.com/Skytimbo/myinventory-ai/actions/workflows/context-guard.yml/badge.svg)](https://github.com/Skytimbo/myinventory-ai/actions/workflows/context-guard.yml)

**Project Context & Documentation Map**
This file provides a comprehensive snapshot of the myinventory-ai codebase, its documentation, architecture, and current state. It serves as the entry point for understanding the project structure and navigating key resources.

---

## Section 0: Quick Reference

**What is this project?**
MyInventory AI is an intelligent inventory management system that leverages AI-powered image recognition to catalog and manage household items. Users can capture photos, automatically extract metadata via OpenAI GPT-4o-mini / GPT-4o vision analysis, generate tracking barcodes, and estimate resale values with confidence indicators.

**Tech Stack:**
- **Frontend:** React 18+ (TypeScript), Vite, Wouter, TanStack Query, shadcn/ui, Tailwind CSS
- **Backend:** Express (Node.js), TypeScript, Drizzle ORM
- **Database:** Neon PostgreSQL (serverless)
- **AI/ML:** OpenAI API (GPT-4o-mini cheap + GPT-4o premium fallback)
- **Storage:** Local filesystem (Railway persistent volume in production)
- **Testing:** Vitest, Playwright (E2E)
- **Linting:** ESLint 9 + Prettier
- **Package Manager:** pnpm 10.20.0+

**Current Phase:** Feature development — Quick Capture mode and architecture refactoring

**Main Branch:** `main`

---

## Section 1: Documentation Inventory

### Phase 1 Audit Results (2025-11-11)

| Path | Size | Last Modified | Role | Canonical | Status |
|------|------|---------------|------|-----------|--------|
| `FOUNDATION.md` | 69,897 bytes | 2025-11-13 | Architectural Principles | ✓ | Active |
| `tasks/0001-prd-quick-fixes.md` | 25,255 bytes | 2025-11-09 20:17:37 | PRD - Technical Debt Fixes | ✓ | Active |
| `tasks/tasks-0001-prd-quick-fixes.md` | 14,133 bytes | 2025-11-09 20:17:37 | PRD (duplicate) | ✗ | **DEPRECATED** |
| `tasks/PROTOCOLS.md` | 9,264 bytes | 2025-11-09 20:17:37 | Development Process Guidelines | ✓ | Active |
| `CHANGELOG.md` | 1,680 bytes | 2025-11-09 20:39:52 | Release History | ✓ | Active |
| `design_guidelines.md` | 7,649 bytes | 2025-11-07 11:42:10 | UI/UX Design Standards | ✓ | Active |
| `replit.md` | 5,981 bytes | 2025-11-09 20:17:37 | Project Overview & Architecture | ✓ | Active |
| `CONTEXT.md` | — | 2025-11-13 | Documentation Map (this file) | ✓ | Active |

**Audit Artifacts:**
- Full inventory: `.context_audit/doc_inventory.csv`
- File snippets: `.context_audit/snippets/` (first 5 lines of each file)

**Deprecation Notice:**
`tasks/tasks-0001-prd-quick-fixes.md` is deprecated. Use `tasks/0001-prd-quick-fixes.md` as the canonical reference.

---

## Section 2: Repository Structure

```
myinventory-ai/
├── client/src/              # React frontend
│   ├── components/          # UI components (ItemCard, Dashboard, CameraCapture, etc.)
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # API client, query config, upload helpers
│   ├── pages/               # Route pages (home.tsx is the main SPA page)
│   └── __tests__/           # Client unit tests
├── server/                  # Express backend
│   ├── index.ts             # Server entry point & bootstrap
│   ├── routes.ts            # HTTP route definitions (thin layer)
│   ├── services.ts          # DI container (AppServices) + test fakes
│   ├── analyzer.ts          # IAnalyzer interface, OpenAIAnalyzer, MockAnalyzer
│   ├── itemService.ts       # Business logic (item CRUD, AI analysis)
│   ├── storage.ts           # DatabaseStorage (Drizzle/Neon)
│   ├── objectStorage.ts     # Local filesystem image storage
│   ├── openai.ts            # OpenAI client factory (cheap + premium)
│   ├── fileValidation.ts    # MIME magic-number validation
│   ├── errors.ts            # ApiError class + async handler wrapper
│   ├── health/              # Health check endpoints
│   └── tests/               # Server unit tests
├── shared/schema.ts         # DB schema + Zod types (single source of truth)
├── scripts/                 # Dev utility scripts (db-seed, db-reset, enforce-pnpm)
├── tasks/                   # PRDs (0001–0010) & execution plans
├── e2e/                     # Playwright E2E tests
├── migrations/              # SQL migration files
├── docs/                    # Setup guides, ADRs
├── FOUNDATION.md            # Architectural principles & evolution roadmap
├── README.md                # Project overview & quick start
├── CONTEXT.md               # This file
├── CHANGELOG.md             # Release history
├── eslint.config.mjs        # ESLint configuration
├── vite.config.ts           # Vite + client test config
├── drizzle.config.ts        # Drizzle ORM config
└── playwright.config.ts     # E2E test config
```

---

## Section 3: Architecture Overview

### System Design

**Architecture Pattern:** Full-stack monorepo with separate client/server directories

**Frontend Architecture:**
- React 18+ with TypeScript for type-safe components
- Wouter for lightweight routing
- TanStack Query for server state & caching
- shadcn/ui (New York variant) + Radix UI primitives
- Tailwind CSS with custom design tokens
- Mobile-first responsive (breakpoints: 640px, 1024px, 1280px)
- Design philosophy: Linear minimalism + Pinterest image-centric + Notion clean data

**Backend Architecture:**
- Express.js with TypeScript
- Drizzle ORM for type-safe database queries
- Neon PostgreSQL serverless database
- RESTful API design
- Standardized error handling (`{error, code}` format)
- Environment-aware error responses (verbose in dev, minimal in prod)

**Key Integrations:**
- OpenAI API for GPT-4o-mini / GPT-4o Vision image analysis (tiered: cheap first, premium fallback if confidence < 0.4)
- Local filesystem storage for uploaded images (Railway persistent volume in production)
- Barcode generation for inventory items
- PDF/CSV export functionality

**Data Flow:**
1. User captures/uploads image → Frontend (React + Uppy)
2. Image sent to backend → Express API
3. Image stored → Object storage
4. Metadata extracted → OpenAI Vision API
5. Data persisted → PostgreSQL (Neon)
6. Results cached → TanStack Query
7. UI updated → React components

### Foundational Principles

MyInventory AI follows 7 core architectural principles defined in `FOUNDATION.md`:

1. **Media as First-Class Concept** - Items will evolve to support multiple media assets (images, PDFs, videos), not just a single imageUrl
2. **Storage as Environment-Agnostic Abstraction** - IObjectStorage interface with local filesystem implementation; designed for future cloud backend extensions
3. **Upload as Pluggable Mechanism** - Reusable upload utilities (`uploadService.ts`), decoupled from page components
4. **Containers as Hierarchical Entities** - Future support for property → room → box → item hierarchy using adjacency list pattern
5. **Extensible Attributes as Flexible Data** - Framework for vertical-specific fields (auto parts, insurance) using JSONB or separate tables
6. **Search as First-Class Concern** - Architecture designed for full-text search + structured filters with PostgreSQL indexing
7. **Tests as Behavior Assertions** - E2E tests assert user behavior, not implementation details; maintain determinism through API stubbing

See [FOUNDATION.md](./FOUNDATION.md) for complete guidance, evolution roadmap, integration patterns, and anti-patterns.

---

## Section 4: Core Features

### Current Features (as of 2025-11-11)

1. **Image Capture & Upload**
   - Camera capture via react-webcam
   - Batch upload via Uppy file uploader
   - Robust loading states with skeletons
   - Error handling with retry capability
   - Memory leak fixed (useState → useRef pattern)

2. **AI-Powered Metadata Extraction**
   - OpenAI GPT-4o-mini / GPT-4o Vision API (tiered analysis)
   - Automatic item description generation
   - Resale value estimation with confidence indicators (low/medium/high)
   - Category/tag suggestions

3. **Quick Capture Mode**
   - Toggle to skip AI analysis during upload for bulk cataloging
   - Items saved immediately with placeholder metadata ("Untitled Item")
   - Deferred AI analysis via dedicated endpoint (`POST /api/items/:id/analyze`)

4. **Multi-Image Support**
   - Upload up to 10 images per item
   - Image gallery viewer with navigation
   - Both single (`image`) and multi (`images`) upload fields supported

5. **Inventory Management**
   - Item cataloging with photos
   - Barcode generation & download
   - Optional storage location tagging
   - Advanced filtering (location badges, date ranges, value ranges)

4. **Search & Discovery**
   - Debounced search (300ms) for performance
   - Filter by location, date, tags
   - Sort by various criteria

5. **Export & Reporting**
   - Professional PDF export
   - Barcode downloads
   - Data persistence

### In Progress (PRD 0001 - Technical Debt Fixes)

- ✅ Fix Uppy memory leak
- ✅ Add search debouncing
- ✅ Standardize error handling
- ✅ Add image loading fallbacks
- 🚧 CI/CD pipeline with E2E tests

---

## Section 5: Development Protocols

**See:** `tasks/PROTOCOLS.md` for complete guidelines

### Key Protocols Summary

1. **PRD Generation Protocol**
   - Create complete Markdown PRD from brief prompts
   - Ask clarifying questions (problem, user, data, search, AI, acceptance)
   - Save as `/tasks/[n]-prd-[feature-name].md` (zero-padded sequence)
   - Include: Overview, Goals, User Stories, Scope, Technical Details, Acceptance Criteria

2. **Task List Generation Protocol**
   - Break PRD into atomic, sequential tasks
   - Use task IDs: `[n]-[phase]-[seq]` (e.g., `0001-impl-01`)
   - Include dependencies, estimates, acceptance criteria
   - Save as `/tasks/tasks-[n]-prd-[feature-name].md`

3. **Task Management Protocol**
   - Update status: TODO → IN_PROGRESS → DONE → VERIFIED
   - Test after each task
   - Commit with descriptive messages
   - Track blockers and dependencies

4. **Database & Cleanup Protocol**
   - Use `pnpm db:reset` and `pnpm db:seed` for clean state
   - Test data cleanup via scripts
   - Environment-specific configurations

---

## Section 6: Getting Started

### Prerequisites

- Node.js ≥20.10.0
- pnpm ≥10.20.0 (enforced via preinstall script)
- PostgreSQL database (Neon recommended)
- OpenAI API key

### Installation

```bash
# Clone repository
git clone <repository-url>
cd myinventory-ai

# Install dependencies (pnpm enforced)
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with DATABASE_URL, OPENAI_API_KEY, etc.
# Set INVENTORY_PASSWORD before deploying publicly

# Set up database
pnpm db:push
pnpm db:seed

# Start development server
pnpm dev
```

### Development Commands

```bash
pnpm dev              # Start dev server (client + backend, PORT or 5000)
pnpm dev:api          # API-only server (for E2E testing)
pnpm dev:ui           # Vite dev server only (port 5174, proxies to 5000)
pnpm build            # Build for production
pnpm start            # Run production build
pnpm check            # TypeScript type checking
pnpm lint             # ESLint check
pnpm format           # Prettier format
pnpm test             # Run all tests
pnpm test:server      # Server unit tests
pnpm test:client      # Client unit tests
pnpm e2e              # Playwright E2E tests
pnpm db:push          # Push schema changes
pnpm db:reset         # Reset database
pnpm db:seed          # Seed test data
```

---

## Section 7: Testing Strategy

### Test Pyramid

**Unit Tests** (Vitest)
- Server: API routes, error handling, business logic
- Client: Component behavior, hooks, utilities
- Coverage targets: Error middleware, Uppy cleanup, search debouncing

**Integration Tests** (Vitest)
- API endpoint integration
- Database operations
- Service layer interactions

**E2E Tests** (Playwright)
- Critical user flows
- Image upload scenarios
- Search & filter functionality
- Image loading fallback scenarios
- CI integration with trace upload on failures
- **E2E determinism:** `/api/items` is stubbed to return a plain array with camelCase fields. Images use a deterministic 404 → retry → 200 flow with a 1×1 PNG. Base URL is `http://localhost:5173` with dual web servers (UI 5173, API 5000). Traces/videos/screenshots are uploaded as CI artifacts on failure.

### Test Commands

```bash
pnpm test              # All tests
pnpm test:server       # Server tests only
pnpm test:client       # Client tests only
pnpm e2e               # E2E tests
```

### CI/CD Pipeline

- Separate jobs: server tests, client tests, E2E tests
- PostgreSQL service for E2E
- Database reset/seed before E2E
- Playwright trace upload on failures
- pnpm-only enforcement

---

## Section 8: Design System

**See:** `design_guidelines.md` for complete specifications

### Design Philosophy

**Approach:** Hybrid design combining:
- Linear's minimal dashboard aesthetics
- Pinterest's image-centric card layouts
- Notion's clean data organization

**Principles:**
1. Mobile-first responsive layout
2. Image-forward presentation
3. Efficient data scanning with clear hierarchy
4. Touch-friendly interactions

### Typography

**Fonts:**
- Primary: Inter (400, 500, 600) - UI, labels, body
- Monospace: JetBrains Mono (400, 500) - barcodes, IDs, values

**Scale:**
- Hero/Page Title: `text-4xl md:text-5xl font-semibold`
- Section Headers: `text-2xl md:text-3xl font-semibold`
- Card Titles: `text-lg font-medium`
- Body Text: `text-base`
- Labels/Meta: `text-sm font-medium`
- Captions: `text-xs`

### Color System

Built on Tailwind's color primitives with custom CSS variables for theming.

---

## Section 9: API Reference

> **Source of Truth:** `server/routes.ts`
> **Machine-Readable Index:** `.context_audit/api_endpoints.json`

### Base URL

- Development: `http://localhost:$PORT` (default `5000`)
- Production: `https://myinventory-ai-production.up.railway.app` (Railway)

### Endpoints

**Public Health**
```
GET    /api/health          # Minimal liveness check: { ok: true }
```

**Authentication**
```
GET    /api/auth/status     # Session state and whether password auth is enabled
POST   /api/auth/login      # Create password-backed session
POST   /api/auth/logout     # Destroy session
```

**Protected Health**
```
GET    /api/health/openai       # OpenAI environment/configuration check
GET    /api/health/openai/live  # Live OpenAI connectivity check
```

**Protected Inventory Items**
```
GET    /api/items           # List all items
GET    /api/items/:id       # Get single item
POST   /api/items           # Create item with image upload (multipart/form-data)
                            # Accepts: images[] (up to 10) or image (single, legacy)
                            # Optional: skipAI=true for Quick Capture mode
DELETE /api/items/:id       # Delete item
POST   /api/items/:id/analyze  # Run AI analysis on existing item (Quick Capture deferred analysis)
POST   /api/items/:id/reanalyze # Re-run AI analysis on existing item
```

**Protected Object Storage**
```
GET    /objects/:objectPath # Serve stored images
```

### Error Response Format

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE_CONSTANT"
}
```

**Standard Error Codes:**
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Invalid input
- `AUTH_REQUIRED` - Login required
- `INVALID_PASSWORD` - Password login failed
- `LOGIN_RATE_LIMITED` - Too many login attempts
- `AI_RATE_LIMITED` - Too many AI-backed requests
- `UPSTREAM_AI` - OpenAI API error
- `UNHANDLED` - Unexpected server error

---

## Section 10: Database Schema

**ORM:** Drizzle
**Database:** Neon PostgreSQL (serverless)

### Core Tables

**inventory_items**
- `id` (varchar, primary key, default: `gen_random_uuid()` - PostgreSQL UUID)
- `name` (text, not null)
- `description` (text, not null)
- `category` (text, not null)
- `tags` (text[], not null, default: empty array)
- `image_url` (text, not null) — primary/legacy single image
- `image_urls` (text[], optional) — multi-image support (PRD 0004)
- `barcode_data` (text, not null)
- `estimated_value` (decimal(10,2), optional)
- `value_confidence` (text, optional)
- `value_rationale` (text, optional)
- `location` (text, optional)
- `analysis_metadata` (jsonb, optional) — AI provenance/diagnostics
- `created_at` (text, not null, default: CURRENT_TIMESTAMP)

### Schema Management

```bash
pnpm db:push    # Push schema changes to database
pnpm db:reset   # Drop all tables and recreate
pnpm db:seed    # Populate with test data
```

Configuration: `drizzle.config.ts`
Schema: `shared/schema.ts`

---

## Section 11: Environment Configuration

### Required Variables

```bash
DATABASE_URL=postgresql://user:pass@host/db   # Neon PostgreSQL
OPENAI_API_KEY=sk-...                          # OpenAI API key
OPENAI_PROJECT_ID=proj-...                     # Required for sk-proj-* keys
SESSION_SECRET=...                             # Required in production
INVENTORY_PASSWORD=...                         # Required in production
```

### Optional Variables

```bash
NODE_ENV=development|production|api-only       # api-only = headless for E2E
PORT=5000                                      # Server port (default: 5000)
LOCAL_STORAGE_DIR=./uploads                    # Image storage dir (default: ./uploads)
OPENAI_BASE_URL=https://api.openai.com/v1     # Override OpenAI endpoint
ANALYZER_PROVIDER=openai|mock                  # Use mock to skip AI in development
CORS_ORIGIN=https://your-domain.com            # Allowed origin in production
```

### Environment Files

- `.env` - Local development (gitignored)
- `.env.example` - Template with documentation
- CI/CD secrets configured in GitHub Actions

### Storage

MyInventory AI uses local filesystem storage (`ObjectStorageService` in `server/objectStorage.ts`):
- **Development:** `./uploads/` directory
- **Production (Railway):** `/app/uploads` with persistent volume mount

The storage service implements `IObjectStorage` interface with `save()`, `read()`, and `download()` methods, supporting both single and multi-image storage paths.

---

## Section 12: Recent Changes

**See:** `CHANGELOG.md` for complete history

### Latest Updates (Unreleased)

**Fixed:**
- Memory leak in Uppy file uploader (useState → useRef with cleanup)
- Image loading fallbacks with skeleton, error placeholder, retry
- Accessibility: ARIA labels for image errors, keyboard-accessible retry

**Performance:**
- Search debouncing (300ms) to reduce redundant queries

**Changed:**
- Standardized API error responses (`{error, code}` format)
- Production-grade error handling with ApiError class
- Environment-aware error details

**Tests:**
- Server unit tests for error handling
- Client unit tests for ObjectUploader cleanup and search debouncing
- E2E tests for image loading fallbacks
- Playwright integrated into CI pipeline

**CI/CD:**
- pnpm-only enforcement
- Separate test jobs (server, client, E2E)
- Playwright trace upload on failures

---

## Section 13: Current Work

### Active Branch: `feature/quick-capture`

**Focus:** Quick Capture mode for bulk cataloging + architecture refactoring

**Status:**
- ✅ Quick Capture UI toggle (skip AI on upload)
- ✅ Deferred AI analysis endpoint (`POST /api/items/:id/analyze`)
- ✅ IAnalyzer strategy pattern (OpenAIAnalyzer, MockAnalyzer)
- ✅ ItemService extraction from routes
- ✅ IObjectStorage interface
- ✅ Test fakes in services.ts (FakeDatabaseStorage, FakeObjectStorageService, FakeAnalyzer)
- ✅ ESLint + Prettier configured
- ✅ Dead code cleanup (modelPolicy.ts removed)

### Completed PRDs

- PRD 0001: Technical debt fixes (Uppy memory leak, debounce, error handling)
- PRD 0004: Multi-image upload support
- PRD 0006: Automatic value estimation
- PRD 0007: OpenAI dead code cleanup
- PRD 0008: Cloudflare Tunnel for mobile testing
- PRD 0009: Replit deployment
- PRD 0010: Quick Capture mode (in progress)

---

## Section 14: Known Issues & Limitations

### Current Limitations

1. **Single User:** Password-protected session auth only; no multi-user roles/tenancy yet
2. **Object Storage:** Configuration required for image uploads
3. **AI Rate Limits:** Basic per-IP limits only; OpenAI account quota still applies
4. **Mobile App:** Web-only (no native mobile app)
5. **Offline Support:** Requires internet connection

### Technical Debt

**Recently Addressed:**
- ✅ Uppy memory leak
- ✅ Search performance (debouncing)
- ✅ Error handling consistency
- ✅ Image loading fallbacks

**Remaining:**
- Test coverage expansion (unit tests)
- Performance optimization (large inventories)
- Accessibility audit
- Internationalization (i18n)

---

## Section 15: Contributing & Maintenance

### Development Workflow

1. **Check protocols:** Review `tasks/PROTOCOLS.md`
2. **Create PRD:** Use PRD generation protocol for features
3. **Break into tasks:** Generate task list from PRD
4. **Branch:** Create feature branch from `main`
5. **Develop:** Follow atomic commits, test frequently
6. **Test:** Run unit, integration, and E2E tests
7. **PR:** Submit pull request with clear description
8. **Review:** Address feedback
9. **Merge:** Squash or merge to `main`

### Code Style

- **TypeScript:** Strict mode enabled
- **Linting:** ESLint 9 (flat config) with TypeScript + React hooks rules
- **Formatting:** Prettier (`printWidth: 100`, double quotes, trailing commas)
- **Naming:** camelCase for variables/functions, PascalCase for components
- **Commits:** Conventional commits format preferred

### Package Management

- **Required:** pnpm ≥10.20.0
- **Enforced:** preinstall script rejects npm/yarn
- **Lockfile:** `pnpm-lock.yaml` (commit to version control)

### Documentation Updates

- Update `CHANGELOG.md` for user-facing changes
- Update `CONTEXT.md` after major structural changes
- Update `design_guidelines.md` for UI/UX changes
- Keep `tasks/PROTOCOLS.md` current with process improvements

---

## Appendix: Audit Metadata

**Audit Date:** 2025-11-11
**Audit Script:** `.context_audit/` directory created
**Files Scanned:** 6 markdown files
**Deprecated Files:** 1 (`tasks/tasks-0001-prd-quick-fixes.md`)
**Canonical PRD:** `tasks/0001-prd-quick-fixes.md`
**Git Commit (audit baseline):** `60d8ef62c510e7f64fbb719adf393bcb2f44a7f4`

**Audit Command:**
```bash
# Reproduce audit
find . -type f -iname "*.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  | xargs ls -lh
```

---

**Document Status:** Active
**Next Review:** After major architectural changes or quarterly
**Maintainer:** [Project team]
**Questions?** See `tasks/PROTOCOLS.md` or repository documentation
