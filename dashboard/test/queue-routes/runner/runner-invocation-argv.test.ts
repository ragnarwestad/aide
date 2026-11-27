// Split out of runner-invocation.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { extraPathDirs, pathWithToolDirs } from "../../../src/serve/tool-path.ts";
import { fileOnceWritten } from "../../helpers/file-once-written.ts";
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { stateSaying, statusSaying } from "../../helpers/queue-server.ts";
import { scheduleRunOutputDir } from "../../../src/queue/schedule.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import type { ServerOptions } from "../../../src/serve/serve.ts";

const { harness } = setupQueueRoutesHarness();
// Every spec here has ALREADY been analyzed. These tests enqueue
// `implement` and watch the runner get spawned; an
// implement on a spec with no analyze on its steps line is held back
// in the queue instead, and the spawn these tests wait for never comes.
const ANALYZED = statusSaying(["create", "analyze"]);
const start = (extra: Partial<ServerOptions> = {}) => harness.start({ extra, status: ANALYZED, liveState: stateSaying(["create", "analyze"]) });

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

/** Queues an implement of the harness's spec on the server at `base`. */
const queueImplement = (base: string): Promise<Response> =>
  fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
  });

// Slice 81c: what the server actually hands the runner. The binary is a
// recording stub — one tiny local process, no claude, no network.
describe("the runner invocation", () => {
  function stub(dir: string): { bin: string; argvFile: string; envFile: string } {
    const argvFile = join(dir, "runner-argv.txt");
    const envFile = join(dir, "runner-env.txt");
    const bin = join(dir, "fake-run-spec");
    // The environment first, the argv last: `argvOf` is what most of
    // these tests poll for, and a file written after it would be read
    // half-empty on a slow machine.
    writeFileSync(
      bin,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$AIDE_RUN_URL" "$PATH" "$AIDE_QUEUE_CONFIG" "$AIDE_CHECKOUT_ROOT" "$AIDE_QUEUE_MIRROR" > ${envFile}\nprintf '%s\\n' "$*" > ${argvFile}\n`,
      { mode: 0o755 },
    );
    return { bin, argvFile, envFile };
  }

  async function argvOf(argvFile: string): Promise<string> {
    return fileOnceWritten(argvFile, "the runner was never invoked");
  }

  /** What the spawned child actually had in its environment: the run
   *  URL on the first line, PATH on the second. */
  async function envOf(envFile: string): Promise<{ runUrl: string; path: string; queueConfig: string; checkoutRoot: string; queueMirror: string }> {
    const [runUrl = "", path = "", queueConfig = "", checkoutRoot = "", queueMirror = ""] =
      (await fileOnceWritten(envFile, "the runner was never invoked")).split("\n");
    return { runUrl, path, queueConfig, checkoutRoot, queueMirror };
  }

  /** The variable belongs to the SERVER's process while the
   *  spawn happens, so it is set and restored around the whole test,
   *  not merely before `start()`. A developer whose own shell exports
   *  it would otherwise get a false pass on the derived-URL test. */
  async function withRunUrlEnv<T>(value: string | null, body: () => Promise<T>): Promise<T> {
    const before = process.env.AIDE_RUN_URL;
    if (value === null) delete process.env.AIDE_RUN_URL;
    else process.env.AIDE_RUN_URL = value;
    try {
      return await body();
    } finally {
      if (before === undefined) delete process.env.AIDE_RUN_URL;
      else process.env.AIDE_RUN_URL = before;
    }
  }

  /** Queues one implement step against a stub runner and hands back
   *  what the child was given, plus the port the server actually bound
   *  (`port: 0` here, so it is never `opts.port`). */
  async function envHandedToTheRunner(prefix: string): Promise<{ env: { runUrl: string; path: string }; port: number }> {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    const { bin, envFile } = stub(dir);
    const { base, server } = start({
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush: "branch",
    });
    const res = await queueImplement(base);
    expect(res.status).toBe(200);
    // `port: 0` above means "let the OS pick", so the bound port is the
    // only one worth asserting against — and a server that never bound
    // one would otherwise quietly compare against `undefined`.
    const port = server.port;
    if (!port) throw new Error("the test server never bound a port");
    return { env: await envOf(envFile), port };
  }

  // The runner's sandbox denies a step writing the board's queue settings
  // and its checkouts' git hooks and settings.yaml; it can only find them
  // where this board says they are.
  test("the runner is told where the board's queue settings and checkouts are", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-sandbox-paths-"));
    ownDirs.push(dir);
    const { bin, envFile } = stub(dir);
    const queueConfigFile = join(dir, "queue-config.json");
    const dashboardCheckoutRoot = join(dir, "checkouts");
    const { base } = start({
      queueRunnerBin: bin, queueResultDir: join(dir, "jobs"), queuePush: "branch", queueConfigFile, dashboardCheckoutRoot,
    });
    const res = await queueImplement(base);
    expect(res.status).toBe(200);
    const env = await envOf(envFile);
    expect(env.queueConfig).toBe(queueConfigFile);
    expect(env.checkoutRoot).toBe(dashboardCheckoutRoot);
  });

  // The runner counts the steps and landings running at the moment its tests
  // start by reading the board's queue mirror, so it has to know where that is.
  test("the runner is told where the board mirrors its queue (AC-1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-mirror-path-"));
    ownDirs.push(dir);
    const { bin, envFile } = stub(dir);
    const queueMirrorPath = join(dir, "aide-queue.json");
    const { base } = start({
      queueRunnerBin: bin, queueResultDir: join(dir, "jobs"), queuePush: "branch", queueMirrorPath,
    });
    const res = await queueImplement(base);
    expect(res.status).toBe(200);
    expect((await envOf(envFile)).queueMirror).toBe(queueMirrorPath);
  });

  test("what the runner writes to stderr lands in the step's own run log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-run-log-"));
    ownDirs.push(dir);
    const bin = join(dir, "fake-run-spec");
    writeFileSync(bin, `#!/usr/bin/env bash\necho "aide-run-spec 10:45:08 +0s fetching main" >&2\n`, { mode: 0o755 });
    const jobs = join(dir, "jobs");
    const { base } = start({ queueRunnerBin: bin, queueResultDir: jobs, queuePush: "branch" });
    const res = await queueImplement(base);
    expect(res.status).toBe(200);
    let log = "";
    for (let i = 0; i < 200 && !log.includes("fetching main"); i++) {
      const name = existsSync(jobs) ? readdirSync(jobs).find((f) => f.endsWith(".implement.run.log")) : undefined;
      log = name ? readFileSync(join(jobs, name), "utf-8") : "";
      if (!log.includes("fetching main")) await Bun.sleep(50);
    }
    expect(log).toBe("aide-run-spec 10:45:08 +0s fetching main\n");
  });

  test("the push mode, the permission mode and the model all reach the command line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-spawn-"));
    ownDirs.push(dir);
    const { bin, argvFile } = stub(dir);
    const { base } = start({
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush: "branch",
    });
    const res = await queueImplement(base);
    expect(res.status).toBe(200);
    const argv = await argvOf(argvFile);
    expect(argv).toContain("--push branch");
    expect(argv).toContain("--permission-mode bypassPermissions");
    expect(argv).toContain("--model opus");
    expect(argv).toContain("--command implement");
    expect(argv).toContain("--project-name aide");
  });

  test("the board hands its worktree base and scripts folder to the runner (AC-1, AC-4)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-runner-layout-"));
    ownDirs.push(dir);
    const { bin, argvFile } = stub(dir);
    const { base } = start({ queueRunnerBin: bin, queueResultDir: join(dir, "jobs"), queuePush: "branch" });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(res.status).toBe(200);
    const argv = await argvOf(argvFile);
    expect(argv).toContain(`--worktree-base ${join(dir, "worktrees")}`);
    expect(argv).toContain(`--scripts-dir ${dir}`);
  });

  // `aide-emit-run` reports each TDD phase, and does nothing
  // at all unless `AIDE_RUN_URL` is set — so a headless step reported
  // its phases into silence, because nothing on the chain from launchd
  // to the spawned `claude` ever set it. The dashboard knows its own
  // address, so the runner tells the step where to report.
  test("a spawned step is told to report its phases back to this server", async () => {
    await withRunUrlEnv(null, async () => {
      const { env, port } = await envHandedToTheRunner("aide-queue-run-url-");
      expect(env.runUrl).toBe(`http://127.0.0.1:${port}/api/aide-run`);
    });
  });

  // The derived URL is a default, never an override: an operator who
  // has pointed reporting at another sink keeps it.
  test("and an AIDE_RUN_URL the server was started with wins over the derived one", async () => {
    await withRunUrlEnv("http://example.test/elsewhere", async () => {
      const { env } = await envHandedToTheRunner("aide-queue-run-url-explicit-");
      expect(env.runUrl).toBe("http://example.test/elsewhere");
    });
  });

  // `Bun.spawn`'s `env`, once given at all, REPLACES the child's
  // environment rather than layering onto it. The call passed none
  // before this spec, so the child inherited everything implicitly;
  // dropping the spread would take PATH away from `claude` and `git`
  // and break every headless step — worse than the silence it fixes.
  //
  // The server's own PATH reaches the runner whole, with the directories
  // a spawned tool needs put in front of it — `tool-path.ts` decides
  // which, and this asserts the rule rather than a second copy of the
  // arithmetic. Exact equality held only in a shell that already had
  // them on PATH; under the landing's own run, started from launchd, it
  // does not, and the test went red on a merge that never touched this
  //.
  test("and the rest of the environment still reaches it", async () => {
    await withRunUrlEnv(null, async () => {
      const { env } = await envHandedToTheRunner("aide-queue-run-url-inherit-");
      const own = process.env.PATH ?? "";
      expect(env.path.length).toBeGreaterThan(0);
      expect(env.path.endsWith(own)).toBe(true);
      expect(env.path).toBe(pathWithToolDirs());
      for (const dir of extraPathDirs()) expect(env.path).toContain(dir);
    });
  });

  // The global `push` setting speaks
  // for every project on the host at once; a project that reviews its
  // code says so in its own committed manifest, and that answer wins.
  // Both halves have to travel together — a landing left open with no
  // pull request describing it is worse than either behaviour alone —
  // so the choice reaches the runner as `--push pr` rather than only
  // gating the merge on this side.
  //
  // A projects root of the test's own, because the shared harness
  // leaves `queueProjectRoot` unset and the runner is then handed a bare
  // relative name — there is no manifest at the end of that.
  function projectSaying(prefix: string, landing: string | null): { root: string; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    const root = join(dir, "root");
    const project = join(root, "aide");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(
      join(project, ".aide", "project.yaml"),
      `name: aide\n${landing ? `codeLanding: ${landing}\n` : ""}`,
    );
    mkdirSync(join(project, "specs", "81-queue-and-runner"), { recursive: true });
    writeFileSync(join(project, "specs", "81-queue-and-runner", "1-description.md"), "# 81 - Description\n");
    writeFileSync(join(project, "specs", "81-queue-and-runner", "4-status.md"), ANALYZED);
    writeFileSync(join(project, "specs", "81-queue-and-runner", "4-status.json"), stateSaying(["create", "analyze"]));
    return { root, dir };
  }

  async function pushArgOf(landing: string | null, queuePush: "none" | "branch" | "pr"): Promise<string> {
    const { root, dir } = projectSaying(`aide-queue-landing-${landing ?? "unset"}-`, landing);
    const { bin, argvFile } = stub(dir);
    const { base } = start({
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush,
      projectRoot: root,
      queueProjectRoot: root,
      dashboardCheckoutRoot: join(dir, "owned"),
    });
    const res = await queueImplement(base);
    expect(res.status).toBe(200);
    return (await argvOf(argvFile)).match(/--push (\S+)/)![1]!;
  }

  test("a project whose manifest says pr is run with --push pr, whatever the global setting", async () => {
    expect(await pushArgOf("pr", "branch")).toBe("pr");
  });

  test("and one that says nothing keeps the global setting it always had", async () => {
    // `merge` never overrides anything DOWNWARDS: it is the absence of
    // an opinion, and the host's own config keeps deciding.
    expect(await pushArgOf(null, "pr")).toBe("pr");
    expect(await pushArgOf("merge", "branch")).toBe("branch");
    expect(await pushArgOf(null, "none")).toBe("none");
  });
});

