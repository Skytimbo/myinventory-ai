import { randomBytes } from "crypto";
import { createWriteStream, promises as fs } from "fs";
import os from "os";
import path from "path";
import { Writable } from "stream";
import { getTableColumns } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { inventoryItems, type InventoryItem, type Valuation } from "@shared/schema";
import {
  BACKUP_SCHEMA_VERSION,
  inventoryItemsToCsv,
  type BackupInventoryItem,
} from "../../scripts/backup-utils";
import { verifyBackupArchive } from "../../scripts/restore-verify-archive";
import {
  BackupCompletenessError,
  BackupIntegrityError,
  createBackupArchivePlan,
  toBackupInventoryItem,
  writeBackupArchive,
  type BackupImageFile,
} from "../backupArchive";

const CREATED_AT = "2026-06-13T00:00:00.000Z";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("backup archive integrity", () => {
  it("round-trips odd sizes, empty files, and long paths through restore verification", async () => {
    const dir = await makeTempDir();
    // > 100 bytes forces the ustar prefix field to be used
    const longObjectPath = `/objects/items/${"a".repeat(60)}/${"b".repeat(60)}/0.jpg`;
    const images: Record<string, Buffer> = {
      "/objects/items/block.jpg": randomBytes(512),
      "/objects/items/odd.jpg": randomBytes(513),
      "/objects/items/empty.jpg": Buffer.alloc(0),
      [longObjectPath]: randomBytes(70_000),
    };
    const items = Object.keys(images).map((objectPath, index) =>
      createItem(index, { imageUrl: objectPath })
    );
    const imageFiles = await writeImageFiles(dir, images, items);

    const archivePath = await writeArchive(dir, items, imageFiles);
    const restoreUploadsDir = path.join(dir, "restored");
    const { manifest } = await verifyBackupArchive({ archivePath, restoreUploadsDir });

    expect(manifest.downloadedImageCount).toBe(4);
    for (const [objectPath, bytes] of Object.entries(images)) {
      const restored = await fs.readFile(
        path.join(restoreUploadsDir, ...objectPath.replace("/objects/", "").split("/"))
      );
      expect(restored.equals(bytes)).toBe(true);
    }
  });

  it("produces a valid archive for an empty inventory", async () => {
    const dir = await makeTempDir();
    const archivePath = await writeArchive(dir, [], []);

    const { manifest, items } = await verifyBackupArchive({
      archivePath,
      restoreUploadsDir: path.join(dir, "restored"),
    });

    expect(manifest.itemCount).toBe(0);
    expect(items).toEqual([]);
  });

  it("refuses to plan a backup when a referenced image is missing", async () => {
    const items = [createItem(0, { imageUrl: "/objects/items/missing.jpg" })];

    await expect(
      createBackupArchivePlan({ items, imageFiles: [], sourceAppUrl: "http://test.local" })
    ).rejects.toBeInstanceOf(BackupCompletenessError);
  });

  it.each([
    ["same size, different bytes", (original: Buffer) => Buffer.alloc(original.length, 1)],
    ["grown", (original: Buffer) => Buffer.concat([original, Buffer.from("extra")])],
    ["shrunk", (original: Buffer) => original.subarray(0, original.length - 1)],
  ])("fails when an image is %s after the manifest was planned", async (_label, mutate) => {
    const dir = await makeTempDir();
    const original = randomBytes(2048);
    const items = [createItem(0, { imageUrl: "/objects/items/changing.jpg" })];
    const imageFiles = await writeImageFiles(
      dir,
      { "/objects/items/changing.jpg": original },
      items
    );
    const plan = await createBackupArchivePlan({
      items,
      imageFiles,
      sourceAppUrl: "http://test.local",
      createdAt: CREATED_AT,
    });

    await fs.writeFile(imageFiles[0].filePath, mutate(original));

    await expect(
      writeBackupArchive(plan, createWriteStream(path.join(dir, "out.tar.gz")))
    ).rejects.toBeInstanceOf(BackupIntegrityError);
  });

  it("rejects instead of hanging when the output closes mid-stream", async () => {
    const dir = await makeTempDir();
    const items = [createItem(0, { imageUrl: "/objects/items/large.jpg" })];
    const imageFiles = await writeImageFiles(
      dir,
      // Random bytes do not compress, so gzip output exceeds stream buffers
      { "/objects/items/large.jpg": randomBytes(4 * 1024 * 1024) },
      items
    );
    const plan = await createBackupArchivePlan({
      items,
      imageFiles,
      sourceAppUrl: "http://test.local",
      createdAt: CREATED_AT,
    });

    let received = 0;
    const output = new Writable({
      highWaterMark: 1024,
      write(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > 64 * 1024) {
          // Simulate a client disconnect: close without signalling an error
          this.destroy();
          return;
        }
        callback();
      },
    });

    await expect(writeBackupArchive(plan, output)).rejects.toThrow();
  }, 10_000);
});

