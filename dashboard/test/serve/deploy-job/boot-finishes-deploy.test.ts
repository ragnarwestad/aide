// A board that boots with a deploy job left running after its restart finishes
// it before the runner reconciles: the job ends done, not "interrupted — the
// server restarted". `finishDeployAfterRestart` is proven on its own in
// `after-restart.test.ts`; this proves the boot calls it, and in time.

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../../helpers/queue-server.ts";

const harness = queueHarness("aide-boot-deploy-");
const dirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A checkout with one commit: the one this process "runs". */
function checkout(): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "aide-boot-deploy-repo-"));
  dirs.push(root);
  const git = (...args: string[]) => Bun.spawnSync({ cmd: ["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], cwd: root, stdout: "pipe" });
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "first");
  return { root, head: git("rev-parse", "HEAD").stdout.toString().trim() };
}

/** A deploy job the previous process left `running` after firing its restart. */
function leftRunning(repo: { root: string; head: string }, results: string) {
  return {
    id: "dep1",
    project: "aide",
    specFolder: "deploy",
    steps: ["deploy"],
    stepIndex: 0,
    state: "running",
    timeoutSec: {},
    permissionMode: {},
    model: {},
    results: [],
    spentUsd: 0,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    stepStartedAt: new Date().toISOString(),
    // The process that fired the restart is gone.
    pid: 4_194_000,
    pgid: 0,
    resultFile: join(results, "dep1.json"),
    streamFile: join(results, "dep1.deploy.stream.jsonl"),
    deploy: { root: repo.root, commit: repo.head, restartedAt: new Date().toISOString(), leaving: "an-earlier-process" },
  };
}

function resultsDir(): string {
  const results = mkdtempSync(join(tmpdir(), "aide-boot-deploy-jobs-"));
  dirs.push(results);
  mkdirSync(results, { recursive: true });
  return results;
}

test("the deploy left running after its restart is done once the new process has booted on its commit (AC-1)", async () => {
  const repo = checkout();
  const results = resultsDir();
  const { base } = harness.start({
    extra: { dashboardRoot: repo.root, queueRunnerBin: "/usr/bin/true", queueResultDir: results },
    queueMirror: JSON.stringify([leftRunning(repo, results)]),
  });
  const listed = (await (await fetch(`${base}/api/queue`)).json()) as { jobs: { id: string; state: string }[] };
  expect(listed.jobs.find((j) => j.id === "dep1")?.state).toBe("done");
});

test("a start that fails before the HTTP server is up does not record the deploy as done (AC-2)", () => {
  const repo = checkout();
  const results = resultsDir();
  const taken = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  try {
    expect(() =>
      harness.start({
        extra: { port: taken.port, dashboardRoot: repo.root, queueRunnerBin: "/usr/bin/true", queueResultDir: results },
        queueMirror: JSON.stringify([leftRunning(repo, results)]),
      }),
    ).toThrow();
    expect(existsSync(join(results, "dep1.json"))).toBe(false);
  } finally {
    taken.stop(true);
  }
});
