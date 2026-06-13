#!/bin/bash

# Railway Deployment Testing Script
# Verifies all critical functionality works after deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ -z "$1" ]; then
    echo "Usage: ./scripts/test-railway-deployment.sh <railway-url> [inventory-password]"
    echo "Example: ./scripts/test-railway-deployment.sh https://myinventory-ai-production.up.railway.app 'your-password'"
    exit 1
fi

RAILWAY_URL="$1"
INVENTORY_PASSWORD_ARG="${2:-${INVENTORY_PASSWORD:-}}"
COOKIE_JAR="$(mktemp)"
LOGIN_RESPONSE="$(mktemp)"

trap 'rm -f "$COOKIE_JAR" "$LOGIN_RESPONSE"' EXIT

echo "🧪 Testing Railway Deployment"
echo "==============================="
echo "URL: $RAILWAY_URL"
echo ""

# Test 1: Health Check
echo "Test 1: Health Check Endpoint"
echo "------------------------------"
if curl -sf "$RAILWAY_URL/api/health" > /dev/null; then
    HEALTH=$(curl -s "$RAILWAY_URL/api/health")
    echo -e "${GREEN}✅ PASS${NC} - Health check responding"
    echo "   Response: $HEALTH"
else
    echo -e "${RED}❌ FAIL${NC} - Health check failed"
    exit 1
fi
echo ""

# Test 2: Frontend Loads
echo "Test 2: Frontend Application"
echo "------------------------------"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$RAILWAY_URL/")
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ PASS${NC} - Frontend loads (HTTP $HTTP_CODE)"
else
    echo -e "${RED}❌ FAIL${NC} - Frontend error (HTTP $HTTP_CODE)"
    exit 1
fi
echo ""

# Test 3: API Endpoints
echo "Test 3: Authentication"
echo "------------------------------"
AUTH_STATUS=$(curl -s "$RAILWAY_URL/api/auth/status")
AUTH_ENABLED=$(echo "$AUTH_STATUS" | jq -r '.authEnabled')
AUTHENTICATED=$(echo "$AUTH_STATUS" | jq -r '.authenticated')

if [ "$AUTH_ENABLED" = "true" ]; then
    if [ -z "$INVENTORY_PASSWORD_ARG" ]; then
        echo -e "${RED}❌ FAIL${NC} - App requires login. Pass password as arg 2 or INVENTORY_PASSWORD env var."
        exit 1
    fi

    LOGIN_CODE=$(curl -s -o "$LOGIN_RESPONSE" -w "%{http_code}" \
        -c "$COOKIE_JAR" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg password "$INVENTORY_PASSWORD_ARG" '{password: $password}')" \
        "$RAILWAY_URL/api/auth/login")

    if [ "$LOGIN_CODE" = "200" ]; then
        echo -e "${GREEN}✅ PASS${NC} - Login works"
    else
        echo -e "${RED}❌ FAIL${NC} - Login failed (HTTP $LOGIN_CODE)"
        echo "   Response: $(cat "$LOGIN_RESPONSE")"
        exit 1
    fi
elif [ "$AUTHENTICATED" = "true" ]; then
    echo -e "${YELLOW}⚠️  WARN${NC} - Auth is disabled on this deployment"
else
    echo -e "${RED}❌ FAIL${NC} - Unexpected auth status: $AUTH_STATUS"
    exit 1
fi
echo ""

# Test 4: Protected API Endpoints
echo "Test 4: Protected API Endpoints"
echo "------------------------------"

# Get items (should return empty array initially or existing items)
GET_ITEMS=$(curl -s -b "$COOKIE_JAR" "$RAILWAY_URL/api/items")
if echo "$GET_ITEMS" | jq . > /dev/null 2>&1; then
    ITEM_COUNT=$(echo "$GET_ITEMS" | jq '. | length')
    echo -e "${GREEN}✅ PASS${NC} - GET /api/items works ($ITEM_COUNT items)"
else
    echo -e "${RED}❌ FAIL${NC} - GET /api/items returned invalid JSON"
    exit 1
fi
echo ""

# Test 5: Database Connection
echo "Test 5: Database Connection"
echo "------------------------------"
if [ "$ITEM_COUNT" != "null" ]; then
    echo -e "${GREEN}✅ PASS${NC} - Database connected and queried successfully"
else
    echo -e "${RED}❌ FAIL${NC} - Database query returned null"
    exit 1
fi
echo ""

# Test 6: SSL Certificate
echo "Test 6: SSL Certificate"
echo "------------------------------"
if echo "$RAILWAY_URL" | grep -q "https://"; then
    if curl -sSI "$RAILWAY_URL" | grep -q "HTTP.*200\|HTTP.*301\|HTTP.*302"; then
        echo -e "${GREEN}✅ PASS${NC} - HTTPS enabled and working"
    else
        echo -e "${YELLOW}⚠️  WARN${NC} - HTTPS enabled but returned unexpected status"
    fi
else
    echo -e "${YELLOW}⚠️  WARN${NC} - Testing HTTP (not HTTPS)"
fi
echo ""

# Test 7: OpenAI Configuration
echo "Test 7: OpenAI Configuration"
echo "------------------------------"
OPENAI_HEALTH=$(curl -s -b "$COOKIE_JAR" "$RAILWAY_URL/api/health/openai")
PROJECT_STATUS=$(echo "$OPENAI_HEALTH" | jq -r '.project_validation_status // empty')
API_KEY_EXISTS=$(echo "$OPENAI_HEALTH" | jq -r '.OPENAI_API_KEY_exists // empty')

if [ "$PROJECT_STATUS" = "ok" ] || [ "$API_KEY_EXISTS" = "true" ]; then
    echo -e "${GREEN}✅ PASS${NC} - OpenAI health endpoint works"
    echo "   Response: $OPENAI_HEALTH"
else
    echo -e "${YELLOW}⚠️  WARN${NC} - OpenAI health endpoint returned unexpected response"
    echo "   Response: $OPENAI_HEALTH"
fi
echo ""

# Summary
echo "==============================="
echo -e "${GREEN}✅ All critical tests passed!${NC}"
echo ""
echo "Next steps:"
echo "1. Test image upload from mobile device"
echo "2. Verify AI analysis works (requires OPENAI_API_KEY)"
echo "3. Check Railway logs for any errors"
echo "4. Monitor performance in Railway dashboard"
echo ""
echo "Manual tests to perform:"
echo "- Upload image from phone camera"
echo "- Verify image persists after redeploy"
echo "- Check uploaded image accessible at /objects/items/..."
echo "- Verify AI returns item name, category, estimated value"
echo ""
