# PRD-0009: Complete Replit Deployment Configuration

## Document Header

| Field | Value |
|-------|-------|
| Status | Draft |
| Created | 2025-11-19 |
| Last Updated | 2025-11-19 |
| Author | Claude Code |
| Type | Infrastructure / DevOps |
| Related PRDs | PRD-0002 (Dual-Env Image Persistence) |

---

## 1. Overview

### Current State

MyInventory-AI already has substantial Replit support built into its architecture:

- **Environment detection** - `REPL_ID` check throughout codebase
- **Dual storage backend** - Local filesystem vs Google Cloud Storage (Replit Object Storage)
- **Static file serving** - Production mode serves built assets from `dist/public`
- **Port configuration** - Respects `PORT` environment variable
- **Build scripts** - `pnpm build && pnpm start` already works

### Problem Statement

Despite this foundation, the app cannot be deployed to Replit because:

1. **Missing configuration files** - No `.replit` or `replit.nix` to define run commands
2. **Incomplete documentation** - Required environment variables not fully documented
3. **No health endpoint** - Replit's deployment health checks require `GET /api/health`

### Solution Summary

Add the missing configuration files and documentation to enable one-click deployment on Replit. This is primarily a configuration task, not an architectural change.

---

## 2. Goals

### Primary Goals

1. **Zero-Config Deployment** - Import from GitHub and deploy with minimal manual steps
2. **Always-On Access** - Reliable HTTPS URL accessible from any device
3. **Mobile Camera Support** - HTTPS enables `<input type="file" capture="camera">`
4. **Maintain Local Dev** - No breaking changes to local development workflow

### Secondary Goals

1. **Comprehensive Documentation** - Step-by-step Replit setup guide
2. **Environment Validation** - Clear error messages for missing configuration

### Non-Goals

1. **Authentication** - No user accounts (future PRD)
2. **Multi-tenancy** - Single-user system
3. **Alternative Platforms** - Not targeting Vercel/Fly/Render

---

## 3. Non-Goals

- **Rewriting storage layer** - Already abstracted correctly
- **Creating new server files** - Existing `server/index.ts` handles production
- **SQLite support** - App uses PostgreSQL with Drizzle ORM
- **CORS configuration** - Same-origin serving eliminates need

---

## 4. User Stories

### US-1: Developer Deploys to Replit

**As a** developer,
**I want** to import my GitHub repo into Replit and have it run automatically,
**So that** I have a persistent deployment without manual server management.

**Acceptance Criteria:**
- [ ] Import from GitHub succeeds
- [ ] `pnpm install` runs automatically
- [ ] `pnpm build` completes without errors
- [ ] Server starts and responds to requests

### US-2: Mobile User Accesses App

**As a** mobile user,
**I want** to open MyInventory from my phone at any time,
**So that** I can catalog items from anywhere.

**Acceptance Criteria:**
- [ ] App loads on iOS/Android browsers
- [ ] Camera permission prompt appears
- [ ] Photo upload succeeds
- [ ] AI analysis returns results

### US-3: Developer Updates Deployment

**As a** developer,
**I want** Replit to rebuild after I push to GitHub,
**So that** my deployment stays current.

**Acceptance Criteria:**
- [ ] Push to GitHub triggers Replit rebuild
- [ ] New code is reflected in running app
- [ ] No manual intervention required

---

## 5. Functional Requirements

### FR-1: Replit Configuration Files

Create `.replit` and `replit.nix` to define build and run commands.

**.replit:**
```toml
run = "pnpm start"
entrypoint = "server/index.ts"

[nix]
channel = "stable-24_05"

[deployment]
run = ["sh", "-c", "pnpm build && pnpm start"]
build = ["sh", "-c", "pnpm install && pnpm db:push"]
```

**replit.nix:**
```nix
{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.pnpm
  ];
}
```

### FR-2: Health Check Endpoint

Add `GET /api/health` for Replit deployment monitoring.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-19T12:00:00.000Z",
  "environment": "production"
}
```

### FR-3: Complete Environment Documentation

Update `.env.example` with all required variables:

```bash
# Database (required)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# AI Analysis (required)
OPENAI_API_KEY=sk-...
# On Replit, this is auto-set by AI Integrations:
# AI_INTEGRATIONS_OPENAI_BASE_URL=https://...

# Server Configuration
PORT=5000
NODE_ENV=production

