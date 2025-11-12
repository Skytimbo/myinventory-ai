# ADR-001: Database Keys Strategy

**Status:** Accepted

**Date:** 2025-11-11

**Deciders:** Development Team

**Context:**
This ADR documents the decision made during E2E testing implementation regarding primary key generation strategy for the myinventory-ai application.

---

## Decision

**Use PostgreSQL-generated UUIDs for all database primary keys.**

- Primary keys are generated using PostgreSQL's built-in `gen_random_uuid()` function
- Database schema defines: `id: varchar("id").primaryKey().default(sql`gen_random_uuid()`)`
- The `nanoid` library (already in dependencies) is reserved for non-primary-key tokens only (e.g., temporary upload tokens, session IDs, invite codes)

---

## Rationale

### Why PostgreSQL UUIDs?

1. **Database-Level Guarantees**
   - UUIDs are generated atomically at the database layer during INSERT
   - No application-level coordination required
   - Prevents race conditions and duplicate key errors

2. **Performance & Indexing**
   - PostgreSQL's UUID type is optimized for indexing
   - Native UUID functions are highly efficient
   - B-tree indexes work well with UUIDs

3. **Distributed System Readiness**
   - UUIDs are globally unique without coordination
   - Safe for future multi-instance deployments
   - No single point of failure for ID generation

4. **Standard Compliance**
   - RFC 4122 compliant
   - Widely supported across tools and libraries
   - Industry-standard approach

### Why Not nanoid for Primary Keys?

1. **Application-Layer Complexity**
   - Requires application to generate ID before INSERT
   - Adds extra round-trip for insertion logic
   - Complicates error handling

2. **Testing Challenges**
   - E2E tests encountered issues with nanoid import paths in Node.js ESM
   - Required workarounds: explicit import paths, runtime dependency declarations
   - Added maintenance burden

3. **Drizzle ORM Integration**
   - Drizzle naturally supports PostgreSQL default functions
   - Using nanoid requires custom logic in application layer
   - Violates "database as source of truth" principle

### When to Use nanoid?

The `nanoid` library remains in the project for specific use cases:

- **Temporary Tokens**: Short-lived upload URLs, session identifiers
- **Human-Readable IDs**: Shareable links, invite codes (e.g., `inv_a1b2c3`)
- **Non-Database Identifiers**: Client-side request IDs, trace IDs

**Key Distinction:** nanoid is for application-layer, human-friendly, or ephemeral identifiers—NOT for database primary keys.

---

## Consequences

### Positive

- ✅ Simplified database schema with PostgreSQL native functions
- ✅ Reduced application complexity—no custom ID generation logic
- ✅ Improved E2E test reliability (no ESM import issues)
- ✅ Better alignment with Drizzle ORM patterns
- ✅ Future-proof for distributed deployments

### Negative

- ⚠️ UUIDs are longer than nanoid (36 chars vs ~21 chars)
- ⚠️ UUIDs are less human-readable than nanoid
- ⚠️ Slightly larger index size compared to sequential IDs

### Mitigations

- For human-readable references, add a separate `display_id` field with nanoid if needed
- For URL sharing, create short links mapping to UUID primary keys
- For frontend display, show truncated UUIDs or friendly names

---

## Implementation

### Database Schema (`shared/schema.ts`)

```typescript
export const inventoryItems = pgTable("inventory_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // ... other fields
});
```

### Tests Updated

- ✅ E2E tests no longer depend on nanoid for item creation
- ✅ Database seed scripts use PostgreSQL UUID generation
- ✅ CI pipeline validates schema consistency

### Dependencies

- **Keep nanoid**: Required for non-PK use cases (upload tokens, etc.)
- **PostgreSQL 13+**: Required for `gen_random_uuid()` function

---

## References

- [PostgreSQL UUID Functions](https://www.postgresql.org/docs/current/functions-uuid.html)
- [Drizzle ORM Default Values](https://orm.drizzle.team/docs/sql-schema-declaration#default-value)
- [nanoid GitHub](https://github.com/ai/nanoid)
- Related commit: `60d8ef62` (E2E CI fixes with nanoid import resolution)

---

## Review History

- **2025-11-11**: Initial ADR created after E2E CI implementation
- **Next Review**: After 6 months or when considering multi-tenancy

---

**Note:** This ADR supersedes any informal decisions or assumptions made prior to 2025-11-11. All future database tables should follow the PostgreSQL UUID primary key strategy unless explicitly documented in a new ADR.
