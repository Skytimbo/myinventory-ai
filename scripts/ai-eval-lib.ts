import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import {
  confidenceToUncertainty,
  IDENTIFY_MODEL_CHEAP,
  IDENTIFY_MODEL_PREMIUM,
  IDENTIFY_PROMPT_VERSION,
  MockAnalyzer,
  OpenAIAnalyzer,
  VALUATION_MODEL,
  VALUATION_PROMPT_VERSION,
  type IAnalyzer,
  type IdentificationResult,
  type ValuationResult,
} from "../server/analyzer";

/**
 * Real-photo Identify / Estimate Value evaluation (see scripts/ai-eval.ts).
 *
 * Safety boundaries:
 * - Reads OpenAI settings from the process environment only; never loads .env.
 * - Imports only the analyzer and the OpenAI SDK: no database, storage, or
 *   migration code is reachable (enforced by server/tests/aiEval.spec.ts).
 * - Writes only to --out, which must be under the gitignored ai-eval-results/
 *   or outside the repository, and never inside application storage.
 * - Redacts credentials from everything it prints or writes.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OUT_DIR = "ai-eval-results";
export const EVAL_FORMAT_VERSION = 1;

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VALUATION_STATUSES = new Set(["estimated", "nonmarketable", "insufficient_information"]);

// ============================================================
// Arguments and configuration
// ============================================================

export interface EvalArgs {
  photosDir: string;
  outDir: string | null;
  mock: boolean;
  identifyOnly: boolean;
}

export const USAGE =
  "Usage: pnpm ai:eval <photos-dir> [--out [dir]] [--identify-only] [--mock]";

export function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = { photosDir: "", outDir: null, mock: false, identifyOnly: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mock") {
      args.mock = true;
    } else if (arg === "--identify-only") {
      args.identifyOnly = true;
    } else if (arg === "--out") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        args.outDir = next;
        index += 1;
      } else {
        args.outDir = DEFAULT_OUT_DIR;
      }
    } else if (arg.startsWith("--out=")) {
      args.outDir = arg.slice("--out=".length) || DEFAULT_OUT_DIR;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}. ${USAGE}`);
    } else if (!args.photosDir) {
      args.photosDir = arg;
    } else {
      throw new Error(`Unexpected argument ${arg}. ${USAGE}`);
    }
  }

  if (!args.photosDir) {
    throw new Error(USAGE);
  }
  return args;
}

export interface OpenAIEvalConfig {
  apiKey: string;
  projectId: string | undefined;
  baseURL: string | undefined;
}

/**
 * Read only the OpenAI settings this tool needs. Error messages never include
 * the key itself.
 */
export function loadOpenAIConfig(env: NodeJS.ProcessEnv): OpenAIEvalConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set in this shell. See docs/AI-IDENTIFY-VALUATION.md (Manual evaluation) for supplying a temporary test key."
    );
  }
  if (apiKey.startsWith("__REPLACE")) {
    throw new Error("OPENAI_API_KEY is still a placeholder value.");
  }

  const projectId = env.OPENAI_PROJECT_ID?.trim() || undefined;
  if (apiKey.startsWith("sk-proj-") && !projectId) {
    throw new Error("OPENAI_PROJECT_ID is required with project-scoped keys (sk-proj-...).");
  }

  return { apiKey, projectId, baseURL: env.OPENAI_BASE_URL?.trim() || undefined };
}

/** Describe the configuration without anything credential-bearing */
export function describeConfig(config: OpenAIEvalConfig | null): Record<string, unknown> {
  if (!config) {
    return { provider: "mock" };
  }
  let baseUrlHost: string | null = null;
  if (config.baseURL) {
    try {
      baseUrlHost = new URL(config.baseURL).host;
    } catch {
      baseUrlHost = "(invalid URL)";
    }
  }
  return {
    provider: "openai",
    apiKeyType: config.apiKey.startsWith("sk-proj-") ? "project" : "standard",
    projectIdSet: Boolean(config.projectId),
    baseUrlHost: baseUrlHost ?? "api.openai.com (default)",
  };
}

/**
 * Output must not be committable and must not touch app storage: inside the
 * repository it has to be under ai-eval-results/ (gitignored), and it may
 * never be inside the local uploads directory.
 */