# Replit Object Storage (required on Replit, auto-configured)
# PRIVATE_OBJECT_DIR=/bucket-name/private
# PUBLIC_OBJECT_SEARCH_PATHS=/bucket-name/public
```

### FR-4: Deployment Documentation

Create `/docs/replit-deployment.md` with:

1. Prerequisites (GitHub repo, Replit account)
2. Creating PostgreSQL database
3. Creating Object Storage bucket
4. Enabling AI Integrations
5. Setting secrets
6. Deploying and testing

### FR-5: Database Schema Fix

Fix `scripts/db-reset.ts` to use correct UUID type matching `shared/schema.ts`.

---

## 6. Technical Requirements

### TR-1: No New Server Files

Use existing `server/index.ts` which already:
- Serves static files in production via `serveStatic()`
- Routes `/api/*` to Express handlers
- Respects `PORT` environment variable

### TR-2: Build Output Structure

Maintain existing structure:
```
dist/
  index.js          <- Bundled server
  public/           <- Vite build output
    index.html
    assets/
```

### TR-3: Database Compatibility

App uses:
- `@neondatabase/serverless` for PostgreSQL
- Drizzle ORM for schema/queries
- `drizzle-kit push` for migrations

Replit PostgreSQL or external Neon database both work.

### TR-4: Storage Routing

Existing code in `server/routes.ts:206-215`:
```typescript
if (isReplit) {
  const objectFile = await objectStorage.getObjectEntityFile(req.path);
  objectStorage.downloadObject(objectFile, res);
} else {
  const localPath = await objectStorage.getLocalObjectFile(req.path);
  objectStorage.downloadLocalObject(localPath, res);
}
```

No changes needed.

---

## 7. Success Metrics

### Deployment Criteria
- [ ] Replit imports GitHub repo successfully
- [ ] Build completes in < 2 minutes
- [ ] Server starts and responds to health check
- [ ] App accessible via Replit URL

### Functional Criteria
- [ ] Inventory list loads
- [ ] Image upload works
- [ ] AI analysis returns values
- [ ] Images persist across restarts

### Mobile Criteria
- [ ] Camera opens on iOS Safari
- [ ] Camera opens on Android Chrome
- [ ] Photos upload successfully

---

## 8. Acceptance Tests

### AT-1: Fresh Deployment

1. Create new Replit from GitHub import
2. Add secrets: `DATABASE_URL`, `OPENAI_API_KEY`
3. Click "Run"
4. Verify app loads at Replit URL
5. Verify health check: `curl https://[repl-url]/api/health`

### AT-2: Mobile Camera

1. Open Replit URL on iPhone
2. Tap upload button
3. Select "Take Photo"
4. Capture and upload image
5. Verify AI analysis completes

### AT-3: Data Persistence

1. Upload item via Replit deployment
2. Stop and restart Repl
3. Verify item still appears in list
4. Verify image still loads

### AT-4: GitHub Sync

1. Make local code change
2. Push to GitHub
3. Pull in Replit
4. Verify change reflected in running app

---

## 9. Design Considerations

### Architecture Unchanged

```
┌─────────────────────────────────────────┐
│              Replit                      │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │       Express Server              │   │
│  │       (server/index.ts)           │   │
│  │                                    │   │
│  │  ┌────────────┐  ┌─────────────┐  │   │
│  │  │ Static     │  │ API Routes  │  │   │
│  │  │ /dist/     │  │ /api/*      │  │   │
│  │  │ public     │  │             │  │   │
│  │  └────────────┘  └──────┬──────┘  │   │
│  │                         │         │   │
│  └─────────────────────────┼─────────┘   │
│                            │             │
│  ┌─────────────┐  ┌────────▼────────┐   │
│  │ Object      │  │ PostgreSQL      │   │
│  │ Storage     │  │ (Neon/Replit)   │   │
│  │ (GCS)       │  │                 │   │
│  └─────────────┘  └─────────────────┘   │
│                                          │
└─────────────────────────────────────────┘
```

### File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `.replit` | Create | Run/build commands |
| `replit.nix` | Create | Node.js environment |
| `.env.example` | Modify | Add all required vars |
| `server/routes.ts` | Modify | Add health endpoint |
| `scripts/db-reset.ts` | Modify | Fix UUID schema |
| `docs/replit-deployment.md` | Create | Deployment guide |

---

## 10. Constraints

1. **Single Port** - Replit exposes only one port; already handled
2. **No Local Persistence** - Must use Object Storage; already implemented
3. **Secrets Management** - Use Replit Secrets for sensitive vars
4. **Build Time** - Keep under Replit's 5-minute build limit

---

## 11. Open Questions

### Q1: Use Replit PostgreSQL or external Neon?

**Recommendation:** Document both options. Neon is already integrated and provides better free tier.

### Q2: Should we add PWA support?

**Decision:** Out of scope for this PRD. Consider for future enhancement.

---

## 12. Out of Scope

1. User authentication
2. PWA "Add to Home Screen"
3. Custom domain configuration
4. CI/CD pipeline
5. Automated testing on Replit

---

## 13. Tasks

### High-Level Tasks

1. **Task 1.0: Create Replit configuration files**
   - Create `.replit` with run/build commands
   - Create `replit.nix` with Node.js 20 and pnpm

2. **Task 2.0: Add health check endpoint**
   - Add `GET /api/health` to server/routes.ts
   - Return status, timestamp, environment

3. **Task 3.0: Update environment documentation**
   - Update `.env.example` with all variables
   - Add Replit-specific variable comments

4. **Task 4.0: Fix database reset script**
   - Update `scripts/db-reset.ts` to use UUID
   - Match schema in `shared/schema.ts`

5. **Task 5.0: Create deployment documentation**
   - Create `docs/replit-deployment.md`
   - Step-by-step setup guide
   - Troubleshooting section

6. **Task 6.0: Test and verify**
   - Test fresh deployment
   - Test mobile camera
   - Test data persistence

**Ready for high-level task approval.**
