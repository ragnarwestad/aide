// Split out of history-and-freshness.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusSaying } from "../helpers/queue-server.ts";
import { TOKEN, setupQueueRoutesHarness } from "./fixtures.ts";

const { harness } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// Spec 207: a landed archive writes what the spec cost in time.
//
// The figure the spec list shows is worked out from the queue's own job
// records, and the queue keeps two hundred jobs. The archive holds
// ninety specs and grows, so a figure that is never written down is a
// figure almost every archived row will be missing. It is written the
// moment the archive branch has actually MERGED — not when the step
// reported success — because a landing that failed leaves a spec that
// is not archived.
describe("what a spec cost in time is written when its archive lands (spec 207)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;
  /** What `rev-parse --show-toplevel` answers. Faked git, so nothing
   *  runs there — it is the lock key and the directory the commit and
   *  the push are addressed to. */
  const REPO_ROOT = "/repos/aide";

  function own(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(d);
    return d;
  }

  /** The runner's own commit subjects for this spec, which is what
   *  decides `done` — `withFreshness` reads git, never the job results.
   *  Newest first, the way `git log` prints them. */
  const HISTORY = [
    `Run /aide-archive for ${SPEC} (headless)`,
    `Run /aide-implement for ${SPEC} (headless)`,
    `Run /aide-analyze for ${SPEC} (headless)`,
  ];

  /** A git that answers every question the landing AND the stamp's own
   *  save ask. The save is `saveSpecFile`, the same call the Edit page
   *  makes: pull-fast-forward, compare the file's last commit against
   *  the caller's, write, stage, commit, push.
   *
   *  `history` is what `git log --all` reports for this spec, and it is
   *  the ONLY thing that decides which steps count as done. `dirty`
   *  makes the pull refuse, which is how a stamp write is failed
   *  without failing anything else. */
  function gitFor({ history = HISTORY, dirty = false } = {}) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "master\n" };
      if (a === "rev-parse --show-toplevel") return { code: 0, stdout: `${REPO_ROOT}\n` };
      if (a === "rev-parse HEAD") return { code: 0, stdout: "beefcafe1234\n" };
      // The checkout the save writes in. Clean unless a test says
      // otherwise, and a dirty one is what the pull refuses by name.
      if (a === "diff --quiet HEAD") return { code: dirty ? 1 : 0, stdout: "" };
      // Something IS staged after the write, or `saveSpecFiles` would
      // report the file unchanged and never commit.
      if (a.startsWith("diff --cached --quiet")) return { code: 1, stdout: "" };
      // Which steps this spec has HAD. `--all`, because implement's
      // commit sits on the spec's branch until archive lands it.
      if (a.startsWith("log --all")) return { code: 0, stdout: `${history.join("\n")}\n` };
      // One sha for every file, so the save's optimistic-concurrency
      // check compares the value it was handed against itself.
      if (a.startsWith("log -1 --format=%H")) return { code: 0, stdout: "c0ffee123456\t2026-08-16T09:00:00+02:00\n" };
      // The pull's own fast-forward check. Every other `merge-base`
      // question — "is this branch merged" — keeps its old answer.
      if (a === "merge-base --is-ancestor HEAD refs/remotes/origin/master") return { code: 0, stdout: "" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      if (a.startsWith("merge -q")) return { code: 0, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  function serverWith(dir: string, git: { run: (d: string, a: string[]) => Promise<unknown> }) {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(project, "specs", SPEC), { recursive: true });
    writeFileSync(join(project, "specs", SPEC, "1-description.md"), "# 81 - Description\n");
    writeFileSync(join(project, "specs", SPEC, "4-status.md"), statusSaying(["create", "analyze"]));
    const results = join(dir, "jobs");
    mkdirSync(results, { recursive: true });
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: projectsRoot,
        queueProjectRoot: projectsRoot,
        gitRun: git.run as never,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
      },
    });
    return { base, results, statusFile: join(project, "specs", SPEC, "4-status.md") };
  }

  const RESULT = (over: Record<string, unknown> = {}) => ({
    ok: true,
    exitCode: 0,
    costUsd: 0.2,
    costMeasured: true,
    terminalReason: "completed",
    branch: BRANCH,
    branchUrls: [{ root: REPO_ROOT, url: "https://example.test/aide" }],
    repos: [],
    ...over,
  });

  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 200; n++) {
      const body = (await (await fetch(`${base}/api/queue/${id}`, { headers: AUTH })).json()) as {
        job: Record<string, unknown>;
      };
      if (done(body.job)) return body.job;
      await Bun.sleep(25);
    }
    throw new Error("the job never settled");
  }

  /** One step, run to completion with the result `aide-run-spec` would
   *  have written, handed back as the queue left it. */
  async function step(
    base: string,
    results: string,
    name: string,
    settled: (j: Record<string, unknown>) => boolean = (j) => j.state === "done" && !j.landing,
  ): Promise<Record<string, unknown>> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [name] }),
      })
    ).json()) as { job: { id: string } };
    writeFileSync(join(results, `${made.job.id}.json`), JSON.stringify(RESULT()));
    return settle(base, made.job.id, settled);
  }

  /** The figure the file carries, or null when it carries none. The
   *  reader's own contract, spelled out again here rather than imported:
   *  a test that asked the code under test what it wrote would prove
   *  only that it agreed with itself. */
  const stampedMs = (file: string): number | null => {
    const m = readFileSync(file, "utf-8").match(/^.*\*\*Time spent \(ms\):\*\*[ \t]*(.*)$/m);
    if (!m) return null;
    const value = m[1]!.replace(/`/g, "").trim();
    return /^\d+$/.test(value) ? Number(value) : null;
  };

  /** What the phases add up to, worked out from the jobs' OWN
   *  `StepResult.at` timestamps — never from the rendered label, which
   *  is rounded to the second, and never from a hardcoded number. A
   *  job's first step counts from the job's own start; every later one
   *  from where the step before it ended. */
  const expectedMs = (jobs: Record<string, unknown>[]): number => {
    let total = 0;
    for (const job of jobs) {
      const results = (job.results ?? []) as { at: string }[];
      let boundary = Date.parse(job.startedAt as string);
      for (const r of results) {
        total += Date.parse(r.at) - boundary;
        boundary = Date.parse(r.at);
      }
    }
    return total;
  };

  // Criterion 1.
  test("a landed archive stamps 4-status.md with what the phases added up to", async () => {
    const dir = own("aide-207-stamp-");
    const git = gitFor();
    const { base, results, statusFile } = serverWith(dir, git);

    const analyze = await step(base, results, "analyze");
    const implement = await step(base, results, "implement", (j) => j.state === "done");
    const archive = await step(base, results, "archive");

    expect(archive.error).toBeFalsy();
    const stamped = stampedMs(statusFile);
    expect(stamped).not.  toBeNull();
    expect(stamped).toBe(expectedMs([analyze, implement, archive]));
    // The file is committed and pushed like any other spec edit — the
    // stamp is no use to anyone sitting in a working tree.
    expect(git.calls.some((c) => c.dir === REPO_ROOT && c.args[0] === "commit")).toBe(true);
    expect(git.calls.some((c) => c.dir === REPO_ROOT && c.args[0] === "push")).toBe(true);
  }, 20000);

  // Criterion 5. 133 was archived three times; a spec whose archive is
  // run again must not grow a second bullet or have its first one
  // rewritten with a figure measured over a different set of jobs.
  test("archiving a second time leaves the first figure exactly as it was", async () => {
    const dir = own("aide-207-again-");
    const git = gitFor();
    const { base, results, statusFile } = serverWith(dir, git);

    await step(base, results, "analyze");
    await step(base, results, "implement", (j) => j.state === "done");
    await step(base, results, "archive");
    const first = stampedMs(statusFile);
    expect(first).not.toBeNull();

    await step(base, results, "archive");
    expect(stampedMs(statusFile)).toBe(first);
    expect(readFileSync(statusFile, "utf-8").match(/Time spent \(ms\)/g)).toHaveLength(1);
  }, 30000);

  // Criterion 6. The merge already happened. A write that cannot be
  // made is logged and left there — turning a landed archive into a
  // failed job would hand back a task nobody can act on, and the row
  // it leaves is a blank cell, which is a state the archive page
  // already draws for half its rows.
  test("a stamp that cannot be written leaves the archive landed and the job clean", async () => {
    const dir = own("aide-207-refused-");
    const git = gitFor({ dirty: true });
    const { base, results, statusFile } = serverWith(dir, git);

    await step(base, results, "analyze");
    await step(base, results, "implement", (j) => j.state === "done");
    const archive = await step(base, results, "archive");

    expect(archive.state).toBe("done");
    expect(archive.error).toBeFalsy();
    expect(archive.errorReason).toBeFalsy();
    expect(stampedMs(statusFile)).toBeNull();
  }, 20000);

  // Criterion 8. These jobs' own results say all three steps finished.
  // `done` does not come from them: it comes from the runner's commits,
  // through the same `withFreshness` the live list uses — which is what
  // takes `analyze` back out when the description moved on after it.
  // A spec the list would show no total for must store none either.
  test("a spec whose history is short of a phase stores nothing, whatever its jobs report", async () => {
    const dir = own("aide-207-short-");
    const git = gitFor({ history: [`Run /aide-analyze for ${SPEC} (headless)`] });
    const { base, results, statusFile } = serverWith(dir, git);

    await step(base, results, "analyze");
    await step(base, results, "implement", (j) => j.state === "done");
    const archive = await step(base, results, "archive");

    expect(archive.error).toBeFalsy();
    expect(stampedMs(statusFile)).toBeNull();
  }, 20000);
});