// The spawn-time half: only a `schedule` step's
// own spawn carries `AIDE_SCHEDULE_OUTPUT_DIR`, and by the time the
// child starts, the directory it names already exists on disk.
describe("the schedule step's output directory", () => {
  function scheduleEnvStub(dir: string): { bin: string; envFile: string } {
    const envFile = join(dir, "runner-schedule-env.txt");
    const bin = join(dir, "fake-run-spec-schedule");
    writeFileSync(
      bin,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$AIDE_SCHEDULE_OUTPUT_DIR" > ${envFile}\n`,
      { mode: 0o755 },
    );
    return { bin, envFile };
  }

  test("a schedule step's spawn carries AIDE_SCHEDULE_OUTPUT_DIR, pointed at the run's own directory under runs/<jobId>, and the directory already exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-schedule-env-"));
    ownDirs.push(dir);
    const { bin, envFile } = scheduleEnvStub(dir);
    const outputRoot = join(dir, "schedule-output");
    const { base } = start({
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      scheduleOutputRoot: outputRoot,
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "schedule-nightly-report", steps: ["schedule"] }),
    });
    expect(res.status).toBe(200);
    const env = await fileOnceWritten(envFile, "the runner was never invoked");
    const { job } = await res.json();
    const expected = scheduleRunOutputDir(outputRoot, "aide", "schedule-nightly-report", job.id);
    expect(env.trim()).toBe(expected);
    expect(existsSync(expected)).toBe(true);
  });

  test("every OTHER step's spawn carries no such env key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-schedule-env-absent-"));
    ownDirs.push(dir);
    const envFile = join(dir, "runner-schedule-env.txt");
    const bin = join(dir, "fake-run-spec-implement");
    writeFileSync(
      bin,
      `#!/usr/bin/env bash\nprintf '%s\\n' "\${AIDE_SCHEDULE_OUTPUT_DIR:-<unset>}" > ${envFile}\n`,
      { mode: 0o755 },
    );
    const { base } = start({
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush: "branch",
      scheduleOutputRoot: join(dir, "schedule-output"),
    });
    const res = await queueImplement(base);
    expect(res.status).toBe(200);
    const env = await fileOnceWritten(envFile, "the runner was never invoked");
    expect(env.trim()).toBe("<unset>");
  });
});

