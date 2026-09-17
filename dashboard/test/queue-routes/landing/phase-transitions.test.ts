// A job moving from one phase to the next, read off the Specs list at
// every point on the way. The row draws from the queue, which moves the
// instant a step ends, and from the files and git history, which catch
// up a moment later — and each gap between the two used to be drawn as
// a fault: the phase waiting behind a landing read "Running", and the
// phase being merged read "last run reported done, but nothing reached
// the files". Driven through a real server with the merge held open, so
// the landing window is a point the test stands in rather than a race.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner, type GitRunner } from "../../../src/git/branch-status.ts";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import { TOKEN, openQuery, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
const SPEC = "81-queue-and-runner";
const FAULTS = /nothing reached the files|disagree|run it again/;

function own(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  ownDirs.push(dir);
  return dir;
}

function project(dir: string): { root: string; spec: string; specs: string } {
  const root = join(dir, "root");
  const spec = join(root, "aide", "specs", SPEC);
  mkdirSync(join(root, "aide", ".aide"), { recursive: true });
  writeFileSync(join(root, "aide", ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(spec, { recursive: true });
  writeFileSync(join(spec, "1-description.md"), "# 81 - Description\n");
  writeFileSync(join(spec, "4-status.md"), statusSaying(["create"]));
  const specs = join(dir, "aide-specs");
  mkdirSync(specs, { recursive: true });
  return { root, spec, specs };
}

/** Real git for what the row reads — the history's `log` — and a merge
 *  that does not return until `release()`, for the landing. */
function heldMergeGit() {
  const real = createGitRunner();
  let release = (): void => {};
  const gate = new Promise<void>((r) => (release = r));
  const run: GitRunner = async (dir, args) => {
    const a = args.join(" ");
    if (a.startsWith("log")) return real(dir, args);
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
    if (a.startsWith("merge -q --ff-only") || a.startsWith("merge -q --no-edit")) {
      await gate;
      return { code: 0, stdout: "" };
    }
    if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
    return { code: 0, stdout: "" };
  };
  return { run, release: () => release() };
}

async function jobNow(base: string, id: string): Promise<Record<string, unknown>> {
  const body = (await (await fetch(`${base}/api/queue/${id}`, { headers: AUTH })).json()) as {
    job: Record<string, unknown>;
  };
  return body.job;
}

async function settle(base: string, id: string, until: (job: Record<string, unknown>) => boolean) {
  for (let n = 0; n < 200; n++) {
    const job = await jobNow(base, id);
    if (until(job)) return job;
    await Bun.sleep(50);
  }
  throw new Error(`the job never reached the state asked for: ${JSON.stringify(await jobNow(base, id))}`);
}

const result = (specs: string) => ({
  ok: true,
  exitCode: 0,
  costUsd: 0.2,
  costMeasured: true,
  terminalReason: "completed",
  branch: `aide/${SPEC}`,
  repos: [],
  branchUrls: [{ root: specs, url: "https://example.test/aide-specs" }],
});

/** The spec's own row — its head, its phase lines and its notice — and
 *  nothing else on the page, whose help texts may use the same words. */
const rowOf = (html: string): string =>
  [
    ...html.matchAll(new RegExp(`<tr class="[^"]*"[^>]*data-(?:folder|step)="(?:${SPEC}|create|analyze|implement|archive)"[^>]*>[\\s\\S]*?</tr>`, "g")),
  ]
    .map((m) => m[0])
    .join("\n");

const stateOf = (html: string, step: string): string =>
  html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">[\\s\\S]*?<td data-col="state">([\\s\\S]*?)</td>`))?.[1] ?? "";

describe("a chained job's row between its phases", () => {
  test("no point between analyze and implement reads as a fault", async () => {
    const dir = own("aide-transitions-");
    const paths = project(dir);
    ran(dir, ["create"]);
    const git = heldMergeGit();
    const results = join(dir, "jobs");
    mkdirSync(results, { recursive: true });
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: paths.root,
        queueProjectRoot: paths.root,
        gitRun: git.run,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
      },
    });
    const page = async () =>
      await (await fetch(`${base}/?${openQuery(`aide/${SPEC}`)}`, { headers: { "x-aide-token": TOKEN } })).text();

    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze", "implement"] }),
      })
    ).json()) as { job: { id: string } };
    const id = made.job.id;
    await settle(base, id, (j) => j.state === "running");

    // Analyze did its work: its commit and its line, as the step leaves them.
    ran(dir, ["analyze"]);
    writeFileSync(join(paths.spec, "4-status.md"), statusSaying(["create", "analyze"]));
    writeFileSync(join(results, `${id}.json`), JSON.stringify(result(paths.specs)));

    // 1. Analyze is being merged, and the job already names implement.
    await settle(base, id, (j) => j.landing === true && j.state === "queued");
    const landing = await page();
    expect(rowOf(landing)).toContain('data-step="analyze"');
    expect(stateOf(landing, "analyze")).toContain("Running");
    expect(stateOf(landing, "implement")).not.toContain("Running");
    expect(rowOf(landing)).not.toMatch(FAULTS);

    // 2. The merge settles, and implement starts.
    git.release();
    await settle(base, id, (j) => !j.landing && j.state === "running");
    const implementing = await page();
    expect(stateOf(implementing, "analyze")).toContain("Done");
    expect(rowOf(implementing)).not.toMatch(FAULTS);

    // 3. Implement did its work and ended; it has no landing of its own.
    ran(dir, ["implement"]);
    writeFileSync(join(paths.spec, "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    writeFileSync(join(results, `${id}.json`), JSON.stringify(result(paths.specs)));
    await settle(base, id, (j) => j.state === "done" && !j.landing);
    const finished = await page();
    expect(stateOf(finished, "implement")).toContain("Done");
    expect(rowOf(finished)).not.toMatch(FAULTS);
  });
});
