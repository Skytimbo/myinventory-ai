# MyInventory AI

AI-powered household inventory management. Photograph items, get automatic metadata extraction (name, description, category, tags, estimated resale value), and generate tracking barcodes. Catalog once, find anything.

## Tech Stack

- **Frontend:** React 18 + TypeScript, Vite, shadcn/ui, Tailwind CSS, TanStack Query
- **Backend:** Express.js + TypeScript, Drizzle ORM
- **Database:** Neon PostgreSQL (serverless)
- **AI:** OpenAI GPT-4o-mini (cheap) with GPT-4o fallback
- **Storage:** Local filesystem (Railway persistent volume in production)
- **Testing:** Vitest (unit/integration), Playwright (E2E)
- **CI/CD:** GitHub Actions

## Prerequisites

- Node.js >= 20.10.0
- pnpm >= 10.20.0 (enforced — npm/yarn will be rejected)
- PostgreSQL database ([Neon](https://neon.tech) recommended)
- OpenAI API key

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL and OPENAI_API_KEY

# Set up database
pnpm db:push
pnpm db:seed    # optional: populate with sample data

# Start development server
pnpm dev        # http://localhost:5000
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start full-stack dev server (port 5000) |
| `pnpm dev:api` | API-only server (for E2E testing) |
| `pnpm dev:ui` | Vite dev server only (port 5174, proxies API to 5000) |
| `pnpm build` | Production build (Vite + esbuild) |
| `pnpm start` | Run production build |
| `pnpm test` | Run server + client unit tests |
| `pnpm test:server` | Server tests only |
| `pnpm test:client` | Client tests only |
| `pnpm e2e` | Playwright E2E tests |
| `pnpm lint` | ESLint check |
| `pnpm format` | Prettier format |
| `pnpm check` | TypeScript type check |
| `pnpm db:push` | Push schema to database |
| `pnpm db:reset` | Reset database |
| `pnpm db:seed` | Seed sample data |

## Environment Variables

See [`.env.example`](.env.example) for the full list. Required:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_PROJECT_ID` | Required if using project-scoped keys (`sk-proj-*`) |

## Architecture

```
myinventory-ai/
├── client/src/           # React SPA (single page: home.tsx)
│   ├── components/       # UI components (ItemCard, Dashboard, CameraCapture, etc.)
│   ├── hooks/            # Custom hooks
│   └── lib/              # API client, upload helpers
├── server/               # Express API
│   ├── index.ts          # Entry point
│   ├── routes.ts         # HTTP routes (thin layer)
│   ├── services.ts       # DI container + test fakes
│   ├── analyzer.ts       # IAnalyzer: OpenAI + Mock implementations
│   ├── itemService.ts    # Business logic
│   ├── storage.ts        # Database access (Drizzle/Neon)
│   └── objectStorage.ts  # Local filesystem image storage
├── shared/schema.ts      # DB schema + Zod types (single source of truth)
├── e2e/                  # Playwright E2E tests
├── tasks/                # PRDs and execution plans
└── docs/                 # Setup guides, ADRs
```

## Deployment

Deployed on Railway with persistent volume for image uploads. See [`docs/RAILWAY-QUICKSTART.md`](docs/RAILWAY-QUICKSTART.md) for setup instructions.

## Documentation

- [`FOUNDATION.md`](FOUNDATION.md) — Architectural principles and evolution roadmap
- [`CONTEXT.md`](CONTEXT.md) — Project context and documentation map
- [`CHANGELOG.md`](CHANGELOG.md) — Release history
- [`docs/`](docs/) — Setup guides and ADRs

## License

MIT