describe("backup schema compatibility", () => {
  const columns = Object.values(getTableColumns(inventoryItems));

  it("includes every inventory_items column in endpoint backups", () => {
    const fields = Object.keys(getTableColumns(inventoryItems)).sort();
    const backupItem = toBackupInventoryItem(createItem(0, {}) as InventoryItem);

    expect(Object.keys(backupItem).sort()).toEqual(fields);
  });

  it.each(["scripts/backup.ts", "scripts/restore-verify.ts"])(
    "references every inventory_items column in %s",
    async (relativePath) => {
      const source = await fs.readFile(path.resolve(__dirname, "../..", relativePath), "utf8");
      const missing = columns
        .map((column) => column.name)
        .filter((name) => !new RegExp(`\\b${name}\\b`).test(source));

      expect(missing).toEqual([]);
    }
  );

  it("preserves identification and valuation through an archive", async () => {
    const dir = await makeTempDir();
    const valuation = createValuation();
    const items = [
      createItem(0, {
        imageUrl: "/objects/items/drill.jpg",
        identification: {
          confidence: 0.92,
          uncertainty: "low",
          notes: null,
          alternatives: [],
          model: "gpt-4o-mini",
          identifiedAt: CREATED_AT,
          promptVersion: "identify-v1",
        },
        valuation,
        estimatedValue: "80.00",
        valueConfidence: "medium",
      }),
    ];
    const imageFiles = await writeImageFiles(
      dir,
      { "/objects/items/drill.jpg": randomBytes(100) },
      items
    );
    const archivePath = await writeArchive(dir, items, imageFiles);

    const { manifest, items: restored } = await verifyBackupArchive({
      archivePath,
      restoreUploadsDir: path.join(dir, "restored"),
    });

    expect(manifest.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(restored[0].valuation).toEqual(valuation);
    expect(restored[0].identification?.promptVersion).toBe("identify-v1");
    expect(restored[0].estimatedValue).toBe("80.00");
  });

  it("preserves v4 scope and assumptions alongside an older valuation through an archive", async () => {
    const dir = await makeTempDir();
    const v4 = createValuation({ scope: "category", confidence: "low", assumptions: ["unattributed", "visible_condition_only"] });
    const v3 = createValuation(); // no scope: basis not recorded
    const items = [
      createItem(0, { imageUrl: "/objects/items/v4.jpg", valuation: v4 }),
      createItem(1, { imageUrl: "/objects/items/v3.jpg", valuation: v3 }),
    ];
    const imageFiles = await writeImageFiles(
      dir,
      { "/objects/items/v4.jpg": randomBytes(40), "/objects/items/v3.jpg": randomBytes(41) },
      items
    );
    const archivePath = await writeArchive(dir, items, imageFiles);

    const { items: restored } = await verifyBackupArchive({
      archivePath,
      restoreUploadsDir: path.join(dir, "restored"),
    });
    const byId = new Map(restored.map((item) => [item.id, item]));

    expect(byId.get(items[0].id)?.valuation).toEqual(v4);
    expect(byId.get(items[1].id)?.valuation).toEqual(v3);
    expect(byId.get(items[1].id)?.valuation).not.toHaveProperty("scope");

    const csv = inventoryItemsToCsv(items).split("\n").map((row) => row.split(",").map((cell) => cell.replace(/^"|"$/g, "")));
    const column = (name: string) => csv[0].indexOf(name);
    expect(csv[1][column("Valuation Scope")]).toBe("category");
    expect(csv[1][column("Assumptions")]).toBe("unattributed; visible_condition_only");
    expect(csv[2][column("Valuation Scope")]).toBe("unrecorded");
  });

  it("still accepts 0002 archives that predate identification and valuation", async () => {
    const dir = await makeTempDir();
    const items = [createItem(0, { imageUrl: "/objects/items/old.jpg", estimatedValue: "45.00" })];
    const imageFiles = await writeImageFiles(
      dir,
      { "/objects/items/old.jpg": randomBytes(64) },
      items
    );
    const plan = await createBackupArchivePlan({
      items,
      imageFiles,
      sourceAppUrl: "http://test.local",
      createdAt: CREATED_AT,
    });
    plan.manifest.schemaVersion = "0002_analysis_metadata";
    plan.inventory = {
      ...plan.inventory,
      schemaVersion: "0002_analysis_metadata",
      items: items.map(({ identification: _i, valuation: _v, ...legacy }) => legacy) as
        BackupInventoryItem[],
    };
    const archivePath = path.join(dir, "legacy.tar.gz");
    await writeBackupArchive(plan, createWriteStream(archivePath));

    const { items: restored } = await verifyBackupArchive({
      archivePath,
      restoreUploadsDir: path.join(dir, "restored"),
    });

    expect(restored[0].identification).toBeNull();
    expect(restored[0].valuation).toBeNull();
    expect(restored[0].estimatedValue).toBe("45.00");
  });

  it("rejects archives with an unknown schema version", async () => {
    const dir = await makeTempDir();
    const plan = await createBackupArchivePlan({
      items: [],
      imageFiles: [],
      sourceAppUrl: "http://test.local",
      createdAt: CREATED_AT,
    });
    plan.manifest.schemaVersion = "9999_future";
    const archivePath = path.join(dir, "future.tar.gz");
    await writeBackupArchive(plan, createWriteStream(archivePath));

    await expect(
      verifyBackupArchive({ archivePath, restoreUploadsDir: path.join(dir, "restored") })
    ).rejects.toThrow("Unsupported archive schema version");
  });

  it("writes value status to the CSV instead of blank or zero values", () => {
    const csv = inventoryItemsToCsv([
      createItem(0, {}),
      createItem(1, { estimatedValue: "125.00", valueConfidence: "medium" }),
      createItem(2, {
        valuation: createValuation({
          status: "nonmarketable",
          low: null,
          likely: null,
          high: null,
          confidence: null,
        }),
      }),
      createItem(3, { valuation: createValuation({ staleAt: CREATED_AT }) }),
    ]);
    // Every cell is quoted and these synthetic values contain no commas or quotes
    const rows = csv
      .split("\n")
      .map((row) => row.split(",").map((cell) => cell.replace(/^"|"$/g, "")));
    const header = rows[0];
    const column = (name: string) => header.indexOf(name);

    expect(rows[1][column("Value Status")]).toBe("not_evaluated");
    expect(rows[1][column("Estimate Likely")]).toBe("");
    expect(rows[2][column("Value Status")]).toBe("not_evaluated");
    expect(rows[2][column("Legacy Estimate")]).toBe("125.00");
    expect(rows[3][column("Value Status")]).toBe("nonmarketable");
    expect(rows[3][column("Estimate Likely")]).toBe("");
    expect(rows[4][column("Estimate Stale")]).toBe("yes");
    expect(rows[4][column("Evidence Basis")]).toBe("model_judgment");
  });
});

function createValuation(overrides: Partial<Valuation> = {}): Valuation {
  return {
    status: "estimated",
    marketability: "marketable",
    marketabilityReason: "Branded tools resell",
    currency: "USD",
    low: "40.00",
    likely: "55.00",
    high: "70.00",
    confidence: "medium",
    rationale: "Synthetic valuation",
    missingInformation: [],
    evidence: { basis: "model_judgment", note: "No marketplace data was retrieved." },
    basedOn: { name: "Synthetic Item", category: "Test", identifiedAt: CREATED_AT },
    model: "gpt-4o",
    evaluatedAt: CREATED_AT,
    promptVersion: "valuation-v1",
    staleAt: null,
    staleReason: null,
    ...overrides,
  };
}

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "backup-archive-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeImageFiles(
  dir: string,
  images: Record<string, Buffer>,
  items: BackupInventoryItem[]
): Promise<BackupImageFile[]> {
  const imageFiles: BackupImageFile[] = [];
  let index = 0;
  for (const [objectPath, bytes] of Object.entries(images)) {
    const filePath = path.join(dir, "source", `${index}.bin`);
    index += 1;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    imageFiles.push({
      objectPath,
      filePath,
      itemIds: items.filter((item) => item.imageUrl === objectPath).map((item) => item.id),
    });
  }
  return imageFiles;
}

async function writeArchive(
  dir: string,
  items: BackupInventoryItem[],
  imageFiles: BackupImageFile[]
): Promise<string> {
  const plan = await createBackupArchivePlan({
    items,
    imageFiles,
    sourceAppUrl: "http://test.local",
    createdAt: CREATED_AT,
  });
  const archivePath = path.join(dir, plan.archiveName);
  await writeBackupArchive(plan, createWriteStream(archivePath));
  return archivePath;
}

function createItem(
  index: number,
  overrides: Partial<BackupInventoryItem>
): BackupInventoryItem {
  const suffix = String(index).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    name: `Synthetic Item ${index}`,
    description: "Synthetic test item",
    category: "Test",
    tags: ["synthetic"],
    imageUrl: "/objects/items/default.jpg",
    imageUrls: null,
    barcodeData: `INV-${suffix}`,
    estimatedValue: null,
    valueConfidence: null,
    valueRationale: null,
    location: null,
    analysisMetadata: null,
    identification: null,
    valuation: null,
    notes: null,
    userAssertions: null,
    createdAt: CREATED_AT,
    ...overrides,
  };
}
