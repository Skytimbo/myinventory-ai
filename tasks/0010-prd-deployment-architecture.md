# PRD-0010: Deployment Architecture & Hosting Strategy

**Status:** Draft
**Created:** 2025-11-20
**Author:** Claude Code (AI Agent)
**Priority:** High
**Target:** MyInventory-AI v1.0 (short-term), QuantaIQ (mid-term), Hardware Appliance (long-term)

---

## Executive Summary

This PRD defines the hosting strategy for MyInventory-AI to replace current Replit-centric architecture with a platform-agnostic deployment approach. The goal is to establish a stable, cost-effective hosting solution that supports:

1. **Immediate needs:** Production-ready web app accessible from mobile devices
2. **Mid-term evolution:** QuantaIQ platform scalability
3. **Long-term vision:** Docker-based distribution for testers and hardware appliance pathway

**Recommendation:** Railway (Primary) + Docker Compose (Secondary Distribution)

---

## Part 1: Codebase Requirements Analysis

### 1.1 Runtime Environment

**Node.js Stack:**
- Node.js 20.10.0+ (ESM modules)
- pnpm 10.20.0+ (enforced via preinstall script)
- Build time: 30-60 seconds
- Disk space: ~500MB (node_modules) + ~1.3MB (dist/)

**Source:** `package.json:7-10`

### 1.2 Database Requirements

**PostgreSQL via Neon Serverless Driver:**
- HTTP-based connection (no persistent TCP)
- Requires SSL (`?sslmode=require` in connection string)
- Schema features: UUID, array columns, DECIMAL
- Migration tool: Drizzle Kit (`pnpm db:push`)
- Connection string format: `postgresql://user:pass@host:port/db?sslmode=require`

**Source:** `server/storage.ts:17-22`, `shared/schema.ts`

**Critical:** Current code uses `@neondatabase/serverless` driver optimized for HTTP. Traditional platforms may require switching to standard `pg` driver with connection pooling.

### 1.3 File Storage Requirements

**Dual-Backend Architecture:**
- **Local Dev:** Filesystem storage in `./uploads/` (configurable via `LOCAL_STORAGE_DIR`)
- **Production:** Google Cloud Storage via Replit sidecar (requires `@google-cloud/storage`)

**Upload Specifications:**
- Max file size: 10MB per file
- Max files per item: 10 (multi-image support, PRD-0004)
- Supported formats: JPEG, PNG, WebP
- Validation: MIME type + magic number sniffing
- URL pattern: `/objects/items/{itemId}/{index}.{ext}`

**Source:** `server/objectStorage.ts`, `server/routes.ts:11-14, 70-203`

**Critical:** File storage must be persistent across deploys. Ephemeral filesystems (Vercel, AWS Lambda) are incompatible without refactoring to external blob storage (S3, Cloudflare R2).

### 1.4 External API Integration

**OpenAI GPT-4o / GPT-4o-mini:**
- Purpose: AI-powered image analysis for inventory items
- Cost optimization: Tiered strategy (cheap model first, fallback to premium if confidence < 0.4)
- Required environment variables:
  - `OPENAI_API_KEY` (required)
  - `OPENAI_BASE_URL` (optional, defaults to `https://api.openai.com/v1`)

**Source:** `server/openai.ts`, `server/modelPolicy.ts`

**API Call Frequency:** 1 request per uploaded item (typically 2-5 seconds per analysis)

### 1.5 Port and Network Requirements

**Primary Port:** Configurable via `PORT` environment variable (default: 5000)
- Binds to `0.0.0.0` (accepts external connections)
- Serves both API (`/api/*`, `/objects/*`) and static frontend (`dist/public/`)

**Development Mode:**
- Port 5000: Express API server
- Port 5173: Vite dev server (only in `pnpm dev` mode)

**Production Mode:**
- Single port (5000) serves everything via Express static middleware

**Source:** `server/index.ts:145-152`

### 1.6 Environment Variables

**Required (All Platforms):**

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@neon.tech:5432/db?sslmode=require` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |

**Optional (With Defaults):**

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment mode | `development` |
| `OPENAI_BASE_URL` | OpenAI API endpoint | `https://api.openai.com/v1` |
| `LOCAL_STORAGE_DIR` | Upload directory (dev) | `./uploads` |

**Platform-Specific (Replit Only):**

| Variable | Description | Auto-Configured |
|----------|-------------|-----------------|
| `REPL_ID` | Replit environment detection | ✓ |
| `PRIVATE_OBJECT_DIR` | GCS bucket path | ✓ (Object Storage integration) |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Public asset paths | ✓ (Object Storage integration) |

**Validation:** All required variables validated at startup (`server/services.ts:61-116`). Server fails fast with clear error messages if missing.

### 1.7 Build Process

**Production Build Steps:**
```bash
pnpm install                    # Install dependencies (~30s)
pnpm db:push                    # Push database schema (~5s)
pnpm build                      # Build frontend + backend (~45s)
pnpm start                      # Start server
```

**Build Outputs:**
```
dist/
  index.js                      # Bundled Express server (~40KB, ESM)
  public/                       # Vite frontend build
    index.html                  # SPA entry point
    assets/
      index-[hash].js           # ~884KB (React + dependencies)
      index-[hash].css          # ~74KB (Tailwind + components)
      purify.es-[hash].js       # ~23KB (DOMPurify)
      html2canvas.esm-[hash].js # ~201KB (screenshot library)
```

**Source:** `package.json:18-19`, `vite.config.ts`

**Note:** Build process uses Vite (frontend) + esbuild (backend). Platform must support standard Node.js build commands.

---

## Part 2: Platform Comparison Matrix

### Comparison Criteria

Each platform evaluated on 8 dimensions (scored 1-5, 5 being best):

1. **Tech Stack Compatibility:** Node 20+, pnpm, PostgreSQL, file uploads
2. **File Storage:** Persistent disk/volumes support
3. **Database Integration:** Built-in PostgreSQL or easy external DB connection
4. **Cost (MVP Scale):** <100 users, ~5GB storage, ~10GB/month bandwidth
5. **Setup Complexity:** Time from account creation to deployed app
6. **Reliability:** Uptime SLA, auto-scaling, health checks
7. **Docker Path:** Future containerization support
8. **Developer Experience:** Logs, debugging, rollbacks

---

### Platform 1: Render

**Overview:** Managed platform-as-a-service for web apps, databases, and static sites

**Compatibility:** ⭐⭐⭐⭐⭐
- Native Node.js 20+ support
- pnpm automatically detected via `packageManager` field
- PostgreSQL as managed service (separate from web service)
- Direct OpenAI API calls (no proxy needed)

