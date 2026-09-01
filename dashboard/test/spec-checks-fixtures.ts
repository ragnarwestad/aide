// Shared test data for "the checks on the Overview tab", split across
// spec-overview-checks.test.ts and spec-checks-refusals-and-commit.test.ts
// (split out of spec-save.test.ts by theme).

import { join } from "node:path";
import { specBranch, type GitRunner } from "../src/git/branch-status.ts";
import { SPEC, TOKEN, TICK, DESCRIPTION, FILE_SHA, savable, post } from "./spec-save-fixtures.ts";
import type { QueueHarness } from "./helpers/queue-server.ts";

/** The one section a person ticks, and so the only one the Checks tab
 *  draws as boxes: the Phase tables below are the implement RUN's own
 *  record and gate nothing (archive's only gate has been the Acceptance
 *  section since spec 268). */
export const PHASE = "Acceptance criteria";
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

/** A TDD phase left open (implement's own row, never the person's)
 *  alongside an open Acceptance criteria section (always the person's).
 *  The Checks tab draws the second and not the first. */
export const ACCEPTANCE_PHASE = PHASE;
export const ACCEPTANCE_OPEN_ROW = "| REQ-1: something testable | ⬜ | |";
export const TDD_PHASE = "Phase 4: REFACTOR - Test suite";
export const TDD_OPEN_ROW = "| Re-read the whole diff once | ⬜ | |";
export const STATUS_WITH_OPEN_ACCEPTANCE = [
  "# Queue - Status",
  "",
  "## Tracking info",
  "",
  "- **Workflow steps completed:** create, analyze, implement",
  "",
  "---",
  "",
  phaseSection(TDD_PHASE, [TDD_OPEN_ROW]),
  phaseSection(ACCEPTANCE_PHASE, [ACCEPTANCE_OPEN_ROW]),
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

// --- spec 291: an open `aide/<folder>` branch, for the Checks section's -----
// --- branch-aware read and write --------------------------------------------

/** Where one of a spec's own files sits, relative to the toplevel this
 *  fixture's `rev-parse --show-toplevel` answers with (`dir/root`) —
 *  what `resolveOpenBranchTarget` computes in real code via
 *  `path.relative`. Kept in one place because both the fixture below
 *  and any test asserting on the exact plumbing calls need the same
 *  string. */
export const relFilePath = (file: string, folder = SPEC) => `aide/specs/${folder}/${file}`;

/** `4-status.md`'s own path — the one file this fixture wrote for
 *  before spec 310 generalized Save to all four. Kept as its own name
 *  since most callers here are still about the tick route's one file. */
export const relStatusPath = (folder = SPEC) => relFilePath("4-status.md", folder);

const PAD = (sha: string) => sha.padEnd(40, "0");
export const BRANCH_TIP_SHA = PAD("branchtip");
export const BRANCH_FILE_SHA = PAD("branchfile");

/** A `GitRunner` that answers every question `savable`'s does, PLUS the
 *  branch-open question `resolveOpenBranchTarget` asks and the
 *  read/write plumbing `readStatusFromBranch`/`writeStatusToBranch`
 *  use — all intercepted BEFORE `savable`'s own generic `"log -1
 *  --format="` entry can swallow them (that prefix matches a branch
 *  read's own `log` call too, since it is a longer instance of the same
 *  command).
 *
 *  Takes no directory of its own: it is built and handed to
 *  `harness.start()` before the harness's temp directory even exists,
 *  so the one call that DOES need a real filesystem path —
 *  `"rev-parse --show-toplevel"` — computes it from whichever spec
 *  folder the caller under test passed as `dir` (always
 *  `<tmp>/root/aide/specs/<folder>`, three segments below the
 *  toplevel), rather than from a value this fixture would have had to
 *  know in advance. Every other call this fixture does not special-case
 *  falls through to `savable`'s own fixed placeholder, exactly as
 *  today's tests already tolerate (`specsRoot()`'s return value is a
 *  merge-lock KEY everywhere except this feature's own new code). */
export function branchAwareGitRunner(
  opts: {
    /** `false` models REQ-2: no open branch, the disk read/write is untouched. */
    open?: boolean;
    /** Which spec file this branch-aware read/write is about. Defaults
     *  to `4-status.md`, this fixture's original and still most common
     *  use; spec 310 generalized the write side to any of the four
     *  files, and a save-route test for one of the others passes its
     *  own here. */
    file?: string;
    /** The branch's own file content (REQ-1's whole point). */
    branchText?: string;
    /** The last commit that touched the file ON THE BRANCH — what a
     *  branch-aware page's `baseSha` names, and what a tick's
     *  `statusBaseSha` has to match for the write to go through. */
    branchFileSha?: string;
    /** The branch's own HEAD, used to build the new commit on a write.
     *  Defaults to `branchFileSha` — the ordinary case where the last
     *  commit on the branch is also the one that touched the file. */
    branchTipSha?: string;
    folder?: string;
    /** REQ-4b: the push is rejected — a headless run raced this write. */
    pushFails?: boolean;
    extra?: Record<string, { code: number; stdout?: string }>;
  } = {},
): { run: GitRunner; calls: { args: string[]; env?: Record<string, string> }[] } {
  const folder = opts.folder ?? SPEC;
  const branch = specBranch(folder);
  const relPath = relFilePath(opts.file ?? "4-status.md", folder);
  const ref = `refs/remotes/origin/${branch}`;
  const fileSha = opts.branchFileSha ?? BRANCH_FILE_SHA;
  const tipSha = opts.branchTipSha ?? opts.branchFileSha ?? BRANCH_TIP_SHA;
  const base = savable("unused-root", opts.extra);
  const specFolderSuffix = join("aide", "specs", folder);
  const calls: { args: string[]; env?: Record<string, string> }[] = [];
  const run: GitRunner = async (d, args, timeoutMs, env) => {
    calls.push({ args, env });
    const line = args.join(" ");
    if (line === "rev-parse --show-toplevel" && d.endsWith(specFolderSuffix)) {
      return { code: 0, stdout: `${d.slice(0, d.length - specFolderSuffix.length - 1)}\n` };
    }
    if (line.startsWith("ls-remote --heads origin refs/heads/aide/*")) {
      return { code: 0, stdout: opts.open === false ? "" : `${tipSha}\trefs/heads/${branch}\n` };
    }
    if (line === `rev-parse ${ref}`) return { code: 0, stdout: `${tipSha}\n` };
    if (line === `rev-parse ${tipSha}^{tree}`) return { code: 0, stdout: `${PAD("tiptree")}\n` };
    if (line === `log -1 --format=%H ${ref} -- ${relPath}`) return { code: 0, stdout: `${fileSha}\n` };
    if (line === `show ${ref}:${relPath}`) return { code: 0, stdout: opts.branchText ?? "" };
    if (line.startsWith("hash-object -w")) return { code: 0, stdout: `${PAD("newblob")}\n` };
    if (line === `read-tree ${PAD("tiptree")}`) return { code: 0, stdout: "" };
    if (line.startsWith("update-index --cacheinfo")) return { code: 0, stdout: "" };
    if (line === "write-tree") return { code: 0, stdout: `${PAD("newtree")}\n` };
    if (line.startsWith("commit-tree")) return { code: 0, stdout: `${PAD("newcommit")}\n` };
    if (line.startsWith("push")) {
      if (line.includes(`refs/heads/${branch}`)) return { code: opts.pushFails ? 1 : 0, stdout: "" };
      return base(d, args, timeoutMs, env);
    }
    return base(d, args, timeoutMs, env);
  };
  return { run, calls };
}
