import { randomBytes } from "crypto";
import { createWriteStream, promises as fs } from "fs";
import os from "os";
import path from "path";
import { Writable } from "stream";
import { afterEach, describe, expect, it } from "vitest";
import type { BackupInventoryItem } from "../../scripts/backup-utils";
import { verifyBackupArchive } from "../../scripts/restore-verify-archive";
import {
  BackupCompletenessError,
  BackupIntegrityError,
  createBackupArchivePlan,
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
    createdAt: CREATED_AT,
    ...overrides,
  };
}
