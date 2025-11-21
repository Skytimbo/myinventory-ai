#!/bin/bash

# Railway Database Migration Script
# Exports current database and provides import command for Railway

set -e

echo "🗄️  MyInventory-AI Database Migration"
echo "======================================"
echo ""

# Check if source DATABASE_URL is set
if [ -z "$SOURCE_DATABASE_URL" ]; then
    echo "❌ Error: SOURCE_DATABASE_URL not set"
    echo ""
    echo "Usage:"
    echo "  export SOURCE_DATABASE_URL='postgresql://user:pass@host:port/db'"
    echo "  ./scripts/migrate-to-railway.sh"
    echo ""
    exit 1
fi

# Create backup directory
BACKUP_DIR="./backups/railway-migration-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "📦 Exporting database from source..."
echo "   Source: $SOURCE_DATABASE_URL"
echo ""

# Export database schema and data
if pg_dump "$SOURCE_DATABASE_URL" > "$BACKUP_DIR/database.sql"; then
    echo "✅ Database exported successfully"
    echo "   Location: $BACKUP_DIR/database.sql"
    echo ""
else
    echo "❌ Database export failed"
    exit 1
fi

# Show file size
SIZE=$(du -h "$BACKUP_DIR/database.sql" | cut -f1)
echo "   Size: $SIZE"
echo ""

echo "📊 Database statistics:"
echo "   $(grep -c 'CREATE TABLE' "$BACKUP_DIR/database.sql" || echo 0) tables"
echo "   $(grep -c 'INSERT INTO' "$BACKUP_DIR/database.sql" || echo 0) data rows"
echo ""

echo "✅ Export complete!"
echo ""
echo "Next steps:"
echo "1. Complete Railway setup (Tasks 1.1-1.4)"
echo "2. Get Railway DATABASE_URL from dashboard → PostgreSQL → Connect"
echo "3. Import database to Railway:"
echo ""
echo "   psql \"\$RAILWAY_DATABASE_URL\" < $BACKUP_DIR/database.sql"
echo ""
echo "4. Verify migration:"
echo "   psql \"\$RAILWAY_DATABASE_URL\" -c 'SELECT COUNT(*) FROM inventory_items;'"
echo ""
