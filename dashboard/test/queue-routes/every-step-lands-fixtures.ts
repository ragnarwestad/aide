// Shared test data for the "every step lands its own work (spec 149)"
// suite, split across every-step-basic-landing.test.ts,
// every-step-origin-recheck.test.ts and every-step-pull-request.test.ts
// (split out of stopped-and-every-step.test.ts by theme). Every function
// here used to be a closure inside one shared `describe` block; kept as
// plain functions taking their harness/dir explicitly, since three
// separate test files now call them.

import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerOptions } from "../../src/serve/serve.ts";
import { statusSaying, type QueueHarness } from "../helpers/queue-server.ts";
import { TOKEN } from "./fixtures.ts";

export const SPEC = "81-queue-and-runner";
export const BRANCH = `aide/${SPEC}`;
export const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

/** Temp directories a test file makes for itself, outside the harness —
 *  one tracker per file, so `afterEach` in one file never sweeps
 *  another's. */
export function createOwnDirs() {
  const dirs: string[] = [];
  return {
    own: (prefix: string): string => {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(dir);
      return dir;
    },
    cleanup: (): void => {
      while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
    },
  };
}

/** A git that answers per repo. `conflicting` names the roots whose
 *  merge fails both ways. `slow` delays the ff-only merge, so two
 *  landings on one root can be caught overlapping.
 *
 *  `openOn` (spec 193) names the roots whose ORIGIN still has the
 *  spec branch, and a merge that succeeds in a root takes it out of
 *  that set — which is what `mergeBranchIntoDefault` really does, by
 *  deleting the branch on origin once it has landed. `lsRemoteCode`
 *  is what a root that cannot be asked answers: an unreachable host,
 *  not an empty list. */
export function gitFor({
  conflicting = [] as string[],
  slow = null as null | (() => Promise<void>),
  openOn = [] as string[],
  lsRemoteCode = 0,
} = {}) {
  const calls: { dir: string; args: string[] }[] = [];
  const open = new Set(openOn);
  const merged = (dir: string): { code: number; stdout: string } => {
    if (conflicting.includes(dir)) return { code: 1, stdout: "" };
    open.delete(dir);
    return { code: 0, stdout: "" };
  };
  const run = async (dir: string, args: string[]) => {
    calls.push({ dir, args });
    const a = args.join(" ");
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
    if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
    if (a.startsWith("ls-remote --heads origin refs/heads/aide/*")) {
      return {
        code: lsRemoteCode,
        stdout: lsRemoteCode === 0 && open.has(dir) ? `a3f9c21\trefs/heads/${BRANCH}\n` : "",
      };
    }
    if (a.startsWith("merge -q --ff-only")) {
      if (slow) await slow();
      return merged(dir);
    }
    if (a.startsWith("merge -q --no-edit")) return merged(dir);
    if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
    return { code: 0, stdout: "" };
  };
  return { run, calls };
}

/** A discoverable project root with a real directory for the project's
 *  own checkout, plus the specs repo the run pushes to.
 *
 *  `archiveSpec` is what the specs-root merge brings into the main
 *  checkout (spec 193): the folder move the archive run committed on
 *  its branch. Until it is called the spec is LIVE on disk, which is
 *  why an archive-landing test that never calls it steps straight
 *  past the archived filter and can assert nothing about it. */
export function repos(dir: string): {
  root: string;
  project: string;
  specs: string;
  archiveSpec: () => void;
} {
  const projectsRoot = join(dir, "root");
  const project = join(projectsRoot, "aide");
  const specs = join(dir, "aide-specs");
  mkdirSync(join(project, ".aide"), { recursive: true });
  writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(join(project, "specs", SPEC), { recursive: true });
  writeFileSync(join(project, "specs", SPEC, "1-description.md"), "# 81 - Description\n");
  writeFileSync(join(project, "specs", SPEC, "4-status.md"), statusSaying(["create", "analyze"]));
  mkdirSync(specs, { recursive: true });
  return {
    root: projectsRoot,
    project,
    specs,
    archiveSpec: () => {
      mkdirSync(join(project, "specs", "archive"), { recursive: true });
      renameSync(join(project, "specs", SPEC), join(project, "specs", "archive", SPEC));
    },
  };
}

/** The install the project runs once its code has landed — a `touch`,
 *  so the test can ask whether it ran by asking the filesystem. */
export function installs(project: string): string {
  const marker = join(project, "installed");
  writeFileSync(join(project, ".aide", "config"), `AIDE_INSTALL_CMD=/usr/bin/touch ${marker}\n`);
  return marker;
}

export function serverWith(
  harness: QueueHarness,
  dir: string,
  paths: { root: string },
  git: { run: (dir: string, args: string[]) => Promise<unknown> },
  extra: Partial<ServerOptions> = {},
): { base: string } {
  const results = join(dir, "jobs");
  mkdirSync(results, { recursive: true });
  return harness.start({
    extra: {
      queueToken: TOKEN,
      projectRoot: paths.root,
      queueProjectRoot: paths.root,
      gitRun: git.run as never,
      queueRunnerBin: "/usr/bin/true",
      queueResultDir: results,
      ...extra,
    },
  });
}

export const resultDir = (dir: string) => join(dir, "jobs");

export async function runStep(base: string, step: string): Promise<{ id: string }> {
  const made = (await (
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [step] }),
    })
  ).json()) as { job: { id: string } };
  return made.job;
}

export async function settle(
  base: string,
  id: string,
  done: (job: Record<string, unknown>) => boolean,
  // Enough for one poll tick plus a landing's own retries (~4s worst
  // case). A caller waiting for a SECOND step to start after the first
  // one's landing settles needs a second poll tick on top of that —
  // `Runner.tick()` only runs on the periodic timer, not the moment a
  // landing clears — so it passes a larger budget explicitly.
  maxIterations = 100,
): Promise<Record<string, unknown>> {
  for (let n = 0; n < maxIterations; n++) {
    const body = (await (await fetch(`${base}/api/queue/${id}`, { headers: AUTH })).json()) as {
      job: Record<string, unknown>;
    };
    if (done(body.job)) return body.job;
    await Bun.sleep(50);
  }
  throw new Error("the job never settled");
}

export const merges = (calls: { dir: string; args: string[] }[], root?: string) =>
  calls.filter(
    (c) =>
      c.args[0] === "merge" &&
      c.args.includes(`refs/remotes/origin/${BRANCH}`) &&
      (root === undefined || c.dir === root),
  );

export const result = (over: Record<string, unknown> = {}) => ({
  ok: true,
  exitCode: 0,
  costUsd: 0.2,
  costMeasured: true,
  terminalReason: "completed",
  branch: BRANCH,
  repos: [],
  ...over,
});

/** Run one step to completion with the result `aide-run-spec` would
 *  have written for it, and hand back the job as the queue left it. */
export async function stepWithResult(
  base: string,
  dir: string,
  step: string,
  over: Record<string, unknown>,
  settled: (job: Record<string, unknown>) => boolean = (j) => j.state === "done" && !j.landing,
): Promise<Record<string, unknown>> {
  const job = await runStep(base, step);
  writeFileSync(join(resultDir(dir), `${job.id}.json`), JSON.stringify(result(over)));
  return settle(base, job.id, settled);
}
