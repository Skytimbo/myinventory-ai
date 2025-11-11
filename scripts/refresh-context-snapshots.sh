#!/bin/bash
# Regenerate context audit snapshots after documentation updates
# Updates:
# - .context_audit/tree.txt
# - .context_audit/doc_inventory.csv
# - SHA256 in CONTEXT.md front-matter

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${BLUE}📦 Refreshing CONTEXT.md snapshots...${NC}"

# Ensure audit directory exists
mkdir -p .context_audit/snippets

# 1. Regenerate tree listing
echo "🌳 Generating tree listing..."
if command -v tree &> /dev/null; then
  tree -L 3 -I 'node_modules|.git|dist|venv|__pycache__|playwright-report|test-results' > .context_audit/tree.txt
else
  # Fallback if tree command not available
  find . -not -path '*/node_modules/*' \
         -not -path '*/.git/*' \
         -not -path '*/dist/*' \
         -not -path '*/venv/*' \
         -not -path '*/__pycache__/*' \
         -not -path '*/playwright-report/*' \
         -not -path '*/test-results/*' \
    | head -200 | sort > .context_audit/tree.txt
fi

# 2. Regenerate markdown inventory
echo "📝 Regenerating markdown inventory..."
{
  echo "path,size,last_modified"
  find . -type d \( -name node_modules -o -name .git -o -name venv -o -name __pycache__ -o -name playwright-report -o -name test-results \) -prune -false -o \
         -type f -iname "*.md" -print0 \
    | while IFS= read -r -d '' f; do
        size=$(stat -f "%z" "$f" 2>/dev/null || stat -c "%s" "$f")
        mtime=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$f" 2>/dev/null || stat -c "%y" "$f")
        # Generate snippet
        head -n 5 "$f" > ".context_audit/snippets/$(echo "$f" | sed 's#^\./##; s#/#__#g').head5.txt" 2>/dev/null || true
        printf '%s,%s,%s\n' "$f" "$size" "$mtime"
      done
} > .context_audit/doc_inventory.csv

# 3. Create last_md.txt snapshot (list of markdown files for diff checking)
echo "📸 Creating markdown file snapshot..."
find . -type f -iname "*.md" \
       -not -path '*/node_modules/*' \
       -not -path '*/.git/*' \
       -not -path '*/dist/*' \
       -not -path '*/venv/*' \
       -not -path '*/__pycache__/*' \
       -not -path '*/playwright-report/*' \
       -not -path '*/test-results/*' \
    | sort > .context_audit/last_md.txt

# 4. Update SHA256 in CONTEXT.md
echo "🔐 Computing CONTEXT.md SHA256..."

# First, we need to zero out the old SHA256 to compute the new one
# This is a chicken-and-egg problem, so we'll use a placeholder approach
TEMP_FILE=$(mktemp)
cp CONTEXT.md "$TEMP_FILE"

# Compute SHA256 of current file
ACTUAL_SHA=$(shasum -a 256 CONTEXT.md | awk '{print $1}')

# Update the SHA256 in the file
if grep -q "sha256_of_this_file:" CONTEXT.md; then
  # macOS sed requires explicit empty string for -i
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/sha256_of_this_file: \".*\"/sha256_of_this_file: \"$ACTUAL_SHA\"/" CONTEXT.md
  else
    sed -i "s/sha256_of_this_file: \".*\"/sha256_of_this_file: \"$ACTUAL_SHA\"/" CONTEXT.md
  fi
  echo "Updated SHA256: $ACTUAL_SHA"
fi

# Clean up
rm -f "$TEMP_FILE"

echo -e "${GREEN}✅ Context snapshots refreshed successfully${NC}"
echo ""
echo "Updated files:"
echo "  - .context_audit/tree.txt"
echo "  - .context_audit/doc_inventory.csv"
echo "  - .context_audit/last_md.txt"
echo "  - .context_audit/snippets/"
echo "  - CONTEXT.md (SHA256 updated)"
echo ""
echo "Review changes and commit if needed:"
echo "  git add .context_audit/ CONTEXT.md"
echo "  git commit -m 'chore: refresh context audit snapshots'"
