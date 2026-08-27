// Split out of runner-invocation.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusSaying } from "../helpers/queue-server.ts";
import { TOKEN, setupQueueRoutesHarness } from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

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

  async function fileOnceWritten(path: string, what: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        await Bun.sleep(50);
      }
    }
    throw new Error(what);
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
      queueToken: TOKEN,
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush: "branch",
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, "content-type": "application/json", accept: "application/json" },
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

  test("the push mode, the permission mode and the model all reach the command line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-spawn-"));
    ownDirs.push(dir);
    const { bin, argvFile } = stub(dir);
    const { base } = start({
      queueToken: TOKEN,
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush: "branch",
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, "content-type": "application/json", accept: "application/json" },
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
  test("and the rest of the environment still reaches it", async () => {
    await withRunUrlEnv(null, async () => {
      const { env } = await envHandedToTheRunner("aide-queue-run-url-inherit-");
      expect(env.path.length).toBeGreaterThan(0);
      expect(env.path).toBe(process.env.PATH ?? "");
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
    writeFileSync(join(project, "specs", "81-queue-and-runner", "4-status.md"), statusSaying(["create"]));
    return { root, dir };
  }

  async function pushArgOf(landing: string | null, queuePush: "none" | "branch" | "pr"): Promise<string> {
    const { root, dir } = projectSaying(`aide-queue-landing-${landing ?? "unset"}-`, landing);
    const { bin, argvFile } = stub(dir);
    const { base } = start({
      queueToken: TOKEN,
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush,
      projectRoot: root,
      queueProjectRoot: root,
      dashboardCheckoutRoot: join(dir, "owned"),
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, "content-type": "application/json", accept: "application/json" },
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