**File Storage:** ⭐⭐⭐⭐
- Persistent disk volumes available ($0.10/GB/month)
- Mount point: `/data` or custom path
- Survives deploys and restarts
- Note: Local filesystem strategy works directly (set `LOCAL_STORAGE_DIR=/data/uploads`)

**Database Integration:** ⭐⭐⭐⭐⭐
- Managed PostgreSQL databases (pay-as-you-go)
- Standard connection string (compatible with Neon driver)
- Automated backups, point-in-time recovery
- Free tier: 90 days, then $7/month for 256MB

**Cost (MVP):** ⭐⭐⭐⭐
- Web service: $7/month (512MB RAM, 0.1 CPU)
- PostgreSQL: $7/month (256MB)
- Disk: $0.25/month (2.5GB for images)
- **Total: ~$14/month**

**Setup Complexity:** ⭐⭐⭐⭐⭐
- Connect GitHub repository
- Auto-detects Node.js, runs `pnpm install && pnpm build`
- Set environment variables via dashboard
- Deploy in ~5 minutes

**Reliability:** ⭐⭐⭐⭐
- 99.95% uptime SLA
- Auto-scaling available (paid plans)
- Health checks with auto-restart
- Free SSL certificates (Let's Encrypt)

**Docker Path:** ⭐⭐⭐⭐⭐
- Native Docker support (alternative to buildpacks)
- Can deploy from `Dockerfile` directly
- Easy migration when containerization added

**Developer Experience:** ⭐⭐⭐⭐
- Live logs in dashboard
- SSH access to web service (debugging)
- One-click rollbacks
- Preview deploys for PRs

**Strengths:**
- Excellent PostgreSQL integration
- Persistent disk support (critical for file uploads)
- Clean Docker migration path
- Predictable pricing

**Weaknesses:**
- Slightly higher cost than alternatives
- Cold starts on free tier (15-30 seconds)

**Recommendation for MyInventory-AI:** ✅ **Strong fit** - All requirements met, minimal code changes

---

### Platform 2: Railway

**Overview:** Modern infrastructure platform with focus on developer experience

**Compatibility:** ⭐⭐⭐⭐⭐
- Node.js 20+ natively supported
- pnpm auto-detected
- PostgreSQL plugin (one-click provisioning)
- No special configuration needed for OpenAI

**File Storage:** ⭐⭐⭐⭐⭐
- Persistent volumes included (5GB free on trial, then $0.10/GB/month)
- Mount at any path (e.g., `/app/uploads`)
- Automatic backups
- Works perfectly with local filesystem storage strategy

**Database Integration:** ⭐⭐⭐⭐⭐
- PostgreSQL plugin (managed by Railway)
- Auto-generates `DATABASE_URL` environment variable
- Same pricing as standalone managed PostgreSQL
- Backups included

**Cost (MVP):** ⭐⭐⭐⭐⭐
- $5 free credit/month (hobby plan)
- Usage-based: ~$0.000231/minute for 512MB RAM
- PostgreSQL: ~$5-10/month (depends on usage)
- Volume: $0.50/month (5GB)
- **Total: ~$0-15/month** (free tier covers most MVP usage)

**Setup Complexity:** ⭐⭐⭐⭐⭐
- Connect GitHub (or deploy from CLI)
- Add PostgreSQL plugin (1 click)
- Add volume mount (1 click)
- Environment variables auto-injected
- **Deploy in <5 minutes**

**Reliability:** ⭐⭐⭐⭐
- 99.9% uptime target (no SLA on free tier)
- Auto-restart on failure
- Health checks configurable
- SSL certificates automatic

**Docker Path:** ⭐⭐⭐⭐⭐
- Native Dockerfile support
- Railway detects and uses Dockerfile if present
- Seamless migration from buildpack to container

**Developer Experience:** ⭐⭐⭐⭐⭐
- Best-in-class dashboard (live logs, metrics)
- Command palette for quick actions
- One-click rollbacks
- PR preview environments
- GraphQL API for automation

**Strengths:**
- **Fastest setup** (5 minutes GitHub → deployed app)
- Generous free tier ($5/month credit)
- Excellent volume support (persistent file storage)
- Modern, polished developer experience
- Built-in PostgreSQL plugin (no external service needed)

**Weaknesses:**
- Relatively new platform (less enterprise track record than Render/Heroku)
- Pricing can spike if not monitored (usage-based)

**Recommendation for MyInventory-AI:** ✅ **Best overall fit** - Zero code changes, fastest deployment, excellent free tier

---

### Platform 3: Fly.io

**Overview:** Global edge deployment platform with VM-based approach

**Compatibility:** ⭐⭐⭐⭐
- Node.js support via Dockerfile (auto-generated)
- pnpm supported in generated Dockerfile
- PostgreSQL via managed service or external (Neon)
- OpenAI works directly

**File Storage:** ⭐⭐⭐⭐
- Persistent volumes available
- Mounted at `/data` or custom path
- Replicated across regions (high availability)
- Pricing: $0.15/GB/month

**Database Integration:** ⭐⭐⭐
- Managed PostgreSQL available but complex (multi-VM cluster)
- Easier to use external DB (Neon, Supabase)
- Requires manual `DATABASE_URL` configuration

**Cost (MVP):** ⭐⭐⭐
- Compute: Free allowance covers small apps (3 shared-cpu-1x VMs)
- Volume: $0.45/month (3GB)
- PostgreSQL: Recommend external Neon (free tier available)
- **Total: ~$0-5/month** (with external DB)

**Setup Complexity:** ⭐⭐⭐
- Requires `flyctl` CLI installation
- `fly launch` generates Dockerfile
- Manual volume creation: `fly volumes create data --size 3`
- More steps than Railway/Render

**Reliability:** ⭐⭐⭐⭐⭐
- 99.99% uptime SLA (paid plans)
- Global edge deployment (17+ regions)
- Health checks + auto-restart
- Excellent for geo-distributed users

**Docker Path:** ⭐⭐⭐⭐⭐
- **Already uses Docker** (generates Dockerfile automatically)
- Existing fly.toml can be reused locally with docker-compose
- Best platform if Docker is priority

**Developer Experience:** ⭐⭐⭐
- CLI-first (good for automation, less friendly for beginners)
- Logs via `fly logs`
- SSH access: `fly ssh console`
- Learning curve steeper than Railway/Render

**Strengths:**
- **Already Docker-based** (no migration needed later)
- Global edge deployment (lowest latency worldwide)
- Strong free tier
- Excellent for distributed teams

**Weaknesses:**
- More complex setup (CLI required)
- Managed PostgreSQL overkill for MVP (use external DB instead)
- Less polished dashboard than Railway

**Recommendation for MyInventory-AI:** ✅ **Good fit if Docker is priority** - Requires Dockerfile, but aligns with long-term containerization goal

---

### Platform 4: Vercel

**Overview:** Serverless platform optimized for frontend frameworks

**Compatibility:** ⭐⭐
- **Serverless functions only** (no persistent Node.js server)
- Would require major refactoring:
  - Express → Vercel serverless functions
  - File uploads → external blob storage (Vercel Blob, S3)
  - WebSocket support limited
- PostgreSQL: External only (Neon, Supabase)

**File Storage:** ⭐
- **No persistent filesystem** (ephemeral between invocations)
- Must use Vercel Blob Storage ($0.15/GB) or external S3
- Requires rewriting `server/objectStorage.ts` to use blob SDK

**Database Integration:** ⭐⭐⭐⭐
- Neon integration is excellent
- Vercel Postgres (powered by Neon) available
- Existing Neon driver compatible

**Cost (MVP):** ⭐⭐⭐
- Hobby plan: Free (limited to 100GB bandwidth)
- Pro: $20/month (if hobby exceeded)
- Blob storage: $0.15/GB + $0.40/GB egress
- **Total: $0-25/month** (depending on usage)

**Setup Complexity:** ⭐⭐
- Easy for Next.js apps
- **Difficult for Express apps** (major refactoring required)
- Would need to:
  1. Split backend into serverless functions
  2. Migrate file uploads to Blob Storage
  3. Rewrite upload handlers
  4. Test extensively (architecture change)

**Reliability:** ⭐⭐⭐⭐⭐
- 99.99% uptime SLA
- Global edge network
- Auto-scaling built-in
- Excellent for static sites + API routes

**Docker Path:** ⭐
- Serverless ≠ Docker
- No Docker support (incompatible architecture)

**Developer Experience:** ⭐⭐⭐⭐⭐
- Best-in-class for Next.js
- Preview deployments excellent
- Analytics and monitoring included

**Strengths:**
- Best global CDN
- Excellent for static sites + lightweight APIs
- Strong Next.js integration

**Weaknesses:**
- **Requires significant refactoring** (Express → serverless)
- **No persistent filesystem** (file uploads problematic)
- **Poor fit for Docker path** (serverless architecture)

**Recommendation for MyInventory-AI:** ❌ **Poor fit** - Would require major rewrite, no Docker alignment

---

### Platform 5: Replit

**Overview:** Browser-based IDE with integrated deployment (current platform)

**Compatibility:** ⭐⭐⭐⭐⭐
- Node.js 20 via modules system
- pnpm supported
- PostgreSQL integration (Replit DB or external)
- Object Storage integration (GCS wrapper)
- AI Integrations (OpenAI proxy)

**File Storage:** ⭐⭐⭐⭐
- Object Storage integration (Google Cloud Storage)
- Requires Replit-specific sidecar (port 1106)
- Works via `@google-cloud/storage` package
- Already implemented in codebase (`server/objectStorage.ts`)

**Database Integration:** ⭐⭐⭐⭐
- Replit PostgreSQL (managed, auto-configured)
- External DB support (Neon, Supabase)
- `DATABASE_URL` auto-injected if using Replit DB

**Cost (MVP):** ⭐⭐⭐
- **Replit Core:** $20/month (always-on, autoscale deploys)
- Object Storage: Included (generous free tier)
- PostgreSQL: $0-10/month (usage-based)
- **Total: $20-30/month**

**Setup Complexity:** ⭐⭐⭐⭐⭐
- Import from GitHub (1 click)
- Enable integrations (Object Storage, PostgreSQL, AI)
- Set secrets (`OPENAI_API_KEY`)
- Click "Deploy"
- **Fastest initial setup** (~3 minutes)

**Reliability:** ⭐⭐⭐
- Uptime varies (community reports occasional issues)
- Auto-restart on crash
- Autoscale deployment available (Replit Core)
- No public SLA

**Docker Path:** ⭐⭐
- **Vendor lock-in** (Replit-specific integrations)
- Object Storage sidecar not portable
- Would need refactoring to containerize:
  - Remove Replit environment detection
  - Switch to standard storage (S3, local filesystem)
  - Remove sidecar dependencies

**Developer Experience:** ⭐⭐⭐⭐⭐
- **Best IDE integration** (browser-based development)
- Live collaboration features
- Instant preview URLs
- AI assistance (Ghostwriter)
- Great for rapid prototyping

**Strengths:**
- **Zero-friction onboarding** (fastest from idea → deployed app)
- Integrated Object Storage (no external S3 setup)
- AI Integrations (OpenAI proxy with usage tracking)
- Excellent for learning/education
- PRD-0009 already completed (full Replit support)

**Weaknesses:**
- **Vendor lock-in** (Object Storage sidecar, environment detection)
- **Higher cost** than alternatives ($20/month minimum for production)
- **Poor Docker migration path** (architecture tied to Replit services)
- **Limited control** (cannot customize infrastructure)
- **Unclear enterprise roadmap** (platform evolution uncertain)

**Recommendation for MyInventory-AI:** ⚠️ **Use for rapid prototyping only** - Excellent for demos and testing, but migrate away for production due to vendor lock-in and cost

**Honest Assessment:**

Replit excels at:
- Quick start (fastest time-to-deployment)
- Learning and education (browser-based IDE)
- Collaborative development
- AI-assisted coding

Replit struggles with:
- Production stability (community reports issues)
- Cost efficiency ($20/month vs $5-15 elsewhere)
- Infrastructure control (limited customization)
- Vendor lock-in (proprietary integrations)
- Long-term viability (unclear platform direction)

**Verdict:** Great for prototypes, not ideal for production or Docker path.

---

### Platform 6: DigitalOcean App Platform

**Overview:** Managed PaaS from DigitalOcean

**Compatibility:** ⭐⭐⭐⭐
- Node.js 20 supported
- pnpm via buildpack configuration
- PostgreSQL managed database
- Standard deployment process

**File Storage:** ⭐⭐⭐⭐
- Persistent volumes available (Spaces CDN integration)
- Can use DigitalOcean Spaces (S3-compatible object storage)
- $5/month for 250GB storage + CDN

**Database Integration:** ⭐⭐⭐⭐⭐
- Managed PostgreSQL ($15/month starter)
- Standard connection string
- Automated backups, high availability
- Compatible with Neon driver

**Cost (MVP):** ⭐⭐⭐
- Basic app: $5/month (512MB RAM)
- PostgreSQL: $15/month
- Spaces: $5/month (250GB)
- **Total: $25/month**

**Setup Complexity:** ⭐⭐⭐⭐
- Connect GitHub
- Detect buildpack or use Dockerfile
- Configure environment variables
- Deploy in ~10 minutes

**Reliability:** ⭐⭐⭐⭐⭐
- 99.99% uptime SLA
- Global datacenter presence
- Enterprise-grade infrastructure
- Strong track record (established provider)

**Docker Path:** ⭐⭐⭐⭐⭐
- Native Docker support
- Can deploy from Dockerfile
- DigitalOcean Kubernetes available for scaling

**Developer Experience:** ⭐⭐⭐⭐
- Clean dashboard
- Live logs, metrics
- Rollbacks supported
- Good documentation

**Strengths:**
- **Established provider** (trusted by enterprises)
- Strong reliability (99.99% SLA)
- Good Docker support
- Spaces (S3-compatible) for object storage

**Weaknesses:**
- **Higher cost** than Railway/Render
- PostgreSQL minimum $15/month (no free tier)
- Less modern developer experience than Railway

**Recommendation for MyInventory-AI:** ✅ **Solid enterprise option** - Higher cost but excellent reliability

---

### Platform 7: Self-Hosted Docker (Mini-PC / VPS)

**Overview:** Deploy via Docker Compose on personal hardware or VPS

**Compatibility:** ⭐⭐⭐⭐⭐
- **Full control** over Node.js version, packages, configuration
- Standard PostgreSQL container
- Local filesystem storage (no external dependencies)

**File Storage:** ⭐⭐⭐⭐⭐
- Docker volumes (persistent across container restarts)
- No storage limits (only constrained by disk size)
- Full control over backup strategy

**Database Integration:** ⭐⭐⭐⭐⭐
- PostgreSQL container in docker-compose
- Standard connection pooling
- pgAdmin for administration
- No external dependencies

**Cost (MVP):** ⭐⭐⭐⭐⭐
- **Mini-PC (one-time):** $150-300 (Intel N100, 8GB RAM, 256GB SSD)
- **VPS (monthly):** $5-10/month (DigitalOcean, Linode, Hetzner)
- **Electricity:** ~$2/month (mini-PC always-on)
- **Total: $0-12/month** (after hardware purchase)

**Setup Complexity:** ⭐⭐
- Requires Docker knowledge
- Must create:
  - `Dockerfile` for Node.js app
  - `docker-compose.yml` for multi-service orchestration
  - Reverse proxy (nginx/Caddy) for SSL
  - Backup scripts
- Initial setup: 1-2 days for beginners

**Reliability:** ⭐⭐⭐
- Depends on hardware/VPS provider
- **No managed monitoring** (must set up yourself)
- **Single point of failure** (no auto-scaling, load balancing)
- Uptime depends on home internet (if mini-PC) or VPS provider

**Docker Path:** ⭐⭐⭐⭐⭐
- **Already Docker** (this IS the Docker path)
- Perfect for testing containerization
- Production-ready container setup
- Easy to migrate between VPS providers

**Developer Experience:** ⭐⭐
- Full control but manual everything
- SSH access for debugging
- Logs via `docker logs`
- No managed dashboard (unless Portainer/similar added)

**Strengths:**
- **Full ownership** (no vendor lock-in)
- **Cheapest long-term** (especially mini-PC)
- **Perfect for testing** (containers run anywhere)
- **Privacy** (data stays on your hardware)
- **Learning opportunity** (DevOps experience)

**Weaknesses:**
- **No managed support** (you're the DevOps team)
- **Setup complexity** (Docker knowledge required)
- **Reliability depends on you** (no auto-scaling, monitoring)
- **Not suitable for high traffic** (single server)

**Recommendation for MyInventory-AI:** ✅ **Excellent secondary strategy** - Not for primary production, but critical for:
1. Tester distribution (docker-compose.yml for local install)
2. Hardware appliance pathway (mini-PC proof-of-concept)
3. Cost-effective personal/family use

---

## Part 3: Recommendations

### 3.1 Primary Hosting Strategy

**Recommendation: Railway (Option B - Hybrid Approach)**

**Rationale:**

1. **Lowest Friction:**
   - GitHub → deployed app in <5 minutes
   - PostgreSQL plugin (1 click)
   - Persistent volumes included
   - **Zero code changes required**

2. **Cost-Effective:**
   - $5 free credit/month (hobby plan covers MVP)
   - Usage-based scaling (pay only for what you use)
   - Total cost: $0-15/month for <100 users

3. **Tech Stack Compatibility:**
   - Native Node.js 20, pnpm support
   - Works with existing Neon driver
   - Local filesystem storage (set `LOCAL_STORAGE_DIR=/app/uploads`)
   - OpenAI API works directly

4. **Docker Migration Path:**
   - Native Dockerfile support (when ready)
   - Seamless migration from buildpack → container
   - Railway CLI supports local Docker development

5. **Developer Experience:**
   - Best-in-class dashboard (live logs, metrics)
   - One-click rollbacks
   - PR preview environments
   - Minimal operations overhead

**Implementation Details:**

```yaml
# Railway Service Configuration
Service: myinventory-ai
  Runtime: Node.js 20
  Build Command: pnpm install && pnpm db:push && pnpm build
  Start Command: pnpm start
  Environment Variables:
    - DATABASE_URL: ${{Postgres.DATABASE_URL}}  # Auto-injected
    - OPENAI_API_KEY: (user-provided secret)
    - PORT: 5000
    - NODE_ENV: production
  Volume:
    Mount Path: /app/uploads
    Size: 5GB
  Health Check:
    Path: /api/health
    Interval: 30s
```

**Database Strategy:**

Option A (Recommended): Railway PostgreSQL Plugin
- One-click provisioning
- Auto-configures `DATABASE_URL`
- Automated backups
- Cost: ~$5-10/month

Option B (Alternative): External Neon
- Keep existing Neon database
- Manually set `DATABASE_URL` in Railway
- Slightly lower cost (Neon free tier)

**File Storage Strategy:**

Use Railway persistent volume mounted at `/app/uploads`:
- Set `LOCAL_STORAGE_DIR=/app/uploads` environment variable
- Existing code (`server/objectStorage.ts`) already supports local filesystem
- No code changes needed (removes Replit GCS sidecar dependency)

**Migration from Replit:**

1. Export database: `pg_dump $DATABASE_URL > backup.sql`
2. Create Railway project: `railway init`
3. Add PostgreSQL plugin: Railway dashboard → Plugins → PostgreSQL
4. Import database: `psql $RAILWAY_DATABASE_URL < backup.sql`
5. Configure environment variables in Railway
6. Deploy: Push to GitHub (Railway auto-deploys)

**Estimated Migration Time:** 1-2 hours

---

### 3.2 Alternative Consideration: Render

**When to Choose Render Over Railway:**

- **Enterprise requirements:** Need guaranteed 99.95% SLA
- **Established track record:** Prefer provider with longer history
- **Simpler pricing:** Flat monthly rate ($14/month) vs usage-based
- **Team collaboration:** Multiple team members need dashboard access

**Trade-offs:**

- **Higher cost:** $14/month vs Railway's $0-15/month (Railway has free tier)
- **Slower iteration:** Build times slightly longer than Railway
- **Less modern UX:** Dashboard less polished than Railway

**Verdict:** Render is excellent backup if Railway doesn't meet needs. Both are strong choices.

---

### 3.3 Two-Phase Approach (Railway Now, Full Docker Later)

**Phase 1: Railway Deployment (Immediate)**

- **Timeline:** Week 1
- **Goal:** Production app accessible from mobile
- **Platform:** Railway with PostgreSQL plugin
- **Storage:** Railway persistent volume
- **Cost:** $0-15/month

**Phase 2: Docker Containerization (Future)**

- **Timeline:** Months 2-3 (when ready for broader distribution)
- **Goal:** Docker Compose setup for testers and self-hosting
- **Deliverables:**
  1. `Dockerfile` for Node.js app
  2. `docker-compose.yml` for multi-service orchestration
  3. Install scripts for testers
  4. Mini-PC deployment guide

**Migration Path:**

Railway supports native Dockerfile deployment:
1. Add `Dockerfile` to repository
2. Railway auto-detects and uses it
3. No platform migration needed (Railway → Railway with Docker)

**Benefits:**

- **Get to production fast** (Railway in days)
- **Maintain Docker optionality** (add Dockerfile when ready)
- **No lock-in** (Railway supports both buildpack and Docker)

---

### 3.4 Secondary Distribution Strategy

**Goal:** Enable testers and collaborators to run MyInventory-AI locally without cloud dependencies

**Approach: Docker Compose + Install Script**

**Components:**

1. **Dockerfile** (Node.js app)
2. **docker-compose.yml** (app + PostgreSQL)
3. **install.sh** (one-click setup script)
4. **README-DOCKER.md** (user guide)

**Example docker-compose.yml:**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myinventory
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build: .
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/myinventory
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      PORT: 5000
      NODE_ENV: production
    volumes:
      - ./uploads:/app/uploads
    ports:
      - "5000:5000"
    depends_on:
      - postgres

volumes:
  postgres_data:
```

**Usage:**

```bash
# Tester workflow
git clone https://github.com/username/myinventory-ai
cd myinventory-ai
echo "OPENAI_API_KEY=sk-..." > .env
docker compose up -d
# Open http://localhost:5000
```

**Benefits:**

- **No cloud account needed** (runs fully local)
- **Consistent environment** (Docker guarantees reproducibility)
- **Easy testing** (testers just need Docker installed)
- **Privacy** (all data stays on local machine)

---

### 3.5 Mini-PC Hardware Appliance Strategy (Long-Term)

**Vision:** Pre-configured mini-PC that runs MyInventory-AI out-of-box

**Target Use Cases:**

- Small businesses (retail, warehouse)
- Personal/family inventory management
- Air-gapped environments (no cloud dependency)

**Recommended Hardware:**

**Option 1: Intel N100 Mini-PC**
- **Cost:** $150-200
- **Specs:** Intel N100 (4-core), 8GB RAM, 256GB SSD
- **Power:** 6W idle, 15W max (~$2/month electricity)
- **Examples:** Beelink S12 Pro, GMKtec NucBox

**Option 2: Raspberry Pi 5**
- **Cost:** $80 (8GB model) + $30 (case, power, microSD)
- **Specs:** ARM Cortex-A76 (4-core 2.4GHz), 8GB RAM
- **Power:** 3W idle, 8W max (~$1/month electricity)
- **Pros:** Lower cost, huge community
- **Cons:** Slower than x86, ARM Docker images needed

**Software Stack:**

```
Hardware
  ├─ Ubuntu Server 24.04 LTS (or Debian)
  ├─ Docker + Docker Compose
  ├─ Tailscale (VPN for remote access)
  └─ MyInventory-AI containers (app + PostgreSQL)
```

**Setup Process:**

1. Flash Ubuntu to SSD/microSD
2. Install Docker: `curl -fsSL https://get.docker.com | sh`
3. Clone repository: `git clone https://github.com/username/myinventory-ai`
4. Configure `.env` file with OpenAI key
5. Run: `docker compose up -d`
6. Access via `http://mini-pc.local:5000` (mDNS) or Tailscale

**Tailscale Integration (Optional):**

- Enables secure remote access from phone/laptop
- No port forwarding or dynamic DNS needed
- Free for personal use (up to 100 devices)

**Pre-Configured Image (Future):**

Create bootable SD card / USB image with:
- Operating system
- Docker pre-installed
- MyInventory-AI pre-loaded
- Web-based setup wizard (configure OpenAI key via browser)

**User Experience:**

1. Purchase mini-PC (or receive pre-configured unit)
2. Plug in power + ethernet
3. Navigate to setup URL (printed on card)
4. Enter OpenAI API key in web form
5. Start using MyInventory-AI

**Timeline:** Phase 3 (6+ months), after Docker Compose validated with testers

---

## Part 4: Actionable Tasks

### Task 1.0: Railway Deployment Setup

**Priority:** High
**Timeline:** Week 1 (2-3 hours)
**Owner:** DevOps / Full-stack developer

#### Task 1.1: Create Railway Account and Project

**Steps:**
1. Sign up at https://railway.app (use GitHub login)
2. Create new project: "myinventory-ai"
3. Connect GitHub repository
4. Select repository branch: `main`

**Acceptance Criteria:**
- Railway dashboard shows connected repository
- Automatic deploys enabled for `main` branch

---

#### Task 1.2: Provision PostgreSQL Database

**Steps:**
1. Railway dashboard → "New" → "Database" → "PostgreSQL"
2. Note auto-generated `DATABASE_URL` environment variable
3. (Optional) Rename database service to "postgres-prod"

**Acceptance Criteria:**
- PostgreSQL plugin shows "Active" status
- `DATABASE_URL` variable visible in environment variables

---

#### Task 1.3: Configure Environment Variables

**Steps:**
1. Railway dashboard → Service settings → Variables
2. Add the following variables:

```
OPENAI_API_KEY=sk-...  (your OpenAI API key)
PORT=5000
NODE_ENV=production
LOCAL_STORAGE_DIR=/app/uploads
```

3. Verify `DATABASE_URL` is already set (auto-injected by PostgreSQL plugin)

**Acceptance Criteria:**
- All 4 environment variables visible in dashboard
- No placeholder values (replace `sk-...` with real key)

---

#### Task 1.4: Add Persistent Volume for File Uploads

**Steps:**
1. Railway dashboard → Service settings → Volumes
2. Click "New Volume"
3. Configure:
   - Mount path: `/app/uploads`
   - Size: 5GB (adjust based on expected usage)
4. Save and redeploy service

**Acceptance Criteria:**
- Volume shows "Mounted" status
- Deployment logs show volume mount successful

---

#### Task 1.5: Update Code for Railway File Storage

**Changes Required:**

**File:** `server/objectStorage.ts` (line 15-18)

Update environment detection logic:

```typescript
// Before (Replit-specific)
const isReplit = process.env.REPL_ID !== undefined;

// After (Railway-compatible)
const isReplit = false;  // Force local filesystem storage
```

**Alternative (Better):** Use environment variable flag:

```typescript
const useLocalStorage = process.env.USE_LOCAL_STORAGE === "true" || !process.env.REPL_ID;
```

Then set `USE_LOCAL_STORAGE=true` in Railway environment variables.

**Acceptance Criteria:**
- File uploads save to `/app/uploads` (Railway volume)
- No GCS sidecar errors in logs

---

#### Task 1.6: Migrate Database from Replit/Neon (If Applicable)

**Steps:**

1. Export existing database:
   ```bash
   pg_dump $CURRENT_DATABASE_URL > backup.sql
   ```

2. Import to Railway:
   ```bash
   psql $RAILWAY_DATABASE_URL < backup.sql
   ```

3. Run schema push to ensure latest schema:
   ```bash
   DATABASE_URL=$RAILWAY_DATABASE_URL pnpm db:push
   ```

**Acceptance Criteria:**
- All inventory items visible in Railway database
- No duplicate or missing records
- Schema matches latest Drizzle schema

---

#### Task 1.7: Test Deployment

**Steps:**

1. Wait for Railway deployment to complete (check logs)
2. Access deployment URL (e.g., `https://myinventory-ai-production.up.railway.app`)
3. Verify health check: `curl https://your-app.railway.app/api/health`
4. Test image upload from mobile device
5. Verify AI analysis works (check response for `estimatedValue`)
6. Verify uploaded image persists after redeployment

**Acceptance Criteria:**
- Health check returns `{"status": "ok"}`
- Image upload succeeds
- AI analysis returns item details
- Image accessible at `/objects/items/...` URL
- Image survives Railway service restart

---

#### Task 1.8: Configure Custom Domain (Optional)

**Steps:**

1. Railway dashboard → Service settings → Domains
2. Click "Add Domain"
3. Enter custom domain (e.g., `inventory.yourdomain.com`)
4. Update DNS provider with Railway's CNAME:
   - Type: CNAME
   - Name: `inventory`
   - Value: `your-app.railway.app`
5. Wait for SSL certificate provisioning (~5 minutes)

**Acceptance Criteria:**
- Custom domain shows "SSL Active"
- HTTPS works without certificate warnings
- Redirects HTTP → HTTPS automatically

---

### Task 2.0: Docker Containerization (Phase 2)

**Priority:** Medium
**Timeline:** Weeks 4-6 (8-12 hours)
**Owner:** DevOps / Backend developer

#### Task 2.1: Create Dockerfile

**File:** `Dockerfile`

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build application
RUN pnpm build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install pnpm (production)
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Create uploads directory
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Switch to non-root user
USER node

# Expose port
EXPOSE 5000

# Start application
CMD ["pnpm", "start"]
```

**Acceptance Criteria:**
- Dockerfile builds successfully: `docker build -t myinventory-ai .`
- Image size < 500MB
- Multi-stage build reduces final image size

---

#### Task 2.2: Create docker-compose.yml

**File:** `docker-compose.yml`

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myinventory
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD:-postgres}@postgres:5432/myinventory
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      PORT: 5000
      NODE_ENV: production
      LOCAL_STORAGE_DIR: /app/uploads
    volumes:
      - ./uploads:/app/uploads
    ports:
      - "5000:5000"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:
```

**Acceptance Criteria:**
- `docker compose up -d` starts both services
- App accessible at http://localhost:5000
- PostgreSQL data persists after `docker compose down && docker compose up`
- Uploads persist in `./uploads` directory

---

#### Task 2.3: Create .env.example for Docker

**File:** `.env.example`

```bash
# PostgreSQL password
POSTGRES_PASSWORD=postgres

# OpenAI API key (required)
OPENAI_API_KEY=sk-your-key-here

# Optional: Custom OpenAI base URL
# OPENAI_BASE_URL=https://api.openai.com/v1
```

**Acceptance Criteria:**
- Example file documents all required variables
- Comments explain each variable's purpose
- No sensitive values committed (only placeholders)

---

#### Task 2.4: Create install.sh Script

**File:** `scripts/install.sh`

```bash
#!/bin/bash

set -e

echo "🚀 MyInventory-AI Installer"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
fi

# Check if docker compose is available
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose not found. Update Docker Desktop to latest version."
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo ""
    echo "⚠️  Please edit .env and add your OPENAI_API_KEY"
    echo "   Then run this script again."
    exit 0
fi

# Check if OPENAI_API_KEY is set
if grep -q "sk-your-key-here" .env; then
    echo "❌ Please update OPENAI_API_KEY in .env file"
    exit 1
fi

# Pull latest images
echo "📦 Pulling Docker images..."
docker compose pull

# Build application
echo "🔨 Building application..."
docker compose build

# Start services
echo "🚀 Starting services..."
docker compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to start..."
sleep 5

# Check if app is running
if curl -s http://localhost:5000/api/health > /dev/null; then
    echo ""
    echo "✅ MyInventory-AI is running!"
    echo "   Open http://localhost:5000 in your browser"
    echo ""
    echo "📊 View logs: docker compose logs -f"
    echo "🛑 Stop: docker compose down"
else
    echo "❌ App failed to start. Check logs:"
    docker compose logs app
    exit 1
fi
```

**Acceptance Criteria:**
- Script runs successfully on macOS and Linux
- Checks for Docker installation
- Validates `.env` file exists
- Starts services and verifies health
- Clear success/error messages

---

#### Task 2.5: Create Docker User Guide

**File:** `docs/DOCKER.md`

```markdown
# Running MyInventory-AI with Docker

## Prerequisites

- Docker Desktop 4.0+ (includes Docker Compose)
- OpenAI API key

## Quick Start

### 1. Clone Repository

\`\`\`bash
git clone https://github.com/username/myinventory-ai
cd myinventory-ai
\`\`\`

### 2. Configure Environment

\`\`\`bash
cp .env.example .env
\`\`\`

Edit `.env` and add your OpenAI API key:

\`\`\`
OPENAI_API_KEY=sk-your-actual-key-here
\`\`\`

### 3. Run Installation Script

\`\`\`bash
chmod +x scripts/install.sh
./scripts/install.sh
\`\`\`

### 4. Access Application

Open http://localhost:5000 in your browser.

## Manual Setup

If the install script doesn't work:

\`\`\`bash
# Build and start services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
\`\`\`

## Troubleshooting

### Port 5000 already in use

Edit `docker-compose.yml` and change port mapping:

\`\`\`yaml
ports:
  - "3000:5000"  # Access at http://localhost:3000
\`\`\`

### Database connection errors

Reset database:

\`\`\`bash
docker compose down -v  # Deletes database volume
docker compose up -d
\`\`\`

### OpenAI API errors

- Verify API key in `.env` is correct
- Check OpenAI account has credits
- View app logs: `docker compose logs app`

## Data Persistence

- **Database:** Stored in Docker volume `postgres_data`
- **Uploads:** Stored in `./uploads` directory
- **Backup database:**

\`\`\`bash
docker compose exec postgres pg_dump -U postgres myinventory > backup.sql
\`\`\`

## Updating

\`\`\`bash
git pull
docker compose build
docker compose up -d
\`\`\`
```

**Acceptance Criteria:**
- Documentation covers common scenarios
- Clear step-by-step instructions
- Troubleshooting section addresses likely issues
- Backup/restore procedures documented

---

### Task 3.0: Mini-PC Deployment (Phase 3)

**Priority:** Low
**Timeline:** Months 3-6 (after Docker validated)
**Owner:** Hardware/DevOps team

#### Task 3.1: Hardware Procurement and Testing

**Steps:**

1. Purchase test hardware:
   - **Option 1:** Beelink S12 Pro (Intel N100, $180)
   - **Option 2:** Raspberry Pi 5 (8GB, $110 total)

2. Test requirements:
   - Run Docker Compose successfully
   - Handle 5-10 concurrent users
   - Measure power consumption
   - Test 24/7 reliability (1-week uptime test)

**Acceptance Criteria:**
- Hardware runs MyInventory-AI without issues
- Power consumption < 20W
- No thermal throttling under load
- Cost-effective for target market

---

#### Task 3.2: Create Bootable Image

**Steps:**

1. Install Ubuntu Server 24.04 LTS
2. Pre-install Docker + Docker Compose
3. Clone MyInventory-AI repository to `/opt/myinventory`
4. Create systemd service for auto-start
5. Configure firewall (allow port 5000)
6. Create SD card image (or USB drive image)

**Tools:**
- Raspberry Pi Imager (for Pi 5)
- Ventoy (for USB boot on mini-PC)
- Clonezilla (for image creation)

**Acceptance Criteria:**
- Image boots successfully on target hardware
- MyInventory-AI starts automatically on boot
- Web interface accessible after 2-minute boot time

---

#### Task 3.3: Create Web-Based Setup Wizard

**New Feature:** First-time configuration wizard

**Routes to Add:**

```typescript
// server/routes.ts

app.get("/setup", (req, res) => {
  // Check if setup already completed (e.g., OPENAI_API_KEY exists in config file)
  if (isSetupComplete()) {
    return res.redirect("/");
  }
  // Serve setup.html form
  res.sendFile(path.join(__dirname, "setup.html"));
});

app.post("/setup", wrap(async (req, res) => {
  const { openaiApiKey } = req.body;

  // Validate API key format
  if (!openaiApiKey || !openaiApiKey.startsWith("sk-")) {
    throw new ApiError(400, "INVALID_API_KEY", "Invalid OpenAI API key format");
  }

  // Save to config file
  await saveConfig({ OPENAI_API_KEY: openaiApiKey });

  // Restart application (systemd service)
  res.json({ success: true, message: "Setup complete. Restarting..." });
}));
```

**Acceptance Criteria:**
- User accesses `http://mini-pc.local:5000/setup` on first boot
- Form accepts OpenAI API key
- Key persisted to config file (e.g., `/etc/myinventory/.env`)
- Application restarts automatically after setup

---

#### Task 3.4: Tailscale Integration for Remote Access

**Steps:**

1. Install Tailscale on mini-PC:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   tailscale up
   ```

2. Configure Tailscale advertise-routes (optional):
   ```bash
   tailscale up --advertise-routes=192.168.1.0/24
   ```

3. Access MyInventory-AI via Tailscale hostname:
   - `http://mini-pc.tailscale-domain.ts.net:5000`

**Acceptance Criteria:**
- User can access mini-PC from phone/laptop anywhere
- No port forwarding or dynamic DNS required
- Secure connection (encrypted via Tailscale)

---

#### Task 3.5: Create Mini-PC User Manual

**File:** `docs/MINI-PC-GUIDE.md`

**Sections:**

1. **Hardware Setup** (unboxing, connections)
2. **Initial Configuration** (web setup wizard)
3. **Daily Use** (accessing from devices)
4. **Remote Access** (Tailscale setup)
5. **Troubleshooting** (common issues)
6. **Backup and Restore** (data safety)

**Acceptance Criteria:**
- Non-technical users can follow guide
- Step-by-step photos/screenshots included
- Covers 90% of user questions

---

### Task 4.0: Documentation and Monitoring

**Priority:** Medium
**Timeline:** Ongoing

#### Task 4.1: Update Deployment Documentation

**Files to Update:**

1. **README.md** - Add deployment section
2. **docs/DEPLOYMENT.md** - Railway guide
3. **docs/DOCKER.md** - Docker Compose guide (Task 2.5)
4. **docs/MINI-PC-GUIDE.md** - Hardware guide (Task 3.5)

**Acceptance Criteria:**
- Each deployment method documented
- Links between docs (e.g., Railway → Docker migration)
- Updated architecture diagrams

---

#### Task 4.2: Add Application Monitoring

**Tools to Consider:**

1. **Railway built-in:** Metrics dashboard (free)
2. **Sentry:** Error tracking (free tier: 5k errors/month)
3. **Uptime Kuma:** Self-hosted uptime monitoring (Docker)

**Implementation (Sentry Example):**

```typescript
// server/index.ts
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });

  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.errorHandler());
}
```

**Acceptance Criteria:**
- Errors automatically reported to Sentry
- Performance metrics tracked
- Alerts configured for critical errors

---

#### Task 4.3: Create Backup Strategy

**Railway (Automated):**
- PostgreSQL plugin includes daily backups (7-day retention)
- Volume snapshots available (manual)

**Docker (Manual Scripts):**

**File:** `scripts/backup.sh`

```bash
#!/bin/bash

BACKUP_DIR="./backups/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

# Backup database
docker compose exec -T postgres pg_dump -U postgres myinventory > "$BACKUP_DIR/database.sql"

# Backup uploads
tar -czf "$BACKUP_DIR/uploads.tar.gz" ./uploads

echo "✅ Backup saved to $BACKUP_DIR"
```

**Acceptance Criteria:**
- Database backed up daily
- Upload files backed up weekly
- Backups retained for 30 days
- Restore tested and documented

---

## Part 5: Migration Timeline

### Week 1: Railway Deployment

- [ ] Task 1.1: Create Railway account
- [ ] Task 1.2: Provision PostgreSQL
- [ ] Task 1.3: Configure environment variables
- [ ] Task 1.4: Add persistent volume
- [ ] Task 1.5: Update file storage code
- [ ] Task 1.6: Migrate database (if applicable)
- [ ] Task 1.7: Test deployment
- [ ] Task 1.8: Configure custom domain (optional)

**Deliverable:** Production app running on Railway

---

### Weeks 2-3: Validation and Iteration

- [ ] Monitor Railway metrics (CPU, memory, requests)
- [ ] Test from multiple mobile devices
- [ ] Verify file uploads persist
- [ ] Check OpenAI API usage/costs
- [ ] Document any issues encountered

**Deliverable:** Stable Railway deployment with monitoring

---

### Weeks 4-6: Docker Containerization

- [ ] Task 2.1: Create Dockerfile
- [ ] Task 2.2: Create docker-compose.yml
- [ ] Task 2.3: Create .env.example
- [ ] Task 2.4: Create install.sh script
- [ ] Task 2.5: Create Docker user guide

**Deliverable:** Docker Compose setup ready for testers

---

### Weeks 7-8: Tester Distribution

- [ ] Recruit 5-10 testers
- [ ] Share Docker installation guide
- [ ] Collect feedback on setup process
- [ ] Fix common issues (document in troubleshooting)
- [ ] Iterate on installation script

**Deliverable:** Validated Docker setup for non-technical users

---

### Months 3-6: Mini-PC Hardware Appliance (Optional)

- [ ] Task 3.1: Hardware procurement and testing
- [ ] Task 3.2: Create bootable image
- [ ] Task 3.3: Create web setup wizard
- [ ] Task 3.4: Tailscale integration
- [ ] Task 3.5: Create mini-PC user manual

**Deliverable:** Hardware appliance proof-of-concept

---

## Part 6: Cost Comparison

### Annual Cost Projections (100 users, 10GB storage, 50k requests/month)

| Platform | Monthly Cost | Annual Cost | Notes |
|----------|--------------|-------------|-------|
| **Railway** | $10-15 | $120-180 | Free $5 credit, usage-based |
| **Render** | $14 | $168 | Flat pricing (predictable) |
| **Fly.io** | $5-10 | $60-120 | External DB recommended |
| **Vercel** | $20+ | $240+ | Requires major refactoring |
| **Replit** | $20-30 | $240-360 | Highest cost, vendor lock-in |
| **DigitalOcean** | $25 | $300 | Enterprise-grade reliability |
| **Self-Hosted (VPS)** | $10 | $120 | + hardware if mini-PC |
| **Self-Hosted (Mini-PC)** | $2 | $24 | + $200 one-time hardware |

**Cheapest Long-Term:** Self-hosted mini-PC ($224 total year 1, $24/year after)
**Best Value (Managed):** Railway ($120-180/year with minimal ops overhead)
**Most Expensive:** Replit ($240-360/year with vendor lock-in)

---

## Part 7: Risk Assessment

### Railway Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Platform stability (newer provider) | Medium | Monitor uptime, have Render as backup |
| Usage-based costs spike | Low | Set spending alerts, configure limits |
| Data loss (volume failure) | Low | Regular PostgreSQL backups (automated) |

### Docker Self-Hosted Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Hardware failure (mini-PC) | Medium | Regular backups, spare hardware |
| Internet outage (home ISP) | Medium | Tailscale failover, consider VPS backup |
| Security vulnerabilities | Medium | Regular updates, firewall configuration |
| No managed support | High | Requires DevOps expertise, monitor logs |

### Replit Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Vendor lock-in (Object Storage sidecar) | High | Migrate to Railway (Task 1.0) |
| Cost escalation | Medium | Already at $20/month minimum |
| Platform changes (deprecations) | Medium | Use standard integrations only |

---

## Part 8: Success Metrics

### Technical Metrics

- **Uptime:** >99.5% (Railway monitoring)
- **Response Time:** <500ms (p95 for API requests)
- **Error Rate:** <0.1% (Sentry tracking)
- **Build Time:** <2 minutes (Railway deployment)

### User Metrics

- **Mobile Upload Success Rate:** >95%
- **AI Analysis Success Rate:** >98%
- **File Persistence:** 100% (uploads survive deploys)
- **User Onboarding Time:** <5 minutes (Docker install script)

### Business Metrics

- **Cost Per User:** <$0.50/month (Railway usage-based)
- **Support Tickets:** <5/month (with good documentation)
- **Tester Satisfaction:** >4/5 stars (Docker installation experience)

---

## Conclusion

**Recommended Strategy:**

1. **Immediate (Week 1):** Deploy to Railway
   - Fastest time-to-production
   - Zero code changes
   - $0-15/month cost
   - Clear migration path to Docker

2. **Short-Term (Weeks 4-6):** Add Docker Compose
   - Enable tester distribution
   - Maintain Railway as primary production
   - Validate containerization works

3. **Long-Term (Months 3-6):** Mini-PC proof-of-concept
   - Hardware appliance pathway
   - Self-hosted option for privacy-conscious users
   - Cost-effective for personal/family use

**Key Principle:** Start with managed (Railway) for speed, add Docker for portability, explore hardware for long-term vision.

**Next Steps:**
1. Review and approve this PRD
2. Begin Task 1.0 (Railway deployment)
3. Document lessons learned
4. Iterate based on real-world usage

---

**Prepared by:** Claude Code (AI Agent)
**Date:** 2025-11-20
**Status:** Awaiting Approval
**Related:** PRD-0009 (Replit Deployment), FOUNDATION.md (Architecture Principles)