export function resolveOutDir(
  outDir: string,
  options: { cwd: string; repoRoot?: string; storageDir?: string }
): string {
  const repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
  const resolved = path.resolve(options.cwd, outDir);
  const storageDir = path.resolve(options.storageDir ?? path.join(repoRoot, "uploads"));
  const allowedInRepo = path.join(repoRoot, DEFAULT_OUT_DIR);

  if (isWithin(resolved, storageDir)) {
    throw new Error("--out must not be inside application storage.");
  }
  if (isWithin(resolved, repoRoot) && !isWithin(resolved, allowedInRepo)) {
    throw new Error(
      `--out inside the repository must be under ${DEFAULT_OUT_DIR}/ (gitignored), or point outside the repository.`
    );
  }
  return resolved;
}

function isWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// ============================================================
// Redaction
// ============================================================

const SECRET_PATTERNS = [
  /sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_*-]{6,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

/** Remove API keys (including OpenAI's masked echoes) from text */
export function redactSecrets(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) {
      result = result.split(secret).join("[REDACTED]");
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/** Deep-redact every string in a JSON-serializable value */
export function redactDeep<T>(value: T, secrets: string[] = []): T {
  return JSON.parse(redactSecrets(JSON.stringify(value), secrets)) as T;
}

// ============================================================
// Recording OpenAI traffic
// ============================================================

type EvalAction = "identify" | "estimate";

export interface RecordedCall {
  action: EvalAction;
  client: "cheap" | "premium";
  startedAt: string;
  finishedAt: string;
  request: {
    model: unknown;
    temperature: unknown;
    seed: unknown;
    content: unknown[];
  };
  response?: unknown;
  error?: SerializedError;
}

export interface SerializedError {
  name: string;
  message: string;
  status?: number;
  code?: string;
}

type ChatClient = Pick<OpenAI, "chat">;

/**
 * Wrap a client so every chat completion is recorded under the current action.
 * Image data is replaced by its MIME type, size, and SHA-256.
 */
export function createRecordingClient(
  client: ChatClient,
  label: RecordedCall["client"],
  recorder: { action: EvalAction; calls: RecordedCall[] }
): ChatClient {
  const create = client.chat.completions.create.bind(client.chat.completions);
  const recordingCreate = async (params: Parameters<typeof create>[0], ...rest: unknown[]) => {
    const startedAt = new Date().toISOString();
    const request = summarizeRequest(params as unknown as Record<string, unknown>);
    try {
      const response = await (create as (...args: unknown[]) => Promise<unknown>)(params, ...rest);
      recorder.calls.push({
        action: recorder.action,
        client: label,
        startedAt,
        finishedAt: new Date().toISOString(),
        request,
        response,
      });
      return response;
    } catch (error) {
      recorder.calls.push({
        action: recorder.action,
        client: label,
        startedAt,
        finishedAt: new Date().toISOString(),
        request,
        error: serializeError(error),
      });
      throw error;
    }
  };

  return {
    chat: {
      ...client.chat,
      completions: { ...client.chat.completions, create: recordingCreate },
    },
  } as unknown as ChatClient;
}

function summarizeRequest(params: Record<string, unknown>): RecordedCall["request"] {
  const messages = Array.isArray(params.messages) ? params.messages : [];
  const content = Array.isArray(messages[0]?.content) ? messages[0].content : [];
  return {
    model: params.model,
    temperature: params.temperature,
    seed: params.seed,
    content: content.map((part: { type?: string; image_url?: { url?: string } }) => {
      if (part?.type !== "image_url" || typeof part.image_url?.url !== "string") {
        return part;
      }
      const [meta, data = ""] = part.image_url.url.split(",");
      const bytes = Buffer.from(data, "base64");
      return {
        type: "image_url",
        mime: meta.replace(/^data:/, "").replace(/;base64$/, ""),
        bytes: bytes.length,
        sha256: sha256(bytes),
      };
    }),
  };
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const withStatus = error as Error & { status?: unknown; code?: unknown };
    return {
      name: error.name,
      message: error.message,
      ...(typeof withStatus.status === "number" ? { status: withStatus.status } : {}),
      ...(typeof withStatus.code === "string" ? { code: withStatus.code } : {}),
    };
  }
  return { name: "Error", message: String(error) };
}

function isAuthError(error: SerializedError | undefined): boolean {
  return error?.status === 401 || error?.status === 403;
}

// ============================================================
// Evaluation
// ============================================================

export interface ActionResult<T> {
  startedAt: string;
  finishedAt: string;
  promptVersion: string;
  model: string | null;
  parsed: T | null;
  error: SerializedError | null;
}

export interface ItemResult {
  itemId: string;
  photos: Array<{ file: string; bytes: number; sha256: string }>;
  expectedStatus: string | null;
  identify: ActionResult<Omit<IdentificationResult, "raw"> & { uncertainty: string }> | null;
  estimate: ActionResult<Omit<ValuationResult, "raw">> | null;
  skipped: string | null;
  match: boolean | null;
  calls: RecordedCall[];
}

export interface EvalRun {
  formatVersion: typeof EVAL_FORMAT_VERSION;
  startedAt: string;
  finishedAt: string;
  photosDir: string;
  mode: "openai" | "mock";
  identifyOnly: boolean;
  config: Record<string, unknown>;
  models: { identifyCheap: string; identifyPremium: string; valuation: string };
  promptVersions: { identify: string; valuation: string };
  abortedReason: string | null;
  items: ItemResult[];
  summary: { items: number; failures: number; mismatches: number; skipped: number };
}

export interface RunEvaluationOptions {
  photosDir: string;
  identifyOnly?: boolean;
  /** Real OpenAI clients (or test doubles). Omit to use MockAnalyzer. */
  clients?: { cheap: ChatClient; premium: ChatClient };
  config?: OpenAIEvalConfig | null;
  log?: (line: string) => void;
}

export async function runEvaluation(options: RunEvaluationOptions): Promise<EvalRun> {
  const log = options.log ?? (() => undefined);
  const recorder: { action: EvalAction; calls: RecordedCall[] } = { action: "identify", calls: [] };
  const analyzer: IAnalyzer = options.clients
    ? new OpenAIAnalyzer(
        createRecordingClient(options.clients.cheap, "cheap", recorder) as OpenAI,
        createRecordingClient(options.clients.premium, "premium", recorder) as OpenAI
      )
    : new MockAnalyzer();

  const run: EvalRun = {
    formatVersion: EVAL_FORMAT_VERSION,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    photosDir: options.photosDir,
    mode: options.clients ? "openai" : "mock",
    identifyOnly: Boolean(options.identifyOnly),
    config: describeConfig(options.config ?? null),
    models: {
      identifyCheap: IDENTIFY_MODEL_CHEAP,
      identifyPremium: IDENTIFY_MODEL_PREMIUM,
      valuation: VALUATION_MODEL,
    },
    promptVersions: { identify: IDENTIFY_PROMPT_VERSION, valuation: VALUATION_PROMPT_VERSION },
    abortedReason: null,
    items: [],
    summary: { items: 0, failures: 0, mismatches: 0, skipped: 0 },
  };

  for (const itemId of await listItemDirectories(options.photosDir)) {
    const itemDir = path.join(options.photosDir, itemId);
    const item: ItemResult = {
      itemId,
      photos: [],
      expectedStatus: await readExpectedStatus(itemDir),
      identify: null,
      estimate: null,
      skipped: null,
      match: null,
      calls: [],
    };
    run.items.push(item);

    if (run.abortedReason) {
      item.skipped = run.abortedReason;
      continue;
    }

    const files = (await fs.readdir(itemDir))
      .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
      .sort();
    if (files.length === 0) {
      item.skipped = "no photos";
      log(`\n## ${itemId}: skipped (no photos)`);
      continue;
    }
    const images = await Promise.all(files.map((file) => fs.readFile(path.join(itemDir, file))));
    item.photos = files.map((file, index) => ({
      file,
      bytes: images[index].length,
      sha256: sha256(images[index]),
    }));
    log(`\n## ${itemId} (${files.length} photo(s))`);

    // Identify (independent action)
    recorder.action = "identify";
    const callStart = recorder.calls.length;
    item.identify = await runAction(IDENTIFY_PROMPT_VERSION, async () => {
      const result = await analyzer.identify(images);
      const { raw: _raw, ...parsed } = result;
      return { ...parsed, uncertainty: confidenceToUncertainty(result.confidence) };
    });
    logIdentify(log, item);

    // Estimate Value (separate action, only after a successful identification)
    if (item.identify.parsed && !options.identifyOnly) {
      recorder.action = "estimate";
      const identification = item.identify.parsed;
      item.estimate = await runAction(VALUATION_PROMPT_VERSION, async () => {
        const { raw: _raw, ...parsed } = await analyzer.estimateValue({
          images,
          name: identification.name,
          description: identification.description,
          category: identification.category,
          identificationNotes: identification.notes,
        });
        return parsed;
      });
      logEstimate(log, item);
    }

    item.calls = recorder.calls.slice(callStart);

    if (item.expectedStatus && item.estimate?.parsed) {
      item.match = item.estimate.parsed.status === item.expectedStatus;
      log(`  expected ${item.expectedStatus}: ${item.match ? "MATCH" : "MISMATCH"}`);
    }

    const failedError = item.identify.error ?? item.estimate?.error ?? undefined;
    const authFailure = item.calls.some((call) => isAuthError(call.error)) || isAuthError(failedError);
    if (authFailure) {
      run.abortedReason = "OpenAI rejected the credentials; remaining items were not attempted";
      log(`  ${run.abortedReason}.`);
    }
  }

  run.finishedAt = new Date().toISOString();
  run.summary = {
    items: run.items.length,
    failures: run.items.filter((item) => item.identify?.error || item.estimate?.error).length,
    mismatches: run.items.filter((item) => item.match === false).length,
    skipped: run.items.filter((item) => item.skipped).length,
  };
  return run;
}

async function runAction<T>(
  promptVersion: string,
  action: () => Promise<T & { model?: string }>
): Promise<ActionResult<T>> {
  const startedAt = new Date().toISOString();
  try {
    const parsed = await action();
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      promptVersion,
      model: parsed.model ?? null,
      parsed,
      error: null,
    };
  } catch (error) {
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      promptVersion,
      model: null,
      parsed: null,
      error: serializeError(error),
    };
  }
}

