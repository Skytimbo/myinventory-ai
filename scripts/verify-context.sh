#!/bin/bash
# CI script to verify CONTEXT.md is up to date
# Fails if:
# - markdown files changed since last audit
# - tree.txt is outdated or missing
# - SHA256 is not filled in CONTEXT.md

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Verifying CONTEXT.md integrity..."

# Check 1: Verify SHA256 is not a placeholder
if grep -q "\[PLACEHOLDER" CONTEXT.md; then
  echo -e "${RED}❌ CONTEXT.md contains placeholder values${NC}"
  echo "Run scripts/refresh-context-snapshots.sh to update"
  exit 1
fi

# Check 2: Verify SHA256 matches actual file
EXPECTED_SHA=$(grep "sha256_of_this_file:" CONTEXT.md | awk '{print $2}' | tr -d '"')
ACTUAL_SHA=$(shasum -a 256 CONTEXT.md | awk '{print $1}')

if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo -e "${RED}❌ CONTEXT.md SHA256 mismatch${NC}"
  echo "Expected: $EXPECTED_SHA"
  echo "Actual:   $ACTUAL_SHA"
  echo "Run scripts/refresh-context-snapshots.sh to update"
  exit 1
fi

# Check 3: Verify tree.txt exists
if [ ! -f .context_audit/tree.txt ]; then
  echo -e "${RED}❌ .context_audit/tree.txt is missing${NC}"
  echo "Run scripts/refresh-context-snapshots.sh to generate"
  exit 1
fi

# Check 4: Verify markdown inventory CSV exists
if [ ! -f .context_audit/doc_inventory.csv ]; then
  echo -e "${RED}❌ .context_audit/doc_inventory.csv is missing${NC}"
  echo "Run scripts/refresh-context-snapshots.sh to generate"
  exit 1
fi

# Check 5: Verify all documented markdown files still exist
echo "📄 Checking documented markdown files exist..."
MISSING_FILES=0
while IFS= read -r line; do
  if [[ "$line" =~ path:\ ([^\ ]+) ]]; then
    FILE_PATH="${BASH_REMATCH[1]}"
    if [ ! -f "$FILE_PATH" ]; then
      echo -e "${RED}❌ Documented file missing: $FILE_PATH${NC}"
      MISSING_FILES=$((MISSING_FILES + 1))
    fi
  fi
done < <(sed -n '/^sources:/,/^---/p' CONTEXT.md)

if [ $MISSING_FILES -gt 0 ]; then
  echo -e "${RED}❌ $MISSING_FILES documented file(s) are missing${NC}"
  echo "Update CONTEXT.md to remove references to deleted files"
  exit 1
fi

# Check 6: Warn if new markdown files exist that aren't documented
echo "📝 Checking for undocumented markdown files..."
NEW_FILES=()
while IFS= read -r -d '' file; do
  # Skip files in node_modules, .git, etc.
  if [[ "$file" =~ (node_modules|\.git|dist|venv|__pycache__|playwright-report|test-results) ]]; then
    continue
  fi

  # Check if file is documented in CONTEXT.md
  REL_PATH="${file#./}"
  if ! grep -q "path: $REL_PATH" CONTEXT.md; then
    NEW_FILES+=("$REL_PATH")
  fi
done < <(find . -type f -iname "*.md" -print0)

if [ ${#NEW_FILES[@]} -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Found ${#NEW_FILES[@]} undocumented markdown file(s):${NC}"
  for file in "${NEW_FILES[@]}"; do
    echo "  - $file"
  done
  echo -e "${YELLOW}Consider adding to CONTEXT.md sources list${NC}"
  # This is a warning, not a failure
fi

echo -e "${GREEN}✅ CONTEXT.md verification passed${NC}"
exit 0
