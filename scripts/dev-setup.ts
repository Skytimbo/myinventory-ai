/* scripts/dev-setup.ts
 *
 * Local development database and photos, with synthetic data only.
 *
 *   pnpm dev:setup          create .env.development (from the example) if missing,
 *                           create the local database, apply the schema, and seed
 *                           synthetic records + generated images if it is empty
 *   pnpm dev:reset          same, but first remove existing rows and dev photos
 *
 * Reads DATABASE_URL only from .env.development (never from the shell or .env)
 * and refuses anything that is not PostgreSQL on this machine. Never prints
 * connection strings.
 */
import { createHash, randomUUID } from 'crypto';
import { promises as fs, existsSync, copyFileSync, readFileSync } from 'fs';
import path from 'path';
import zlib from 'zlib';
import dotenv from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { assertConnectedToLocalServer, assertLocalDatabaseUrl } from '../server/databaseTarget';
import { connectLocalDatabase, exitWithSafeError } from './_localDb';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_FILE = path.join(ROOT, '.env.development');
const EXAMPLE_FILE = path.join(ROOT, '.env.development.example');
const SCHEMA_FILES = [
  'migrations/railway-init.sql',
  'migrations/0002_analysis_metadata.sql',
  'migrations/0003_identify_valuation.sql',
  'migrations/0004_capture_evidence.sql',
];

async function main() {
  const reset = process.argv.includes('--reset');

  if (!existsSync(ENV_FILE)) {
    copyFileSync(EXAMPLE_FILE, ENV_FILE);
    console.log('Created .env.development from .env.development.example');
  }
  const env = dotenv.parse(readFileSync(ENV_FILE));
  const url = env.DATABASE_URL;
  const target = assertLocalDatabaseUrl(url, 'set up the local development database');
  if (!/^[a-z][a-z0-9_]*$/.test(target.database)) {
    throw new Error(`Database name "${target.database}" must be lowercase letters, digits, and underscores.`);
  }
  const uploadsDir = path.resolve(ROOT, env.LOCAL_STORAGE_DIR || './uploads-dev');
  if (path.relative(ROOT, uploadsDir) === 'uploads') {
    throw new Error('LOCAL_STORAGE_DIR must not be ./uploads; use a separate development folder such as ./uploads-dev.');
  }

  await ensureDatabase(url, target.database);

  const { pool, client, database } = await connectLocalDatabase(url, 'set up the local development database');
  try {
    for (const file of SCHEMA_FILES) {
      await client.query(await fs.readFile(path.join(ROOT, file), 'utf8'));
    }
    console.log(`✓ Schema applied to "${database}"`);

    if (reset) {
      await client.query('TRUNCATE TABLE item_photos, photos, capture_batches, capture_sessions, inventory_items');
      await fs.rm(path.join(uploadsDir, 'items'), { recursive: true, force: true });
      await fs.rm(path.join(uploadsDir, 'photos'), { recursive: true, force: true });
      console.log(`✓ Reset: removed all rows and ${path.relative(ROOT, uploadsDir)}/items, /photos`);
    }

    const { rows } = await client.query('SELECT count(*)::int AS count FROM inventory_items');
    if (rows[0].count > 0) {
      console.log(`"${database}" already has ${rows[0].count} item(s); not seeding. Use \`pnpm dev:reset\` to start over.`);
    } else {
      const seeded = await seed(client, uploadsDir);
      console.log(`✓ Seeded ${seeded} synthetic item(s) with generated images in ${path.relative(ROOT, uploadsDir)}/`);
    }
  } finally {
    client.release();
    await pool.end();
  }

  await registerPhotos(url, env.LOCAL_STORAGE_DIR || './uploads-dev');
  console.log(`\nNext: pnpm dev:local, then open http://localhost:${env.PORT || '5000'}`);
}

/** Record existing item photos as evidence, using the app's own PhotoService */
async function registerPhotos(url: string, storageDir: string): Promise<void> {
  process.env.DATABASE_URL = url;
  process.env.LOCAL_STORAGE_DIR = storageDir;
  const { DatabaseStorage } = await import('../server/storage');
  const { ObjectStorageService } = await import('../server/objectStorage');
  const { PhotoService } = await import('../server/photoService');
  const storage = await DatabaseStorage.create();
  try {
    const result = await new PhotoService(storage, new ObjectStorageService()).registerExistingItemPhotos();
    console.log(
      `✓ Photo evidence: ${result.registered} registered, ${result.linked} linked, ` +
        `${result.alreadyRegistered} already registered, ${result.missing.length} missing`
    );
  } finally {
    await storage.close();
  }
}

