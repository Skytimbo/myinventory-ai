# Replit Deployment Guide

Deploy MyInventory-AI to Replit for always-on mobile access without managing infrastructure.

## Prerequisites

- GitHub repository with MyInventory-AI code
- Replit account (free tier works)
- OpenAI API key

---

## Quick Start

### 1. Import from GitHub

1. Go to [replit.com](https://replit.com)
2. Click "Create Repl"
3. Select "Import from GitHub"
4. Paste your repository URL
5. Click "Import from GitHub"

Replit will detect the `.replit` configuration and set up the environment.

### 2. Add Secrets

Go to **Tools > Secrets** and add:

| Secret | Value |
|--------|-------|
| `DATABASE_URL` | Your PostgreSQL connection string |
| `OPENAI_API_KEY` | Your OpenAI API key |

### 3. Enable Integrations

Go to **Tools > Integrations** and enable:

- **Object Storage** - For image persistence
- **AI Integrations** (optional) - Uses Replit's AI proxy

### 4. Deploy

1. Click the **Run** button to start in development mode
2. Or click **Deploy** for production deployment

---

## Database Setup

### Option A: Neon (Recommended)

[Neon](https://neon.tech) provides a free PostgreSQL database with generous limits.

1. Create account at [neon.tech](https://neon.tech)
2. Create a new project
3. Copy the connection string
4. Add as `DATABASE_URL` secret in Replit

**Connection string format:**
```
postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### Option B: Replit PostgreSQL

Replit offers built-in PostgreSQL.

1. Go to **Tools > Database**
2. Select PostgreSQL
3. Replit auto-sets `DATABASE_URL`

**Note:** Replit's free tier has storage limits. Neon offers more free storage.

---

## Object Storage Setup

Object Storage is required for image persistence on Replit.

### Enable Integration

1. Go to **Tools > Integrations**
2. Enable **Object Storage**
3. Replit auto-configures:
   - `PRIVATE_OBJECT_DIR`
   - `PUBLIC_OBJECT_SEARCH_PATHS`

### How It Works

The app automatically detects Replit via `REPL_ID` and routes uploads to Google Cloud Storage through Replit's sidecar service.

```typescript
// Automatic detection in routes.ts
const isReplit = process.env.REPL_ID !== undefined;

if (isReplit) {
  // Use Replit Object Storage
  await objectStorage.saveToGCS(file);
} else {
  // Use local filesystem
  await objectStorage.saveLocally(file);
}
```

---

## AI Integrations (Optional)

Replit's AI Integrations provides a proxied OpenAI endpoint with usage tracking.

### Enable

1. Go to **Tools > Integrations**
2. Enable **AI Integrations**
3. Replit auto-sets `AI_INTEGRATIONS_OPENAI_BASE_URL`

### How It Works

When enabled, the app uses Replit's proxy endpoint instead of calling OpenAI directly. This provides:

- Usage monitoring in Replit dashboard
- Potential cost savings
- Simplified key management

**Note:** You still need `OPENAI_API_KEY` set in Secrets.

---

## Environment Variables

### Required Secrets

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENAI_API_KEY` | OpenAI API key for image analysis |

### Auto-Configured by Replit

| Variable | Description |
|----------|-------------|
| `REPL_ID` | Replit environment detection |
| `PORT` | Server port (default: 5000) |
| `PRIVATE_OBJECT_DIR` | Object Storage bucket path |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Public asset paths |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | AI proxy endpoint |

---

## Deployment Commands

### Development Mode

```bash
pnpm dev
```

Starts Vite dev server with hot reload.

### Production Deployment

Replit runs these automatically:

```bash
# Build step
pnpm install && pnpm db:push && pnpm build

# Run step
pnpm start
```

### Database Operations

```bash
# Push schema changes to database
pnpm db:push

# Reset database (development only)
pnpm db:reset

# Seed test data
pnpm db:seed
```

---

## Testing Your Deployment

### 1. Health Check

```bash
curl https://your-repl-url.replit.dev/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-11-19T12:00:00.000Z",
  "environment": "production"
}
```

### 2. Mobile Camera Test

1. Open your Repl URL on iPhone/Android
2. Tap the upload button
3. Select "Take Photo"
4. Capture and upload
5. Verify AI analysis completes

### 3. Data Persistence Test

1. Upload an item
2. Stop and restart the Repl
3. Verify item appears in list
4. Verify image loads correctly

---

## Troubleshooting

### "DATABASE_URL must be set"

**Cause:** Missing database configuration.

**Solution:**
1. Go to **Tools > Secrets**
2. Add `DATABASE_URL` with your PostgreSQL connection string

### "OPENAI_API_KEY must be set"

**Cause:** Missing OpenAI API key.

**Solution:**
1. Go to **Tools > Secrets**
2. Add `OPENAI_API_KEY` with your API key

### Images Not Loading

**Cause:** Object Storage not enabled.

**Solution:**
1. Go to **Tools > Integrations**
2. Enable **Object Storage**
3. Restart the Repl

### Build Fails with "db:push" Error

**Cause:** Database not accessible during build.

**Solution:**
1. Verify `DATABASE_URL` is correct
2. Check database is accepting connections
3. If using Neon, ensure project is awake

### App Shows "Cannot GET /"

**Cause:** Static files not built or served.

**Solution:**
1. Run `pnpm build` manually
2. Check `dist/public/index.html` exists
3. Verify `NODE_ENV=production`

### Camera Permission Denied on Mobile

**Cause:** Not using HTTPS.

**Solution:** Replit provides HTTPS by default. Ensure you're using the `.replit.dev` URL, not `localhost`.

---

## Updating Your Deployment

### From GitHub

1. Make changes locally
2. Push to GitHub
3. In Replit, click **Git** panel
4. Pull latest changes
5. Click **Run** or **Deploy**

### Manual Rebuild

```bash
pnpm build && pnpm start
```

---

## Architecture on Replit

```
┌─────────────────────────────────────────┐
│              Replit                      │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │       Express Server              │   │
│  │       (dist/index.js)             │   │
│  │                                    │   │
│  │  GET /api/*  →  API Routes        │   │
│  │  GET /*      →  Static Files      │   │
│  └──────────────┬───────────────────┘   │
│                 │                        │
│  ┌──────────────┼──────────────────┐    │
│  │              │                   │    │
│  ▼              ▼                   ▼    │
│ Object      PostgreSQL          OpenAI  │
│ Storage     (Neon/Replit)       (API)   │
│ (GCS)                                   │
└─────────────────────────────────────────┘
```

---

## Cost Considerations

### Replit Free Tier

- Limited compute hours
- May sleep after inactivity
- Object Storage has limits

### Replit Core/Pro

- Always-on deployments
- More compute resources
- Higher Object Storage limits

### External Services

- **Neon:** Free tier includes 3GB storage
- **OpenAI:** Pay per API call

---

## Related Documentation

- [PRD-0009: Replit Deployment](../tasks/0009-prd-replit-deployment.md)
- [Environment Variables](./.env.example)
- [Cloudflare Tunnel](./cloudflare-tunnel.md) (for local development)
