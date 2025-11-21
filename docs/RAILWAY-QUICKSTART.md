# Railway Deployment Quick Start Guide

**Status:** Ready to deploy
**Estimated Time:** 15-30 minutes
**Prerequisites:** GitHub account, Railway account, OpenAI API key

---

## ✅ Completed (Task 1.5)

**Code Changes for Railway:**
- ✅ Updated `server/objectStorage.ts` to support Railway persistent volumes
- ✅ Added `LOCAL_STORAGE_DIR` environment variable support
- ✅ Added `USE_LOCAL_STORAGE` flag to override Replit GCS
- ✅ All 34 server tests passing

**Helper Scripts Created:**
- ✅ `scripts/migrate-to-railway.sh` - Database migration helper
- ✅ `scripts/test-railway-deployment.sh` - Deployment verification

---

## 📋 Your Action Items

### Step 1: Create Railway Project (5 minutes)

1. Go to https://railway.app
2. Click **"Login"** → **"Login with GitHub"**
3. Click **"New Project"** → **"Deploy from GitHub repo"**
4. Select repository: `myinventory-ai`
5. Select branch: `main`
6. Wait for initial deployment (~2 minutes)

---

### Step 2: Add PostgreSQL Database (2 minutes)

1. In Railway dashboard, click **"New"** → **"Database"** → **"PostgreSQL"**
2. Wait for provisioning (~30 seconds)
3. Verify `DATABASE_URL` appears in your service's Variables tab

---

### Step 3: Configure Environment Variables (3 minutes)

1. Click on your service (myinventory-ai) → **"Variables"** tab
2. Click **"New Variable"** and add each of these:

```bash
OPENAI_API_KEY=sk-your-actual-openai-key-here
PORT=5000
NODE_ENV=production
LOCAL_STORAGE_DIR=/app/uploads
USE_LOCAL_STORAGE=true
```

3. Verify `DATABASE_URL` is already present (auto-injected from PostgreSQL plugin)
4. Click **"Deploy"** to trigger redeploy with new variables

---

### Step 4: Add Persistent Volume (3 minutes)

1. Service settings → **"Volumes"** tab → **"New Volume"**
2. Configure:
   - **Mount Path:** `/app/uploads`
   - **Size:** `5` GB (adjust based on expected image storage)
3. Click **"Add"**
4. Wait for deployment to restart with volume mounted (~2 minutes)

---

### Step 5: Migrate Database (Optional - if you have existing data)

**If starting fresh:** Skip this step - Railway PostgreSQL is ready to use.

**If migrating from Neon/Replit:**

```bash
# Export current database
export SOURCE_DATABASE_URL="postgresql://user:pass@current-host:5432/db"
./scripts/migrate-to-railway.sh

# Get Railway DATABASE_URL
# (Railway dashboard → PostgreSQL → Connect → Copy connection string)

# Import to Railway
export RAILWAY_DATABASE_URL="postgresql://postgres:xxx@railway.app:5432/railway"
psql "$RAILWAY_DATABASE_URL" < backups/railway-migration-YYYYMMDD-HHMMSS/database.sql

# Verify
psql "$RAILWAY_DATABASE_URL" -c 'SELECT COUNT(*) FROM inventory_items;'
```

---

### Step 6: Test Deployment (5 minutes)

**Automated Tests:**

```bash
# Get your Railway URL from dashboard (e.g., https://myinventory-ai-production.up.railway.app)
./scripts/test-railway-deployment.sh https://your-app.up.railway.app
```

**Expected Output:**
```
✅ PASS - Health check responding
✅ PASS - Frontend loads (HTTP 200)
✅ PASS - GET /api/items works
✅ PASS - Database connected
✅ PASS - HTTPS enabled
✅ PASS - NODE_ENV set to production
```

---

### Step 7: Manual Testing from Mobile (10 minutes)

1. **Access Railway URL** on your phone: `https://your-app.up.railway.app`
2. **Test Image Upload:**
   - Click "Add Item" button
   - Take photo with camera
   - Verify upload succeeds (should show progress indicator)
