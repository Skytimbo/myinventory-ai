#!/bin/bash
# scripts/reset-inventory.sh
#
# Convenience wrapper to truncate the inventory_items table.
# Usage: ./scripts/reset-inventory.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Check if DATABASE_URL is set (either from environment or .env will be loaded by script)
if [ -z "$DATABASE_URL" ] && [ ! -f ".env" ]; then
  echo "ERROR: DATABASE_URL is not set and no .env file found."
  echo "Please set DATABASE_URL or create a .env file."
  exit 1
fi

# Run the TypeScript script using tsx
echo "Running inventory reset..."
npx tsx scripts/reset-inventory.ts
