// Shared test data for "the checks on the Overview tab", split across
// spec-overview-checks.test.ts and spec-checks-refusals-and-commit.test.ts
// (split out of spec-save.test.ts by theme).

import { join } from "node:path";
import type { GitRunner } from "../src/git/branch-status.ts";
import { SPEC, TOKEN, TICK, DESCRIPTION, FILE_SHA, savable, post } from "./spec-save-fixtures.ts";
import type { QueueHarness } from "./helpers/queue-server.ts";

export const PHASE = "Phase 4: REFACTOR - Test suite";
export const EARLIER_PHASE = "Phase 3: GREEN - Implement";
export const LATER_PHASE = "Phase 5: SHIP - After the merge";
export const OPEN_ROW = "| Manual check at 375px in a real browser | ⬜ | still outstanding |";
export const SECOND_OPEN_ROW = "| Read the whole diff once | ⬜ | |";
export const DONE_ROW = "| Run the full test suite | ✅ | 1742 pass |";
export const EARLIER_DONE_ROW = "| Write the code | ✅ | |";
export const LATER_ROW = "| Watch the first real run | ⬜ | |";
export const ticked = (row: string) => row.replace("| ⬜ |", "| ✅ |");

export const HEADER = ["| Task | Status | Notes |", "|------|--------|-------|"];
export const phaseSection = (heading: string, rows: string[]) =>
  [`## ${heading}`, "", "### Tasks", "", ...HEADER, ...rows, ""].join("\n");

/** Three phases: one settled, the current one, and one the workflow
 *  has not reached. `parseStatus` calls the first section still
 *  carrying an open mark the current phase, which is Phase 4 here. */
export const STATUS = [
  "# Queue - Status",
  "",
  "## Tracking info",
  "",
  "- **Workflow steps completed:** create, analyze, implement",
  "",
  "---",
  "",
  phaseSection(EARLIER_PHASE, [EARLIER_DONE_ROW]),
  phaseSection(PHASE, [DONE_ROW, OPEN_ROW, SECOND_OPEN_ROW]),
  phaseSection(LATER_PHASE, [LATER_ROW]),
].join("\n");

/** Spec 190: the same three phases, with every open mark spelled out
 *  the way a step actually wrote one — `Waiting`, not `⬜`. Nothing
 *  else differs. */
export const WORDED = STATUS.replace(/\| ⬜ \|/g, "| Waiting |");

/** Spec 266: a LOW-complexity spec's `4-status.md` uses `## Checklist`
 *  instead of `## Phase N: ...` — must offer the same box on Overview
 *  and accept the same real tick. */
export const CHECKLIST_PHASE = "Checklist";
export const CHECKLIST_OPEN_ROW = "| Run the manual browser check | ⬜ | |";
export const checklistSection = (rows: string[]) => ["## Checklist", "", ...HEADER, ...rows, ""].join("\n");
export const CHECKLIST_STATUS = [
  "# Queue - Status",
  "",
  "## Tracking info",
  "",
  "- **Workflow steps completed:** create, analyze, implement",
  "",
  "---",
  "",
  checklistSection([CHECKLIST_OPEN_ROW]),
].join("\n");

/** A spec a headless archive run declined: the hold-back section it
 *  wrote, and exactly one open row left anywhere in the file. */
export const HELD_BACK_REASON = "- the manual browser check (Phase 4, still unchecked) — tick it on the spec's page";
export const heldBack = (rows: string[]) =>
  [
    "# Queue - Status",
    "",
    "## Tracking info",
    "",
    "- **Workflow steps completed:** create, analyze, implement",
    "",
    "---",
    "",
    "## Archive held back",
    "",
    HELD_BACK_REASON,
    "",
    "---",
    "",
    phaseSection(EARLIER_PHASE, [EARLIER_DONE_ROW]),
    phaseSection(PHASE, rows),
  ].join("\n");

export const statusPath = (dir: string, folder = SPEC) => join(dir, "root", "aide", "specs", folder, "4-status.md");

export function startWithChecks(harness: QueueHarness, gitRun: GitRunner, status = STATUS) {
  return harness.start({ description: DESCRIPTION, status, extra: { queueToken: TOKEN, gitRun } });
}

/** The checks form's own body, and nothing else: the one shared phase
 *  every box on it belongs to, `4-status.md`'s own sha, and one
 *  `tick` per ticked box. There is no `text` field — the description
 *  is not in this request and cannot be written by it. */
export const tick = (base: string, over: { ticks?: string[]; phase?: string; statusBaseSha?: string } = {}) => {
  const body = new URLSearchParams([
    ...(over.phase === null ? [] : ([["checksPhase", over.phase ?? PHASE]] as [string, string][])),
    ["statusBaseSha", over.statusBaseSha ?? FILE_SHA],
    ...(over.ticks ?? []).map((line): [string, string] => ["tick", line]),
  ]);
  return fetch(`${base}${TICK}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
    redirect: "manual",
    body: body.toString(),
  });
};

/** The description form's own body: the textarea and its sha. */
export const save = (base: string, over: { text?: string; baseSha?: string } = {}) =>
  post(base, { text: over.text ?? DESCRIPTION, baseSha: over.baseSha ?? FILE_SHA });

/** Every git command the run was given, so the ONE commit and its
 *  message can both be read back. */
export const recording = (extra: Record<string, { code: number; stdout?: string }> = {}) => {
  const calls: string[][] = [];
  const inner = savable("/host", extra);
  const run: GitRunner = async (dir, args) => {
    calls.push(args);
    return inner(dir, args);
  };
  return { run, calls };
};
export const messageOf = (calls: string[][]): string => {
  const commit = calls.find((c) => c[0] === "commit")!;
  return commit[commit.indexOf("-m") + 1]!;
};