function logIdentify(log: (line: string) => void, item: ItemResult): void {
  const result = item.identify;
  if (!result?.parsed) {
    log(`  Identify FAILED: ${result?.error?.message}`);
    return;
  }
  const parsed = result.parsed;
  log(
    `Identify: ${parsed.name} [${parsed.category}] uncertainty=${parsed.uncertainty} model=${parsed.model}`
  );
  if (parsed.notes) log(`  notes: ${parsed.notes}`);
  if (parsed.alternatives.length) log(`  alternatives: ${parsed.alternatives.join("; ")}`);
}

function logEstimate(log: (line: string) => void, item: ItemResult): void {
  const result = item.estimate;
  if (!result?.parsed) {
    log(`  Estimate FAILED: ${result?.error?.message}`);
    return;
  }
  const parsed = result.parsed;
  const range =
    parsed.status === "estimated"
      ? ` $${parsed.low}-$${parsed.high} (likely $${parsed.likely}, ${parsed.confidence})`
      : "";
  log(`Estimate: ${parsed.status}${range} marketability=${parsed.marketability}`);
  log(`  reason: ${parsed.marketabilityReason}`);
  log(`  rationale: ${parsed.rationale}`);
  if (parsed.missingInformation.length) {
    log(`  would help: ${parsed.missingInformation.join("; ")}`);
  }
}

