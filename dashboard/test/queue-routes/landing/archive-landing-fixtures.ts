// What the archive-landing suites share: a git that answers however a
// test needs it to, a server wired to it, and the temp directories
// they clean up after themselves.
//
// Split out of archive-landing.test.ts 2026-09-04 (777 lines).

import { afterEach } from "bun:test";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSentence } from "../../../src/i18n/message.ts";

/** The message a job carries, as text. Since spec 380 a job stores
 *  WHICH message and what fills its blanks; the reader composes it.
 *  These tests assert on what a reader would see, so they compose it
 *  the same way, in English. */
import { type ServerOptions } from "../../../src/serve/serve.ts";

export function sentence(s: unknown): string {
  return renderSentence("en", s as Parameters<typeof renderSentence>[1]) ?? "";
}

import {
  TOKEN,
  setupQueueRoutesHarness,
} from "../fixtures.ts";

export const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
export const ownDirs: string[] = [];

export const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
export const SPECS_REPO = "/repos/aide-specs";

export function gitFor({
  conflicting = [],
  needsRealMerge = [],
  gone = [],
  deleteFails = [],
  stillOpenAfterDelete = [],
}: {
  conflicting?: string[];
  needsRealMerge?: string[];
  gone?: string[];
  /** spec 319: roots whose `push -q origin --delete <branch>` fails —
   *  the merge itself still succeeds, only the tidy-up does not. */
  deleteFails?: string[];
  /** spec 319: roots the post-loop `ls-remote --heads ... refs/heads/
   *  aide/*` check should still report `branch` open on — the fixture
   *  a delete-fails root needs so `rootsStillHolding` finds it again,
   *  the way real origin would after a rejected delete. */
  stillOpenAfterDelete?: { root: string; branch: string }[];
} = {}) {
  const calls: { dir: string; args: string[] }[] = [];
  const run = async (dir: string, args: string[]) => {
    calls.push({ dir, args });
    const a = args.join(" ");
    if (a.startsWith("ls-remote --exit-code") && gone.includes(dir)) return { code: 2, stdout: "" };
    if (a.startsWith("ls-remote --heads")) {
      const open = stillOpenAfterDelete.filter((o) => o.root === dir);
      if (open.length) {
        return { code: 0, stdout: open.map((o) => `abc123\trefs/heads/${o.branch}\n`).join("") };
      }
      return { code: 0, stdout: "" };
    }
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
    if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
    if (a.startsWith("merge -q --ff-only origin/")) return { code: 0, stdout: "" };
    if (a.startsWith("merge -q --ff-only")) {
      return { code: conflicting.includes(dir) || needsRealMerge.includes(dir) ? 1 : 0, stdout: "" };
    }
    if (a.startsWith("merge -q --no-edit")) return { code: conflicting.includes(dir) ? 1 : 0, stdout: "" };
    if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
    if (a.startsWith("push -q origin --delete") && deleteFails.includes(dir)) {
      return { code: 1, stdout: "", stderr: "remote rejected: hook declined" };
    }
    return { code: 0, stdout: "" };
  };
  return { run, calls };
}

export function serverWithRunner(
  start: (options: Partial<ServerOptions>) => { base: string; dir: string },
  prefix: string,
  git: { run: (dir: string, args: string[]) => Promise<unknown> },
  extra: Partial<ServerOptions> = {},
) {
  const results = mkdtempSync(join(tmpdir(), prefix));
  ownDirs.push(results);
  const { base, dir } = start({
    queueToken: TOKEN,
    gitRun: git.run as never,
    queueRunnerBin: "/usr/bin/true",
    queueResultDir: results,
    ...extra,
  });
  return { base, dir, results };
}

export async function settle(
  base: string,
  id: string,
  done: (job: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let n = 0; n < 100; n++) {
    const res = await fetch(`${base}/api/queue/${id}`, { headers: AUTH });
    const body = (await res.json()) as { job: Record<string, unknown> };
    if (done(body.job)) return body.job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the job never settled");
}

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// Spec 136: an archive run's whole diff is two markdown changes in the
// specs repo — the date stamped into 4-status.md and the folder moved
// into `archive/` — and, like every other step, it leaves them on a
// branch. The list reads the main checkout, so the spec stayed in the
// active list and the row asked to be merged: the step that ENDS a spec
// ended by handing back a task (133, archived twice for exactly this).
// So archive lands its own work, the way `create` has since spec 93 —
// the same helper, the same per-repo report, the same visible refusal
// when a merge genuinely cannot be made.


/** The result `aide-run-spec` writes for an archive step that moved the
 *  folder and pushed the specs repo. No `specFolder`: that field is
 *  create's, and an archive step reports none. */
export const SPEC = "81-queue-and-runner";
export const BRANCH = `aide/${SPEC}`;

export const ARCHIVE_RESULT = {
  ok: true,
  exitCode: 0,
  costUsd: 0.2,
  costMeasured: true,
  terminalReason: "completed",
  branch: BRANCH,
  branchUrls: [{ root: SPECS_REPO, url: "https://example.test/aide-specs" }],
  repos: [],
};

/** Queue one step for the harness's own spec, straight through — no
 *  gate, so the run reaches `onStepDone` without a press. */
export async function runStep(base: string, step: string): Promise<{ id: string; specFolder: string }> {
  const made = (await (
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [step] }),
    })
  ).json()) as { job: { id: string; specFolder: string } };
  return made.job;
}

export const merges = (calls: { dir: string; args: string[] }[]) =>
  calls.filter((c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${BRANCH}`));
