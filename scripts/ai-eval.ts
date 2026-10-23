import "dotenv/config";

import { promises as fs } from "fs";
import path from "path";
import {
  confidenceToUncertainty,
  MockAnalyzer,
  OpenAIAnalyzer,
  type IAnalyzer,
} from "../server/analyzer";

/**
 * Manual Identify / Estimate Value evaluation against real photos.
 *
 * Usage:
 *   pnpm ai:eval <photos-dir>          # real OpenAI calls (costs a few cents per item)
 *   pnpm ai:eval <photos-dir> --mock   # plumbing check, no API calls
 *
 * <photos-dir> contains one subdirectory per item, each holding 1-4 photos
 * (.jpg/.jpeg/.png/.webp) of that item. An optional expected-status.txt
 * holds the expected valuation status (estimated, nonmarketable, or
 * insufficient_information) and is compared against the result.
 *
 * Reads no database and writes nothing; it only calls the analyzer.
 */

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function main() {
  const [dirArg, ...flags] = process.argv.slice(2);
  if (!dirArg) {
    throw new Error("Usage: pnpm ai:eval <photos-dir> [--mock]");
  }

  const analyzer = await createAnalyzer(flags.includes("--mock"));
  const root = path.resolve(process.cwd(), dirArg);
  const entries = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (entries.length === 0) {
    throw new Error(`No item subdirectories found in ${root}`);
  }

  let mismatches = 0;
  for (const name of entries) {
    const itemDir = path.join(root, name);
    const files = (await fs.readdir(itemDir))
      .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
      .sort();
    if (files.length === 0) {
      console.log(`\n## ${name}: skipped (no photos)`);
      continue;
    }

    const images = await Promise.all(files.map((file) => fs.readFile(path.join(itemDir, file))));
    const expected = await readExpectedStatus(itemDir);

    console.log(`\n## ${name} (${files.length} photo(s))`);
    try {
      const identification = await analyzer.identify(images);
      console.log(
        `Identify: ${identification.name} [${identification.category}] ` +
          `uncertainty=${confidenceToUncertainty(identification.confidence)} model=${identification.model}`
      );
      if (identification.notes) console.log(`  notes: ${identification.notes}`);
      if (identification.alternatives.length) {
        console.log(`  alternatives: ${identification.alternatives.join("; ")}`);
      }

      const valuation = await analyzer.estimateValue({
        images,
        name: identification.name,
        description: identification.description,
        category: identification.category,
        identificationNotes: identification.notes,
      });
      const range =
        valuation.status === "estimated"
          ? ` $${valuation.low}-$${valuation.high} (likely $${valuation.likely}, ${valuation.confidence})`
          : "";
      console.log(`Estimate: ${valuation.status}${range} marketability=${valuation.marketability}`);
      console.log(`  reason: ${valuation.marketabilityReason}`);
      console.log(`  rationale: ${valuation.rationale}`);
      if (valuation.missingInformation.length) {
        console.log(`  would help: ${valuation.missingInformation.join("; ")}`);
      }

      if (expected) {
        const ok = expected === valuation.status;
        if (!ok) mismatches += 1;
        console.log(`  expected ${expected}: ${ok ? "MATCH" : "MISMATCH"}`);
      }
    } catch (error) {
      mismatches += 1;
      console.log(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\nDone. ${mismatches} mismatch(es) or failure(s) across ${entries.length} item(s).`);
}

async function createAnalyzer(mock: boolean): Promise<IAnalyzer> {
  if (mock) {
    return new MockAnalyzer();
  }
  const { openaiCheap, openaiPremium } = await import("../server/openai");
  return new OpenAIAnalyzer(openaiCheap, openaiPremium);
}

async function readExpectedStatus(itemDir: string): Promise<string | null> {
  try {
    return (await fs.readFile(path.join(itemDir, "expected-status.txt"), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
