// Shared test data for the spec-save suite, split across
// spec-edit-save-and-misc.test.ts, spec-depends-on-field.test.ts,
// spec-overview-checks.test.ts and spec-checks-refusals-and-commit.test.ts
// (split out of spec-save.test.ts by theme).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../src/git/branch-status.ts";
import { queueHarness, type QueueHarness } from "./helpers/queue-server.ts";

export const TOKEN = "s3cret-token";
export const SPEC = "81-queue-and-runner";
export const EDIT = `/specs/aide/${SPEC}/edit`;
export const SAVE = `/api/queue/specs/aide/${SPEC}/save`;
export const TICK = `/api/queue/specs/aide/${SPEC}/tick`;
export const DESCRIPTION_TAB = `/specs/aide/${SPEC}?tab=description`;
export const CHECKS_TAB = `/specs/aide/${SPEC}?tab=checks`;
// REQ-2: the three read-only document tabs, alongside DESCRIPTION_TAB.
export const ANALYSIS_TAB = `/specs/aide/${SPEC}?tab=analysis`;
export const SOLUTION_TAB = `/specs/aide/${SPEC}?tab=solution`;
export const STATUS_TAB = `/specs/aide/${SPEC}?tab=status`;
export const PAGE = `/specs/aide/${SPEC}`;
export const FILE_SHA = "a3f9c21aaaaaaa";
export const HEAD_SHA = "1111111bbbbbbb";

export const DESCRIPTION = "# Queue and runner - Description\n\n## Description\n\nAs it was.\n";
export const NEW_TEXT = "# Queue and runner - Description\n\n## Description\n\nAs it is now.\n";

export const auth = { headers: { "x-aide-token": TOKEN } };

export const descriptionPath = (dir: string, folder = SPEC) => specFilePath(dir, "1-description.md", folder);

// REQ-1/REQ-2: the same path Description's own `descriptionPath` names,
// generalized to any of the four files — the three newly-editable tabs'
// own save tests need it too.
export const specFilePath = (dir: string, file: string, folder = SPEC) =>
  join(dir, "root", "aide", "specs", folder, file);

// REQ-2: `project()` (queue-server.ts) writes only 1-description.md and
// 4-status.md for the active spec — Analysis and Solution are the
// analyze step's own output, which no test harness fixture claims this
// spec has run. A suite that wants those two tabs non-empty writes them
// directly, the same way `queue-detail-spec-page-routes.test.ts`'s own
// `fillSpec` does.
export const fillAnalysisAndSolution = (dir: string, folder = SPEC): void => {
  const spec = join(dir, "root", "aide", "specs", folder);
  writeFileSync(join(spec, "2-analysis.md"), "# Q - Analysis\n\nSeven files.\n");
  writeFileSync(join(spec, "3-solution.md"), "# Q - Solution\n\nOne must-fix.\n");
};

// Spec 163: an archived spec is a record, and both halves of the edit
// pair have to say so — hiding the button leaves the save endpoint live
// for anyone who already has the URL.
export const ARCHIVED = "150-one-page-shows-the-whole-spec";
export const ARCHIVED_TEXT = "# One page shows the whole spec - Description\n";
export const archivedDescriptionPath = (dir: string) =>
  join(dir, "root", "aide", "specs", "archive", ARCHIVED, "1-description.md");

/** One harness plus the two `start` shapes every describe in this suite
 *  uses, so each test file gets its own harness instance rather than
 *  sharing a module-level singleton across files. */
export function createSpecSaveHarness(prefix = "aide-spec-save-") {
  const harness: QueueHarness = queueHarness(prefix);
  const start = (gitRun: GitRunner, extra = {}) =>
    harness.start({ description: DESCRIPTION, extra: { queueToken: TOKEN, gitRun, ...extra } });
  const startArchived = (gitRun: GitRunner) =>
    harness.start({
      description: DESCRIPTION,
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT } },
      extra: { queueToken: TOKEN, gitRun },
    });
  return { harness, start, startArchived };
}

/** A specs checkout that is clean, on its default branch, reachable,
 *  and whose description last moved at `FILE_SHA`. Everything a save
 *  asks for succeeds unless a test overrides it. */
export const savable = (root: string, extra: Record<string, { code: number; stdout?: string }> = {}): GitRunner => {
  const answers: Record<string, { code: number; stdout?: string }> = {
    "rev-parse --show-toplevel": { code: 0, stdout: `${root}\n` },
    // Something IS staged after the write: the ordinary case is a real
    // edit. The no-op test flips this one line.
    "diff --cached --quiet HEAD": { code: 1 },
    "diff --quiet HEAD": { code: 0 },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "rev-parse HEAD": { code: 0, stdout: `${HEAD_SHA}\n` },
    "symbolic-ref --quiet refs/remotes/origin/HEAD": { code: 0, stdout: "refs/remotes/origin/main\n" },
    fetch: { code: 0 },
    "merge-base --is-ancestor": { code: 0 },
    "merge -q --ff-only": { code: 0 },
    "log -1 --format=": { code: 0, stdout: `${FILE_SHA}\t2026-08-21T09:14:00+02:00\n` },
    add: { code: 0 },
    commit: { code: 0 },
    push: { code: 0 },
    "reset --hard": { code: 0 },
    ...extra,
  };
  return async (_dir, args) => {
    const line = args.join(" ");
    for (const [prefix, answer] of Object.entries(answers)) {
      if (line.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
    }
    return { code: 1, stdout: "" };
  };
};

export const post = (base: string, body: Record<string, string>, path = SAVE, token: string | null = TOKEN) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(token ? { "x-aide-token": token } : {}),
    },
    redirect: "manual",
    body: new URLSearchParams(body).toString(),
  });