async function listItemDirectories(photosDir: string): Promise<string[]> {
  const entries = await fs.readdir(photosDir, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  if (directories.length === 0) {
    throw new Error(`No item subdirectories found in ${photosDir}`);
  }
  return directories;
}

async function readExpectedStatus(itemDir: string): Promise<string | null> {
  let value: string;
  try {
    value = (await fs.readFile(path.join(itemDir, "expected-status.txt"), "utf8")).trim();
  } catch {
    return null;
  }
  if (!value) {
    return null;
  }
  if (!VALUATION_STATUSES.has(value)) {
    throw new Error(
      `Invalid expected-status.txt in ${path.basename(itemDir)}: "${value}". Use estimated, nonmarketable, or insufficient_information.`
    );
  }
  return value;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// ============================================================
// Output
// ============================================================

/**
 * Write a redacted results.json into a new run directory under outDir.
 * Never overwrites an earlier run.
 */
export async function writeResults(
  outDir: string,
  run: EvalRun,
  secrets: string[] = []
): Promise<string> {
  const runDir = path.join(outDir, `run-${run.startedAt.replace(/[:.]/g, "-")}`);
  await fs.mkdir(runDir, { recursive: true });
  const file = path.join(runDir, "results.json");
  await fs.writeFile(file, `${JSON.stringify(redactDeep(run, secrets), null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return file;
}