3. **Verify AI Analysis:**
   - Check if item name, category, and estimated value appear
   - If blank: Check Railway logs for OpenAI API errors
4. **Test Image Persistence:**
   - Note the uploaded image URL (e.g., `/objects/items/abc123.jpg`)
   - Trigger a redeploy in Railway dashboard
   - Verify image still loads after redeploy (persistence test)

---

### Step 8: Configure Custom Domain (Optional)

1. Railway dashboard → Service → **"Settings"** → **"Domains"**
2. Click **"Add Domain"**
3. Enter your domain: `inventory.yourdomain.com`
4. Update DNS at your provider:
   - Type: `CNAME`
   - Name: `inventory`
   - Value: `your-app.up.railway.app`
5. Wait for SSL certificate (~5 minutes)
6. Verify HTTPS works: `https://inventory.yourdomain.com`

---

## 🐛 Troubleshooting

### Issue: "Health check failing" or "502 Bad Gateway"

**Diagnosis:**
```bash
# Check Railway logs
railway logs
```

**Common causes:**
1. Missing `OPENAI_API_KEY` → Add in Variables tab
2. Missing `DATABASE_URL` → Ensure PostgreSQL plugin connected
3. Build error → Check build logs for missing dependencies

---

### Issue: "File uploads fail"

**Diagnosis:**
```bash
# Check if volume is mounted
railway run ls -la /app/uploads
```

**Common causes:**
1. Volume not added → Complete Step 4
2. Wrong mount path → Verify `/app/uploads` in Volume settings
3. Permissions error → Ensure `NODE_ENV=production` and `USE_LOCAL_STORAGE=true` set

---

### Issue: "AI analysis returns blank values"

**Diagnosis:**
```bash
# Check OpenAI API key
railway run sh -c 'echo $OPENAI_API_KEY | cut -c1-10'
# Should show: sk-proj-...
```

**Common causes:**
1. Invalid API key → Verify on https://platform.openai.com/api-keys
2. OpenAI account has no credits → Add payment method
3. API key not set in Railway → Add `OPENAI_API_KEY` variable

**Check logs for specific error:**
```bash
railway logs | grep -i "openai\|ai analysis"
```

---

### Issue: "Database connection errors"

**Diagnosis:**
```bash
# Test database connection
railway run sh -c 'psql $DATABASE_URL -c "SELECT 1;"'
```

**Common causes:**
1. PostgreSQL plugin not added → Complete Step 2
2. `DATABASE_URL` not injected → Verify in Variables tab
3. Database not migrated → Run schema push:
   ```bash
   railway run pnpm db:push
   ```

---

## 📊 Monitoring

**View Logs:**
```bash
# Real-time logs
railway logs -f

# Filter for errors
railway logs | grep -i error

# Filter for specific endpoint
railway logs | grep "/api/items"
```

**Check Metrics:**
- Railway dashboard → Service → **"Metrics"** tab
- Monitor: CPU usage, memory, request count, response times

**Cost Monitoring:**
- Railway dashboard → **"Usage"** tab
- Track: Compute hours, database storage, volume usage
- Set spending limit: Settings → **"Spending Limit"**

---

## 🚀 Next Steps After Deployment

1. **Enable Monitoring:** Add Sentry for error tracking (optional)
2. **Set Up Backups:** Configure automated database backups
3. **Performance Testing:** Load test with 10+ concurrent users
4. **Documentation:** Update README with Railway deployment URL
5. **Phase 2:** Start Task 2.0 (Docker Containerization) for tester distribution

---

## 📚 Additional Resources

**Railway Documentation:**
- Deployments: https://docs.railway.app/deploy/deployments
- Databases: https://docs.railway.app/databases/postgresql
- Volumes: https://docs.railway.app/reference/volumes

**PRD Reference:**
- Full deployment strategy: `tasks/0010-prd-deployment-architecture.md`
- Task breakdown: PRD Part 4 (Actionable Tasks)

**Need Help?**
- Railway Discord: https://discord.gg/railway
- Railway Status: https://status.railway.app

---

**Prepared:** 2025-11-20
**Last Updated:** After Task 1.5 completion
**Next Review:** After successful Railway deployment
