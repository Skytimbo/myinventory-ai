import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OUT_DIR,
  REPO_ROOT,
  describeConfig,
  loadOpenAIConfig,
  parseArgs,
  redactSecrets,
  resolveOutDir,
  runEvaluation,
  writeResults,
  type EvalRun,
} from "../../scripts/ai-eval-lib";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const FAKE_KEY = "sk-proj-TESTKEYabcdefghijklmnopqrstuvwxyz0123456789";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("synthetic photo")]);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix = "ai-eval-test-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** photos/<item>/1.jpg (+ optional expected-status.txt) */
async function makePhotos(items: Record<string, string | null>): Promise<string> {
  const dir = await makeTempDir("ai-eval-photos-");
  for (const [item, expected] of Object.entries(items)) {
    await fs.mkdir(path.join(dir, item));
    await fs.writeFile(path.join(dir, item, "1.jpg"), JPEG);
    if (expected) {
      await fs.writeFile(path.join(dir, item, "expected-status.txt"), `${expected}\n`);
    }
  }
  return dir;
}

function reply(content: unknown) {
  return {
    id: "chatcmpl-test",
    model: "gpt-test",
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  };
}

function fakeClient(create: (...args: unknown[]) => unknown) {
  return { chat: { completions: { create: vi.fn(create) } } } as never;
}

const IDENTIFY_ROCK = {
  name: "River rock",
  description: "Smooth gray river rock.",
  category: "Natural Objects",
  tags: ["rock"],
  confidence: 0.95,
  uncertaintyNotes: null,
  possibleAlternatives: [],
};

const VALUATION_ROCK = {
  marketability: "nonmarketable",
  marketabilityReason: "Ordinary river rocks are not bought secondhand.",
  status: "nonmarketable",
  low: null,
  likely: null,
  high: null,
  confidence: null,
  rationale: "No realistic resale market.",
  missingInformation: [],
};

function authError() {
  return Object.assign(
    new Error(`401 Incorrect API key provided: sk-proj-****************wxyz. You can find your API key at https://platform.openai.com/account/api-keys.`),
    { status: 401, name: "AuthenticationError" }
  );
}

