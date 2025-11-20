# Execution Plan: PRD-0009 - Replit Deployment Configuration

## Task 1.0: Create Replit configuration files

### Task 1.1: Create .replit file
- **File**: `.replit`
- **Action**: Create new file
- **Content**:
  ```toml
  run = "pnpm start"
  entrypoint = "server/index.ts"

  [nix]
  channel = "stable-24_05"

  [deployment]
  run = ["sh", "-c", "pnpm build && pnpm start"]
  build = ["sh", "-c", "pnpm install && pnpm db:push"]
  ```

### Task 1.2: Create replit.nix file
- **File**: `replit.nix`
- **Action**: Create new file
- **Content**:
  ```nix
  { pkgs }: {
    deps = [
      pkgs.nodejs_20
      pkgs.pnpm
    ];
  }
  ```

---

## Task 2.0: Add health check endpoint

### Task 2.1: Add health route to server/routes.ts
- **File**: `server/routes.ts`
- **Action**: Add new route before other API routes
- **Details**:
  ```typescript
  // Health check endpoint for Replit deployment monitoring
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development"
    });
  });
  ```

---

## Task 3.0: Update environment documentation

### Task 3.1: Update .env.example with complete variables
- **File**: `.env.example`
- **Action**: Replace content with comprehensive documentation
- **Content**:
  ```bash
  # MyInventory AI Environment Variables

  # ===========================================
  # Required for all environments
  # ===========================================

  # Database connection (PostgreSQL)
  DATABASE_URL=postgresql://user:password@host:5432/database

  # OpenAI API key for image analysis
  OPENAI_API_KEY=sk-...

  # ===========================================
  # Optional configuration
  # ===========================================

  # Server port (default: 5000)
  PORT=5000

  # Local storage directory (default: ./uploads)
  # Only used when not on Replit
  LOCAL_STORAGE_DIR=./uploads

  # Cloudflare Tunnel (default: false)
  # Set to "true" to auto-start tunnel with pnpm dev:mobile
  ENABLE_TUNNEL=false

  # ===========================================
  # Replit-specific (auto-configured)
  # ===========================================

  # These are automatically set by Replit:
  # REPL_ID - Replit environment detection
  # AI_INTEGRATIONS_OPENAI_BASE_URL - AI Integrations endpoint
  # PRIVATE_OBJECT_DIR - Object Storage private bucket path
  # PUBLIC_OBJECT_SEARCH_PATHS - Object Storage public paths
  ```

---

## Task 4.0: Fix database reset script

### Task 4.1: Update db-reset.ts to use UUID type
- **File**: `scripts/db-reset.ts`
- **Action**: Read file and update schema definition
- **Details**:
  - Change `id TEXT PRIMARY KEY` to `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - Ensure `pgcrypto` extension is created first

---

## Task 5.0: Create deployment documentation

### Task 5.1: Create docs/replit-deployment.md
- **File**: `docs/replit-deployment.md`
- **Action**: Create comprehensive deployment guide
- **Sections**:
  1. Prerequisites
  2. Quick Start
  3. Database Setup (Neon vs Replit PostgreSQL)
  4. Object Storage Setup
  5. AI Integrations Setup
  6. Environment Variables
  7. Deploying
  8. Testing
  9. Troubleshooting
  10. Updating Deployment

---

## Task 6.0: Test and verify

### Task 6.1: Verify TypeScript compilation
- **Action**: Run `pnpm check`
- **Details**: Ensure no new type errors introduced

### Task 6.2: Run existing tests
- **Action**: Run `pnpm test`
- **Details**: Ensure all tests pass

### Task 6.3: Test health endpoint locally
- **Action**: Start server and curl health endpoint
- **Details**: `curl http://localhost:5000/api/health`

### Task 6.4: Verify build process
- **Action**: Run `pnpm build`
- **Details**: Ensure dist/ output is correct

---

## Implementation Order

**Recommended sequence:**
1. Tasks 1.1-1.2 (Replit configuration files)
2. Task 2.1 (Health endpoint)
3. Task 3.1 (Environment documentation)
4. Task 4.1 (Fix db-reset.ts)
5. Tasks 5.1 (Deployment documentation)
6. Tasks 6.1-6.4 (Testing)

## Files to Create/Modify

| File | Task | Action |
|------|------|--------|
| `.replit` | 1.1 | Create |
| `replit.nix` | 1.2 | Create |
| `server/routes.ts` | 2.1 | Modify |
| `.env.example` | 3.1 | Modify |
| `scripts/db-reset.ts` | 4.1 | Modify |
| `docs/replit-deployment.md` | 5.1 | Create |

## Success Criteria

- [ ] `.replit` and `replit.nix` created with correct syntax
- [ ] Health endpoint returns JSON with status, timestamp, environment
- [ ] `.env.example` documents all required and optional variables
- [ ] `db-reset.ts` uses UUID type matching schema
- [ ] Deployment documentation is comprehensive
- [ ] TypeScript check passes
- [ ] All tests pass
- [ ] Build completes successfully

## Estimated Time

~2-3 hours total implementation
