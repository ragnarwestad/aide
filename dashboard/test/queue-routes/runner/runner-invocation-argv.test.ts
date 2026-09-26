// Split out of runner-invocation.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { extraPathDirs, pathWithToolDirs } from "../../../src/serve/tool-path.ts";
import { fileOnceWritten } from "../../helpers/file-once-written.ts";
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusSaying } from "../../helpers/queue-server.ts";
import { scheduleRunOutputDir } from "../../../src/queue/schedule.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { runnerArgv } from "../../../src/serve/serve.ts";
import { analysisSessionToResume } from "../../../src/serve/serve-helpers/runner-argv.ts";
import type { ServerOptions } from "../../../src/serve/serve.ts";

const { harness } = setupQueueRoutesHarness();
// Every spec here has ALREADY been analyzed. These tests enqueue
// `implement` and watch the runner get spawned; since spec 344 an
// implement on a spec with no analyze on its steps line is held back
// in the queue instead, and the spawn these tests wait for never comes.
const ANALYZED = statusSaying(["create", "analyze"]);
const start = (extra: Partial<ServerOptions> = {}) => harness.start({ extra, status: ANALYZED });

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
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
      `#!/usr/bin/env bash\nprintf '%s\\n' "$AIDE_RUN_URL" "$PATH" > ${envFile}\nprintf '%s\\n' "$*" > ${argvFile}\n`,
      { mode: 0o755 },
    );
    return { bin, argvFile, envFile };
  }

  async function argvOf(argvFile: string): Promise<string> {
    return fileOnceWritten(argvFile, "the runner was never invoked");
  }

  /** What the spawned child actually had in its environment: the run
   *  URL on the first line, PATH on the second. */
  async function envOf(envFile: string): Promise<{ runUrl: string; path: string }> {
    const [runUrl = "", path = ""] = (await fileOnceWritten(envFile, "the runner was never invoked")).split("\n");
    return { runUrl, path };
  }

  /** Spec 222. The variable belongs to the SERVER's process while the
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
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(res.status).toBe(200);
    // `port: 0` above means "let the OS pick", so the bound port is the
    // only one worth asserting against — and a server that never bound
    // one would otherwise quietly compare against `undefined`.
    const port = server.port;
    if (!port) throw new Error("the test server never bound a port");
    return { env: await envOf(envFile), port };
  }

  test("what the runner writes to stderr lands in the step's own run log (AC-3)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-run-log-"));
    ownDirs.push(dir);
    const bin = join(dir, "fake-run-spec");
    writeFileSync(bin, `#!/usr/bin/env bash\necho "aide-run-spec 10:45:08 +0s fetching main" >&2\n`, { mode: 0o755 });
    const jobs = join(dir, "jobs");
    const { base } = start({ queueRunnerBin: bin, queueResultDir: jobs, queuePush: "branch" });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
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
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(res.status).toBe(200);
    const argv = await argvOf(argvFile);
    expect(argv).toContain("--push branch");
    expect(argv).toContain("--permission-mode bypassPermissions");
    expect(argv).toContain("--model opus");
    expect(argv).toContain("--command implement");
  });

  // Spec 222. `aide-emit-run` reports each TDD phase, and does nothing
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
  // (432, 2026-09-10).
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

  // Spec 220, acceptance criterion 2. The global `push` setting speaks
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
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
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

// Acceptance criterion 1 (the spawn-time half): only a `schedule` step's
// own spawn carries `AIDE_SCHEDULE_OUTPUT_DIR`, and by the time the
// child starts, the directory it names already exists on disk.
describe("the schedule step's output directory (spec 272)", () => {
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
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(res.status).toBe(200);
    const env = await fileOnceWritten(envFile, "the runner was never invoked");
    expect(env.trim()).toBe("<unset>");
  });
});

// Spec 511: `--reset-files` reaches the runner for a `reopen` job that asked
// for it, and for nothing else.
describe("--reset-files", () => {
  const argvFor = (step: string, extra: Record<string, unknown>): string[] =>
    runnerArgv(
      {
        id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: [step], stepIndex: 0,
        model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [], ...extra,
      } as unknown as Parameters<typeof runnerArgv>[0],
      step, "/tmp/r.json", { runnerBin: "/bin/aide-run-spec", projectDir: "/p", push: "branch" },
    );

  test("a reopen job with resetFiles passes it AC-3", () => {
    expect(argvFor("reopen", { resetFiles: true })).toContain("--reset-files");
  });
  test("a reopen job without resetFiles does not AC-2", () => {
    expect(argvFor("reopen", {})).not.toContain("--reset-files");
  });
  test("another step never passes it, whatever the job says AC-3", () => {
    expect(argvFor("analyze", { resetFiles: true })).not.toContain("--reset-files");
  });
});

// A wiki refresh reaches the runner as --wiki-refresh; a build does not.
describe("--wiki-refresh", () => {
  const argvFor = (extra: Record<string, unknown>): string[] =>
    runnerArgv(
      {
        id: "j1", project: "aide", specFolder: "wiki-aide", steps: ["wiki"], stepIndex: 0,
        model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [], ...extra,
      } as unknown as Parameters<typeof runnerArgv>[0],
      "wiki", "/tmp/r.json", { runnerBin: "/bin/aide-run-spec", projectDir: "/p", push: "branch" },
    );

  test("a refresh passes it", () => {
    expect(argvFor({ wikiRefresh: true })).toContain("--wiki-refresh");
  });
  test("a build does not", () => {
    expect(argvFor({})).not.toContain("--wiki-refresh");
  });
});

// An implement continues its analysis's own session: the latest finished
// analysis of the spec, run with the same AI, ended within the hour.
describe("the analysis session an implement continues", () => {
  const NOW = Date.parse("2026-09-26T14:00:00Z");
  const job = (results: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
    ({ id: "j", project: "aide", specFolder: "541-x", steps: ["analyze", "implement"], results, ...extra }) as never;
  const analysis = (at: string, extra: Record<string, unknown> = {}) =>
    ({ step: "analyze", ok: true, sessionId: "s-analyze", tool: "claude", at, ...extra });

  test("a recent analysis with the same AI is continued", () => {
    const j = job([analysis("2026-09-26T13:30:00Z")]);
    expect(analysisSessionToResume(j, [j], "claude", NOW)).toBe("s-analyze");
  });

  test("one older than an hour, run with another AI, or not finished, is not", () => {
    for (const r of [
      analysis("2026-09-26T12:30:00Z"),
      analysis("2026-09-26T13:30:00Z", { tool: "codex" }),
      analysis("2026-09-26T13:30:00Z", { ok: false }),
    ]) {
      const j = job([r]);
      expect(analysisSessionToResume(j, [j], "claude", NOW)).toBeUndefined();
    }
  });

  test("the analysis may be in an earlier job for the same spec, and the latest one wins", () => {
    const earlier = job([analysis("2026-09-26T13:10:00Z", { sessionId: "s-old" }), analysis("2026-09-26T13:40:00Z", { sessionId: "s-new" })], { id: "e" });
    const other = job([analysis("2026-09-26T13:50:00Z", { sessionId: "s-other" })], { id: "o", specFolder: "540-y" });
    const now = job([], { id: "n", steps: ["implement"] });
    expect(analysisSessionToResume(now, [earlier, other, now], "claude", NOW)).toBe("s-new");
  });

  test("only an implement is handed the session", () => {
    const argvFor = (step: string): string[] =>
      runnerArgv(
        {
          id: "j1", project: "aide", specFolder: "541-x", steps: [step], stepIndex: 0,
          model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [],
        } as unknown as Parameters<typeof runnerArgv>[0],
        step, "/tmp/r.json", { runnerBin: "/bin/aide-run-spec", projectDir: "/p", push: "branch", resumeSession: "s-analyze" },
      );
    expect(argvFor("implement")).toContain("--resume-session");
    expect(argvFor("archive")).not.toContain("--resume-session");
  });
});
