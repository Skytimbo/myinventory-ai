---
version: 1
last_updated: 2025-11-11
project_name: myinventory-ai
audit_phase: 1
format_spec: v1-phase1-yaml-front-matter-sections-0-15
source_commit: "60d8ef62c510e7f64fbb719adf393bcb2f44a7f4"
machine_readable_index: ".context_audit/doc_inventory.csv"
verification:
  sha256_of_this_file: "7997df4f6aaba5c553116c0d4ac633c1bc818a7926dae04cd458c669536fdb00"
sources:
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
MyInventory AI is an intelligent inventory management system that leverages AI-powered image recognition to catalog and manage household items. Users can capture photos, automatically extract metadata via GPT-5 vision analysis, generate tracking barcodes, and estimate resale values with confidence indicators.

**Tech Stack:**
- **Frontend:** React 18+ (TypeScript), Vite, Wouter, TanStack Query, shadcn/ui, Tailwind CSS
- **Backend:** Express (Node.js), TypeScript, Drizzle ORM
- **Database:** Neon PostgreSQL (serverless)
- **AI/ML:** OpenAI API (GPT-5 Vision)
- **Storage:** Object storage for images
- **Testing:** Vitest, Playwright (E2E)
- **Package Manager:** pnpm 10.20.0+

**Current Phase:** Early development - technical debt resolution and CI/CD establishment

**Main Branch:** `main`
**Current Branch:** `chore/e2e-ci-enable`

---

## Section 1: Documentation Inventory

### Phase 1 Audit Results (2025-11-11)

| Path | Size | Last Modified | Role | Canonical | Status |
|------|------|---------------|------|-----------|--------|
| `tasks/0001-prd-quick-fixes.md` | 25,255 bytes | 2025-11-09 20:17:37 | PRD - Technical Debt Fixes | ✓ | Active |
| `tasks/tasks-0001-prd-quick-fixes.md` | 14,133 bytes | 2025-11-09 20:17:37 | PRD (duplicate) | ✗ | **DEPRECATED** |
| `tasks/PROTOCOLS.md` | 9,264 bytes | 2025-11-09 20:17:37 | Development Process Guidelines | ✓ | Active |
| `CHANGELOG.md` | 1,680 bytes | 2025-11-09 20:39:52 | Release History | ✓ | Active |
| `design_guidelines.md` | 7,649 bytes | 2025-11-07 11:42:10 | UI/UX Design Standards | ✓ | Active |
| `replit.md` | 5,981 bytes | 2025-11-09 20:17:37 | Project Overview & Architecture | ✓ | Active |
| `CONTEXT.md` | — | 2025-11-11 | Documentation Map (this file) | ✓ | Active |

**Audit Artifacts:**
- Full inventory: `.context_audit/doc_inventory.csv`
- File snippets: `.context_audit/snippets/` (first 5 lines of each file)

**Deprecation Notice:**
`tasks/tasks-0001-prd-quick-fixes.md` is deprecated. Use `tasks/0001-prd-quick-fixes.md` as the canonical reference.

---

## Section 2: Repository Structure

```
myinventory-ai/
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Utilities
│   │   └── pages/       # Route pages
│   └── index.html       # Entry point
├── server/              # Express backend
│   ├── index.ts         # Server entry
│   ├── routes.ts        # API routes
│   ├── db/              # Database schema & migrations
│   └── services/        # Business logic
├── scripts/             # Build & utility scripts
│   ├── db-reset.ts      # Database reset
│   └── db-seed.ts       # Test data seeding
├── tasks/               # PRDs & task documentation
│   ├── 0001-prd-quick-fixes.md  # (canonical)
│   ├── tasks-0001-prd-quick-fixes.md  # DEPRECATED
│   └── PROTOCOLS.md     # Development protocols
├── e2e/                 # Playwright E2E tests
├── dist/                # Build output
├── .context_audit/      # Documentation audit artifacts
├── design_guidelines.md # UI/UX standards
├── replit.md            # Architecture overview
├── CHANGELOG.md         # Release notes
├── CONTEXT.md           # This file
├── package.json         # Dependencies & scripts
├── vite.config.ts       # Vite configuration
├── drizzle.config.ts    # Database configuration
└── playwright.config.ts # E2E test configuration
```

**Tree Output:**
See `.context_audit/tree.txt` for full repository structure listing.

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
- OpenAI API for GPT-5 Vision image analysis
- Object storage for user-uploaded images
- Barcode generation for inventory items
- PDF export functionality

**Data Flow:**
1. User captures/uploads image → Frontend (React + Uppy)
2. Image sent to backend → Express API
3. Image stored → Object storage
4. Metadata extracted → OpenAI Vision API
5. Data persisted → PostgreSQL (Neon)
6. Results cached → TanStack Query
7. UI updated → React components

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
   - GPT-5 Vision API integration
   - Automatic item description generation
   - Resale value estimation with confidence indicators
   - Category/tag suggestions

3. **Inventory Management**
   - Item cataloging with photos
   - Barcode generation & download
   - Optional storage location tagging
   - Advanced filtering (location badges, date ranges)

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

# Set up database
pnpm db:push
pnpm db:seed

# Start development server
pnpm dev
```

### Development Commands

```bash
pnpm dev              # Start dev server (client + backend)
pnpm build            # Build for production
pnpm start            # Run production build
pnpm check            # TypeScript type checking
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

- Development: `http://localhost:5000`
- Production: [TBD]

### Endpoints

**Inventory Items**
```
GET    /api/items           # List all items
GET    /api/items/:id       # Get single item
POST   /api/items           # Create item with image upload (multipart/form-data)
DELETE /api/items/:id       # Delete item
```

**Object Storage**
```
POST   /api/objects/upload  # Get upload URL for object storage
GET    /objects/:objectPath # Serve objects (images)
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
- `image_url` (text, not null)
- `barcode_data` (text, not null)
- `estimated_value` (decimal(10,2), optional)
- `value_confidence` (text, optional)
- `value_rationale` (text, optional)
- `location` (text, optional)
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
# Database
DATABASE_URL=postgresql://user:pass@host/db

# OpenAI
OPENAI_API_KEY=sk-...

# Object Storage
STORAGE_ENDPOINT=...
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...

# Application
NODE_ENV=development|production
PORT=5000
```

### Environment Files

- `.env` - Local development (gitignored)
- `.env.example` - Template with documentation
- CI/CD secrets configured in pipeline

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

### Active Branch: `chore/e2e-ci-enable`

**Recent Commits:**
```
60d8ef6 fix(e2e): add nanoid as runtime dep and use standard ESM import
eb9f892 fix: add nanoid to dependencies
e3bd130 fix: use explicit nanoid import path for Node.js ESM compat
ac5c823 test(db): use pg for reset/seed in CI; keep TCP-compatible defaults
ba4a0fb ci: add Postgres service; seed DB; wire e2e to webServer
```

**Focus:** Establishing robust CI/CD pipeline with E2E testing

**Status:**
- ✅ E2E tests written (Playwright)
- ✅ CI pipeline configured
- ✅ PostgreSQL service in CI
- ✅ Database reset/seed automation
- 🚧 Final validation & merge

### Next Priorities

1. Complete E2E CI validation
2. Merge technical debt fixes (PRD 0001)
3. Plan next feature (PRD 0002)

---

## Section 14: Known Issues & Limitations

### Current Limitations

1. **Single User:** No authentication/multi-tenancy yet
2. **Object Storage:** Configuration required for image uploads
3. **AI Rate Limits:** OpenAI API quota constraints
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
- **Linting:** ESLint configuration
- **Formatting:** Prettier (if configured)
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