describe("ai:eval arguments and configuration", () => {
  it.each([
    [["photos"], { photosDir: "photos", outDir: null, mock: false, identifyOnly: false }],
    [["photos", "--out"], { outDir: DEFAULT_OUT_DIR }],
    [["photos", "--out", "--mock"], { outDir: DEFAULT_OUT_DIR, mock: true }],
    [["photos", "--out", "/tmp/eval"], { outDir: "/tmp/eval" }],
    [["photos", "--out=ai-eval-results/x", "--identify-only"], { outDir: "ai-eval-results/x", identifyOnly: true }],
  ])("parses %j", (argv, expected) => {
    expect(parseArgs(argv)).toMatchObject(expected);
  });

  it.each([[[]], [["--mock"]], [["photos", "--bogus"]], [["a", "b"]]])("rejects %j", (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });

  it("reads only OpenAI settings and never echoes the key", () => {
    const config = loadOpenAIConfig({
      OPENAI_API_KEY: FAKE_KEY,
      OPENAI_PROJECT_ID: "proj_test",
      DATABASE_URL: "postgres://user:secret@prod.example/db",
    });

    expect(Object.keys(config).sort()).toEqual(["apiKey", "baseURL", "projectId"]);
    expect(JSON.stringify(describeConfig(config))).not.toContain("TESTKEY");
  });

  it.each([
    [{}, "OPENAI_API_KEY is not set"],
    [{ OPENAI_API_KEY: "  " }, "OPENAI_API_KEY is not set"],
    [{ OPENAI_API_KEY: "__REPLACE_WITH_YOUR_OPENAI_KEY__" }, "placeholder"],
    [{ OPENAI_API_KEY: FAKE_KEY }, "OPENAI_PROJECT_ID is required"],
  ])("rejects invalid credential configuration %#", (env, message) => {
    let error: unknown;
    try {
      loadOpenAIConfig(env);
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain(message);
    expect(String(error)).not.toContain("TESTKEY");
  });

  it("describes a credential-bearing base URL by host only", () => {
    const described = describeConfig({
      apiKey: "sk-test",
      projectId: undefined,
      baseURL: "https://user:token123@proxy.example.com/v1?key=abc",
    });

    expect(described.baseUrlHost).toBe("proxy.example.com");
    expect(JSON.stringify(described)).not.toMatch(/token123|abc|user/);
  });
});

describe("ai:eval output location", () => {
  const repoRoot = REPO_ROOT;

  it("allows the gitignored default and subdirectories of it", () => {
    expect(resolveOutDir(DEFAULT_OUT_DIR, { cwd: repoRoot })).toBe(path.join(repoRoot, DEFAULT_OUT_DIR));
    expect(resolveOutDir("ai-eval-results/rock-test", { cwd: repoRoot })).toBe(
      path.join(repoRoot, "ai-eval-results", "rock-test")
    );
  });

  it("allows a directory outside the repository", () => {
    expect(resolveOutDir("/tmp/myinventory-eval", { cwd: repoRoot })).toBe("/tmp/myinventory-eval");
  });

  it.each(["docs/eval", ".", "ai-eval-results-other", "server"])(
    "refuses committable repository path %s",
    (out) => {
      expect(() => resolveOutDir(out, { cwd: repoRoot })).toThrow("must be under ai-eval-results/");
    }
  );

  it.each([
    ["the repository uploads directory", "uploads/eval", undefined],
    ["a configured LOCAL_STORAGE_DIR", "/srv/app-uploads/eval", "/srv/app-uploads"],
  ])("refuses %s", (_label, out, storageDir) => {
    expect(() => resolveOutDir(out, { cwd: repoRoot, storageDir })).toThrow(
      "must not be inside application storage"
    );
  });

  it("is covered by .gitignore", async () => {
    const gitignore = await fs.readFile(path.join(repoRoot, ".gitignore"), "utf8");
    expect(gitignore.split("\n")).toContain(`${DEFAULT_OUT_DIR}/`);
  });
});

describe("redactSecrets", () => {
  it.each([
    ["OpenAI's masked key echo", "401 Incorrect API key provided: sk-proj-********oS0A.", "oS0A"],
    ["a full key", `key=${FAKE_KEY}`, "TESTKEY"],
    ["a bearer token", "Authorization: Bearer abc.def-ghi", "abc.def"],
  ])("removes %s", (_label, text, leaked) => {
    const redacted = redactSecrets(text);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain(leaked);
  });

  it("removes an exact secret that does not look like a key", () => {
    expect(redactSecrets("token is hunter2xyz", ["hunter2xyz"])).toBe("token is [REDACTED]");
  });
});

describe("runEvaluation", () => {
  it("records identify and estimate as separate actions with raw and parsed results", async () => {
    const photosDir = await makePhotos({ "river-rock": "nonmarketable" });
    const cheap = fakeClient(async () => reply(IDENTIFY_ROCK));
    const premium = fakeClient(async () => reply(VALUATION_ROCK));

    const run = await runEvaluation({ photosDir, clients: { cheap, premium } });

    expect(run).toMatchObject({
      mode: "openai",
      models: { identifyCheap: "gpt-4o-mini", identifyPremium: "gpt-4o", valuation: "gpt-4o" },
      promptVersions: { identify: "identify-v2", valuation: "valuation-v2" },
      summary: { items: 1, failures: 0, mismatches: 0, skipped: 0 },
      abortedReason: null,
    });
    const [item] = run.items;
    expect(item.itemId).toBe("river-rock");
    expect(item.photos[0]).toMatchObject({ file: "1.jpg", bytes: JPEG.length });
    expect(item.identify).toMatchObject({
      promptVersion: "identify-v2",
      model: "gpt-4o-mini",
      parsed: { name: "River rock", uncertainty: "low" },
      error: null,
    });
    expect(item.estimate).toMatchObject({
      promptVersion: "valuation-v2",
      model: "gpt-4o",
      parsed: { status: "nonmarketable", likely: null },
      error: null,
    });
    expect(item.match).toBe(true);
    expect(item.calls.map((call) => [call.action, call.client, call.request.model])).toEqual([
      ["identify", "cheap", "gpt-4o-mini"],
      ["estimate", "premium", "gpt-4o"],
    ]);
    expect(item.calls[1].response).toEqual(reply(VALUATION_ROCK));
    for (const field of ["startedAt", "finishedAt"] as const) {
      expect(Date.parse(item.identify![field])).not.toBeNaN();
      expect(Date.parse(item.calls[0][field])).not.toBeNaN();
    }
    // Image bytes are summarized, never stored
    expect(JSON.stringify(item.calls)).not.toContain(JPEG.toString("base64"));
    expect(item.calls[0].request.content[0]).toMatchObject({
      type: "image_url",
      mime: "image/jpeg",
      bytes: JPEG.length,
    });
  });

  it("records both identify calls when the cheap model escalates", async () => {
    const photosDir = await makePhotos({ crock: null });
    const cheap = fakeClient(async () => reply({ name: "Jar", confidence: 0.1 }));
    const premium = fakeClient(async (params: unknown) =>
      (params as { model: string }).model === "gpt-4o" &&
      JSON.stringify(params).includes("identifying")
        ? reply({ ...IDENTIFY_ROCK, name: "Stoneware crock", confidence: 0.5 })
        : reply(VALUATION_ROCK)
    );

    const run = await runEvaluation({ photosDir, clients: { cheap, premium } });

    expect(run.items[0].calls.map((call) => `${call.action}:${call.client}`)).toEqual([
      "identify:cheap",
      "identify:premium",
      "estimate:premium",
    ]);
    expect(run.items[0].identify?.model).toBe("gpt-4o");
  });

  it("stops after invalid credentials and never attempts valuation", async () => {
    const photosDir = await makePhotos({ a: null, b: null });
    const cheap = fakeClient(async () => {
      throw authError();
    });
    const premium = fakeClient(async () => reply(VALUATION_ROCK));

    const run = await runEvaluation({ photosDir, clients: { cheap, premium } });

    expect(run.abortedReason).toContain("rejected the credentials");
    expect(run.items[0].identify?.error).toMatchObject({ status: 401, name: "AuthenticationError" });
    expect(run.items[0].estimate).toBeNull();
    expect(run.items[1]).toMatchObject({ skipped: expect.stringContaining("credentials"), identify: null });
    expect((premium as { chat: { completions: { create: ReturnType<typeof vi.fn> } } }).chat.completions.create).not.toHaveBeenCalled();
    expect(run.summary).toMatchObject({ failures: 1, skipped: 1 });
  });

  it("keeps the raw response when identification output is malformed", async () => {
    const photosDir = await makePhotos({ blurry: null });
    const cheap = fakeClient(async () => reply("{not json"));
    const premium = fakeClient(async () => reply(VALUATION_ROCK));

    const run = await runEvaluation({ photosDir, clients: { cheap, premium } });
    const [item] = run.items;

    expect(item.identify?.error?.message).toBe("AI returned invalid JSON");
    expect(item.estimate).toBeNull();
    expect(item.calls).toHaveLength(1);
    expect(item.calls[0].response).toEqual(reply("{not json"));
    expect(run.abortedReason).toBeNull();
  });

  it.each([
    ["a zero-valued estimate", { marketability: "marketable", status: "estimated", low: "0", likely: "0", high: "0", confidence: "low" }],
    ["a contradictory status", { marketability: "marketable", status: "nonmarketable" }],
  ])("records %s as a contract violation with its raw response", async (_label, valuation) => {
    const photosDir = await makePhotos({ item: "nonmarketable" });
    const cheap = fakeClient(async () => reply(IDENTIFY_ROCK));
    const premium = fakeClient(async () => reply(valuation));

    const run = await runEvaluation({ photosDir, clients: { cheap, premium } });
    const [item] = run.items;

    expect(item.estimate?.error?.name).toBe("InvalidValuationError");
    expect(item.estimate?.parsed).toBeNull();
    expect(item.match).toBeNull();
    expect(item.calls[1].response).toEqual(reply(valuation));
    expect(run.summary.failures).toBe(1);
  });

  it("reports a mismatch against expected-status.txt", async () => {
    const photosDir = await makePhotos({ drill: "estimated" });
    const run = await runEvaluation({
      photosDir,
      clients: {
        cheap: fakeClient(async () => reply(IDENTIFY_ROCK)),
        premium: fakeClient(async () => reply(VALUATION_ROCK)),
      },
    });

    expect(run.items[0].match).toBe(false);
    expect(run.summary.mismatches).toBe(1);
  });

  it("runs identification only with --identify-only", async () => {
    const photosDir = await makePhotos({ rock: null });
    const premium = fakeClient(async () => reply(VALUATION_ROCK));

    const run = await runEvaluation({
      photosDir,
      identifyOnly: true,
      clients: { cheap: fakeClient(async () => reply(IDENTIFY_ROCK)), premium },
    });

    expect(run.items[0].estimate).toBeNull();
    expect(run.items[0].calls).toHaveLength(1);
  });

  it("skips item folders without photos and rejects invalid expected statuses", async () => {
    const photosDir = await makePhotos({ rock: null });
    await fs.mkdir(path.join(photosDir, "empty"));
    const run = await runEvaluation({ photosDir });
    expect(run.items.find((item) => item.itemId === "empty")?.skipped).toBe("no photos");

    await fs.writeFile(path.join(photosDir, "rock", "expected-status.txt"), "worthless");
    await expect(runEvaluation({ photosDir })).rejects.toThrow("Invalid expected-status.txt");
  });
});

describe("writeResults", () => {
  it("writes a redacted results.json in a new run directory and never overwrites", async () => {
    const outDir = await makeTempDir("ai-eval-out-");
    const photosDir = await makePhotos({ a: null });
    const run: EvalRun = await runEvaluation({
      photosDir,
      clients: {
        cheap: fakeClient(async () => {
          throw authError();
        }),
        premium: fakeClient(async () => reply(VALUATION_ROCK)),
      },
    });

    const file = await writeResults(outDir, run, [FAKE_KEY]);
    const text = await fs.readFile(file, "utf8");
    const saved = JSON.parse(text) as EvalRun;

    expect(path.dirname(path.dirname(file))).toBe(outDir);
    expect(path.basename(file)).toBe("results.json");
    expect(text).not.toMatch(/sk-proj-\*/);
    expect(text).not.toContain("wxyz");
    expect(saved.items[0].identify?.error?.message).toContain("[REDACTED]");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await expect(writeResults(outDir, run)).rejects.toThrow();
  });
});

describe("ai:eval isolation", () => {
  it("bundles only the analyzer and the OpenAI SDK: no database, storage, dotenv, or migrations", async () => {
    const result = await build({
      entryPoints: [path.join(REPO_ROOT, "scripts/ai-eval.ts")],
      absWorkingDir: REPO_ROOT,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile.inputs).sort();
    const externals = new Set(
      Object.values(result.metafile.inputs).flatMap((input) =>
        input.imports.filter((entry) => entry.external).map((entry) => entry.path)
      )
    );

    expect(inputs).toEqual(["scripts/ai-eval-lib.ts", "scripts/ai-eval.ts", "server/analyzer.ts"]);
    expect(Array.from(externals).sort()).toEqual(["crypto", "fs", "openai", "path", "url"]);
  });

  it("does not load .env: without OPENAI_API_KEY in the shell it refuses to run", async () => {
    const photosDir = await makePhotos({ rock: null });
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };

    const error = await execFileAsync(
      path.join(REPO_ROOT, "node_modules/.bin/tsx"),
      ["scripts/ai-eval.ts", photosDir],
      { cwd: REPO_ROOT, env }
    ).catch((caught: { code: number; stdout: string; stderr: string }) => caught);

    expect(error).toMatchObject({ code: 1 });
    const { stdout, stderr } = error as { stdout: string; stderr: string };
    expect(stderr).toContain("OPENAI_API_KEY is not set");
    expect(`${stdout}${stderr}`).not.toMatch(/sk-[A-Za-z0-9]/);
  }, 30_000);

  it("runs end to end in mock mode and writes results outside the repository", async () => {
    const photosDir = await makePhotos({ rock: null });
    const outDir = await makeTempDir("ai-eval-cli-out-");
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };

    const { stdout } = await execFileAsync(
      path.join(REPO_ROOT, "node_modules/.bin/tsx"),
      ["scripts/ai-eval.ts", photosDir, "--mock", "--out", outDir],
      { cwd: REPO_ROOT, env }
    );

    expect(stdout).toContain("Done (mock). 1 item(s): 0 failure(s)");
    const [runDir] = await fs.readdir(outDir);
    const saved = JSON.parse(await fs.readFile(path.join(outDir, runDir, "results.json"), "utf8"));
    expect(saved).toMatchObject({ mode: "mock", config: { provider: "mock" } });
    expect(saved.items[0].identify.parsed.name).toBe("Mock Item");
  }, 30_000);
});
