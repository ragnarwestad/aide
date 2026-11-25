// What the archive-landing suites share: a git that answers however a
// test needs it to, a server wired to it, and the temp directories
// they clean up after themselves.
//
// Split out of archive-landing.test.ts 2026-09-04 (777 lines).

import { IMPLEMENTED } from "../../helpers/queue-server.ts";
import { mergeAnswer, settle as settleFor } from "./every-step-lands-fixtures.ts";
import { afterEach } from "bun:test";
import { rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSentence } from "../../../src/messages/format.ts";

/** The message a job carries, as text. A job stores
 *  WHICH message and what fills its blanks; the reader composes it.
 *  These tests assert on what a reader would see, so they compose it
 *  the same way, in English. */
import { type ServerOptions } from "../../../src/serve/serve.ts";

export function sentence(s: unknown): string {
  return formatSentence("en", s as Parameters<typeof formatSentence>[1]) ?? "";
}

import { setupQueueRoutesHarness } from "../fixtures.ts";
import { WAITING_RUNNER } from "../../helpers/waiting-runner.ts";

export const { harness, start } = setupQueueRoutesHarness(undefined, IMPLEMENTED);

/** Temp directories this suite makes for itself, outside the harness. */
export const ownDirs: string[] = [];

export const AUTH = { "content-type": "application/json", accept: "application/json" };
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
  /** Roots whose `push -q origin --delete <branch>` fails —
   *  the merge itself still succeeds, only the tidy-up does not. */
  deleteFails?: string[];
  /** Roots the post-loop `ls-remote --heads ... refs/heads/
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
    const merge = mergeAnswer(a, dir, conflicting, needsRealMerge);
    if (merge) return merge;
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
    gitRun: git.run as never,
    queueRunnerBin: WAITING_RUNNER,
    queueResultDir: results,
    ...extra,
  });
  return { base, dir, results };
}

/** The job polled until `done` holds, for up to ten seconds. */
export const settle = (base: string, id: string, done: (job: Record<string, unknown>) => boolean) =>
  settleFor(base, id, done, 200);

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// An archive run's whole diff is two markdown changes in the
// specs repo — the date stamped into 4-status.md and the folder moved
// into `archive/` — and, like every other step, it leaves them on a
// branch. The list reads the main checkout, so the spec stayed in the
// active list and the row asked to be merged: the step that ENDS a spec
// ended by handing back a task (133, archived twice for exactly this).
// So archive lands its own work, the way `create` does —
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

/** Both of the project's repos as a result's `branchUrls`: the specs
 *  root first, then the code root. */
export const bothRoots = (specsRoot: string, codeRoot: string) => [
  { root: specsRoot, url: "https://example.test/aide-specs" },
  { root: codeRoot, url: "https://example.test/aide" },
];

/** Writes the archive result `aide-run-spec` leaves for job `id`, with
 *  `over` on top of `ARCHIVE_RESULT`. */
export function writeArchiveResult(results: string, id: string, over: Record<string, unknown> = {}): void {
  writeFileSync(join(results, `${id}.json`), JSON.stringify({ ...ARCHIVE_RESULT, ...over }));
}

/** What `ls-remote --heads` answers on an origin still holding the spec branch. */
export const STILL_OPEN = { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };

type GitAnswer = { code: number; stdout: string; stderr?: string };

/** `inner` with `answer` asked first: a call it answers is recorded in
 *  `inner.calls` and answered so; every other call goes to `inner`. */
export function gitAnswering(
  inner: { calls: { dir: string; args: string[] }[]; run: (dir: string, args: string[]) => Promise<unknown> },
  answer: (dir: string, a: string) => GitAnswer | undefined,
) {
  return {
    calls: inner.calls,
    run: async (dir: string, args: string[]) => {
      const answered = answer(dir, args.join(" "));
      if (!answered) return inner.run(dir, args);
      inner.calls.push({ dir, args });
      return answered;
    },
  };
}