/** Create the database if missing, via the local maintenance database */
async function ensureDatabase(url: string, database: string): Promise<void> {
  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = '/postgres';
  const pool = new Pool({ connectionString: maintenanceUrl.toString() });
  try {
    const client = await pool.connect();
    try {
      await assertConnectedToLocalServer(client, 'create the local development database');
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
      if (exists.rowCount === 0) {
        await client.query(`CREATE DATABASE "${database}"`);
        console.log(`✓ Created local database "${database}"`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Synthetic seed data
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

interface SeedItem {
  name: string;
  category: string;
  description: string;
  tags: string[];
  location: string | null;
  colors: Rgb[];
  legacy?: { value: string; confidence: string | null; rationale: string | null };
  metadataModel?: string;
  identified?: boolean;
  valuation?: Record<string, unknown>;
}

const IDENTIFIED_AT = '2026-10-20T12:00:00.000Z';
const EVIDENCE = {
  basis: 'model_judgment',
  note: 'AI judgment from the photos and identification. No marketplace or sales data was retrieved.',
};

function valuation(name: string, category: string, fields: Record<string, unknown>) {
  return {
    status: 'estimated',
    marketability: 'marketable',
    marketabilityReason: 'Synthetic development data.',
    currency: 'USD',
    low: null,
    likely: null,
    high: null,
    confidence: null,
    rationale: 'Synthetic development data; not a real valuation.',
    missingInformation: [],
    evidence: EVIDENCE,
    basedOn: { name, category, identifiedAt: IDENTIFIED_AT },
    model: 'mock',
    evaluatedAt: '2026-10-21T12:00:00.000Z',
    promptVersion: 'valuation-v4',
    staleAt: null,
    staleReason: null,
    scope: null,
    assumptions: [],
    ...fields,
  };
}

const ITEMS: SeedItem[] = [
  {
    name: 'Cordless drill (synthetic)', category: 'Tools', location: 'Garage', tags: ['drill', 'synthetic'],
    description: 'Synthetic development record: item-scope estimate, functionality untested.',
    colors: [[230, 180, 30]], identified: true,
    valuation: valuation('Cordless drill (synthetic)', 'Tools', {
      scope: 'item', assumptions: ['as_is_untested', 'visible_condition_only'],
      low: '20.00', likely: '35.00', high: '50.00', confidence: 'low',
      missingInformation: ['working condition', 'battery health'],
    }),
  },
  {
    name: 'Ceramic mug (synthetic)', category: 'Kitchen', location: 'Kitchen', tags: ['mug', 'synthetic'],
    description: 'Synthetic development record: category baseline.',
    colors: [[70, 140, 90]], identified: true,
    valuation: valuation('Ceramic mug (synthetic)', 'Kitchen', {
      scope: 'category', assumptions: ['unattributed', 'visible_condition_only'],
      low: '1.00', likely: '3.00', high: '6.00', confidence: 'low',
      missingInformation: ["maker's mark"],
    }),
  },
  {
    name: 'River rock (synthetic)', category: 'Natural Objects', location: 'Garden', tags: ['rock', 'synthetic'],
    description: 'Synthetic development record: nonmarketable.',
    colors: [[120, 120, 120]], identified: true,
    valuation: valuation('River rock (synthetic)', 'Natural Objects', {
      status: 'nonmarketable', marketability: 'nonmarketable',
    }),
  },
  {
    name: 'Fur boots (synthetic)', category: 'Clothing', location: 'Closet', tags: ['boots', 'synthetic'],
    description: 'Synthetic development record: insufficient information.',
    colors: [[150, 110, 70]], identified: true,
    valuation: valuation('Fur boots (synthetic)', 'Clothing', {
      status: 'insufficient_information', marketability: 'uncertain',
      missingInformation: ['material', 'maker or origin'],
    }),
  },
  {
    name: 'Desk lamp (synthetic)', category: 'Household', location: 'Office', tags: ['lamp', 'synthetic'],
    description: 'Synthetic development record: legacy estimate from the old combined analysis.',
    colors: [[200, 200, 240]], metadataModel: 'openai',
    legacy: { value: '25.00', confidence: 'medium', rationale: 'Synthetic legacy value' },
  },
  {
    name: 'Pebble (synthetic)', category: 'Natural Objects', location: null, tags: ['synthetic'],
    description: 'Synthetic development record: legacy 0.00 placeholder.',
    colors: [[90, 90, 90]], metadataModel: 'openai',
    legacy: { value: '0.00', confidence: 'low', rationale: null },
  },
  {
    name: 'Untitled Item', category: 'Uncategorized', location: 'Shed', tags: [],
    description: '',
    colors: [[60, 60, 160]], metadataModel: 'none',
  },
  {
    name: 'Bookshelf (synthetic)', category: 'Furniture', location: 'Living room', tags: ['shelf', 'synthetic'],
    description: 'Synthetic development record: stale estimate (re-identified after valuation).',
    colors: [[160, 100, 60]], identified: true,
    valuation: valuation('Bookcase (synthetic)', 'Furniture', {
      scope: 'item', assumptions: ['visible_condition_only'],
      low: '30.00', likely: '45.00', high: '60.00', confidence: 'medium',
      staleAt: '2026-10-22T12:00:00.000Z', staleReason: 'reidentified',
    }),
  },
  {
    name: 'Camera kit (synthetic)', category: 'Electronics', location: 'Office', tags: ['camera', 'synthetic'],
    description: 'Synthetic development record: three photos; estimate made before valuation-v4 (basis not recorded).',
    colors: [[30, 30, 30], [80, 80, 160], [160, 80, 80]], identified: true,
    valuation: (() => {
      const { scope: _scope, assumptions: _assumptions, ...v3 } = valuation('Camera kit (synthetic)', 'Electronics', {
        low: '40.00', likely: '60.00', high: '90.00', confidence: 'low', promptVersion: 'valuation-v3',
      });
      return v3;
    })(),
  },
];

async function seed(client: PoolClient, uploadsDir: string): Promise<number> {
  await client.query('BEGIN');
  try {
    for (const item of ITEMS) {
      const id = randomUUID();
      const imageUrls: string[] = [];
      let primaryHash = '';
      for (let index = 0; index < item.colors.length; index++) {
        const single = item.colors.length === 1;
        const relative = single ? `items/${id}.png` : `items/${id}/${index}.png`;
        const png = syntheticPng(item.colors[index], index);
        await fs.mkdir(path.dirname(path.join(uploadsDir, relative)), { recursive: true });
        await fs.writeFile(path.join(uploadsDir, relative), png);
        imageUrls.push(`/objects/${relative}`);
        if (index === 0) primaryHash = createHash('sha256').update(png).digest('hex');
      }

      const metadata = { model: item.metadataModel ?? 'mock', version: 'v3', timestamp: IDENTIFIED_AT, imageHash: primaryHash };
      const identification = item.identified
        ? { confidence: 0.9, uncertainty: 'low', notes: null, alternatives: [], model: 'mock', identifiedAt: IDENTIFIED_AT, promptVersion: 'identify-v3' }
        : null;

      await client.query(
        `INSERT INTO inventory_items
          (id, name, description, category, tags, image_url, image_urls, barcode_data,
           estimated_value, value_confidence, value_rationale, location, analysis_metadata,
           identification, valuation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb)`,
        [
          id, item.name, item.description, item.category, item.tags, imageUrls[0],
          imageUrls.length > 1 ? imageUrls : null,
          `INV-DEV-${randomUUID().slice(0, 8).toUpperCase()}`,
          item.legacy?.value ?? null, item.legacy?.confidence ?? null, item.legacy?.rationale ?? null,
          item.location, JSON.stringify(metadata),
          identification ? JSON.stringify(identification) : null,
          item.valuation ? JSON.stringify(item.valuation) : null,
        ]
      );
    }
    await client.query('COMMIT');
    return ITEMS.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** A small valid PNG: a solid colour with a diagonal band (index varies it) */
function syntheticPng([r, g, b]: Rgb, index: number): Buffer {
  const width = 320;
  const height = 240;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const band = Math.abs(x - y - index * 40) < 18;
      const offset = row + 1 + x * 3;
      raw[offset] = band ? 255 - r : r;
      raw[offset + 1] = band ? 255 - g : g;
      raw[offset + 2] = band ? 255 - b : b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

main().catch(exitWithSafeError);
