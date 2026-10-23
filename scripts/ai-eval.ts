import path from "path";
import OpenAI from "openai";
import {
  loadOpenAIConfig,
  parseArgs,
  redactSecrets,
  resolveOutDir,
  runEvaluation,
  writeResults,
} from "./ai-eval-lib";

/**
 * Manual Identify / Estimate Value evaluation against real photos.
 *
 * Usage:
 *   pnpm ai:eval <photos-dir> [--out [dir]] [--identify-only] [--mock]
 *
 * <photos-dir> contains one subdirectory per item, each holding 1-4 photos
 * (.jpg/.jpeg/.png/.webp) of that item. An optional expected-status.txt holds
 * the expected valuation status (estimated, nonmarketable, or
 * insufficient_information).
 *
 * OpenAI settings come from the shell environment only (OPENAI_API_KEY,
 * OPENAI_PROJECT_ID, OPENAI_BASE_URL); .env is not loaded. With --out, a
 * redacted results.json (raw responses, parsed results, errors) is written
 * under ai-eval-results/ (gitignored) by default.
 *
 * Exits 1 if any item failed or mismatched its expected status.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = args.mock ? null : loadOpenAIConfig(process.env);
  const secrets = config ? [config.apiKey] : [];
  const outDir = args.outDir
    ? resolveOutDir(args.outDir, {
        cwd: process.cwd(),
        storageDir: process.env.LOCAL_STORAGE_DIR || undefined,
      })
    : null;

  const clients = config
    ? {
        cheap: new OpenAI({ apiKey: config.apiKey, project: config.projectId, baseURL: config.baseURL }),
        premium: new OpenAI({ apiKey: config.apiKey, project: config.projectId, baseURL: config.baseURL }),
      }
    : undefined;

  const run = await runEvaluation({
    photosDir: path.resolve(process.cwd(), args.photosDir),
    identifyOnly: args.identifyOnly,
    clients,
    config,
    log: (line) => console.log(redactSecrets(line, secrets)),
  });

  const { items, failures, mismatches, skipped } = run.summary;
  console.log(
    `\nDone (${run.mode}). ${items} item(s): ${failures} failure(s), ${mismatches} mismatch(es), ${skipped} skipped.`
  );
  if (run.abortedReason) {
    console.log(`Aborted: ${run.abortedReason}.`);
  }

  if (outDir) {
    const file = await writeResults(outDir, run, secrets);
    console.log(`Results written to ${file}`);
  }

  if (failures > 0 || mismatches > 0 || run.abortedReason) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactSecrets(message, [process.env.OPENAI_API_KEY ?? ""]));
  process.exit(1);
});