describe("the provider folders handed to the runner's environment", () => {
  async function envListFor(queueDefaults: Record<string, unknown>): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-account-dirs-"));
    ownDirs.push(dir);
    const envFile = join(dir, "runner-env.txt");
    const bin = join(dir, "fake-run-spec");
    writeFileSync(bin, `#!/usr/bin/env bash\nprintf '<%s>\\n<%s>\\n' "\${AIDE_CLAUDE_CONFIG_DIRS-unset}" "\${AIDE_CODEX_HOMES-unset}" > ${envFile}\n`, { mode: 0o755 });
    const { base } = start({ queueRunnerBin: bin, queueResultDir: join(dir, "jobs"), queuePush: "branch", queueDefaults } as never);
    const res = await queueImplement(base);
    expect(res.status).toBe(200);
    return (await fileOnceWritten(envFile, "the runner was never invoked")).trimEnd();
  }
  const BASE = {
    timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { implement: "opus", default: "sonnet" },
  };

  test("every provider's folders, expanded, one list per tool, the normal ones left out (AC-17)", async () => {
    const env = await envListFor({
      ...BASE,
      providers: {
        Claude: { name: "Claude", tool: "claude" },
        Work: { name: "Work", tool: "claude", configDir: "~/.claude-2" },
        Spare: { name: "Spare", tool: "claude", configDir: "/opt/claude-3" },
        Codex: { name: "Codex", tool: "codex" },
        Shadow: { name: "Shadow", tool: "codex", codexHome: "~/.codex", shadowHome: "~/.codex-shadow" },
      },
    });
    expect(env).toBe(`<${homedir()}/.claude-2\n/opt/claude-3>\n<${homedir()}/.codex-shadow>`);
  });

  test("neither list is set when no provider has a folder of its own (AC-17)", async () => {
    expect(await envListFor(BASE)).toBe("<unset>\n<unset>");
  });
});

describe("a project's own choice for a side part", () => {
  test("the runner is handed the project's Review model and AI when the job carries no pick for it (AC-3)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-project-review-"));
    ownDirs.push(dir);
    const argvFile = join(dir, "runner-argv.txt");
    const bin = join(dir, "fake-run-spec");
    writeFileSync(bin, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${argvFile}\n`, { mode: 0o755 });
    const queueDefaults = {
      timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
      model: { implement: "opus", default: "opus" },
      modelChoices: { opus: {}, Sonnet: { model: "sonnet" } },
      providers: { Claude: { name: "Claude", tool: "claude" }, Work: { name: "Work", tool: "claude", configDir: "/opt/claude-work" } },
      projectModels: { aide: { model: { review: "Sonnet" }, provider: { review: "Work" } } },
    };
    const { base } = start({ queueRunnerBin: bin, queueResultDir: join(dir, "jobs"), queuePush: "branch", queueDefaults } as never);
    const res = await queueImplement(base);
    expect(res.status).toBe(200);
    const argv = await fileOnceWritten(argvFile, "the runner was never invoked");
    expect(argv).toContain("--review-model sonnet --review-tool claude --review-claude-config-dir /opt/claude-work");
  });
});
