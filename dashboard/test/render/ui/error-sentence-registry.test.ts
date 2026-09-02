import { describe, expect, test } from "bun:test";
import { invalidRequest } from "../../../src/queue/parse-request.ts";
import { renderQueueRows, type ArchivedSpecView, type QueueRowView } from "../../../src/render.ts";
import { notLandedTitle } from "../../../src/render/pages/queue-list/cell-helpers.ts";
import { wordPhase } from "../../../src/render/ui/job-state.ts";
import { row } from "../../render/pages/fixtures.ts";

/** One sentence the board can show, and the claim this registry makes
 *  about it: either `resolve` — a substring of `text` that names what
 *  fixes it — or `exempt` — the reason there is genuinely nothing to
 *  resolve. `text` is the producer's own current wording, copied
 *  verbatim (or, where the producer is a pure function, called
 *  directly) so a rewrite that drops the resolution phrase fails this
 *  test rather than only whichever page test happens to assert the old
 *  string. */
interface RegistryEntry {
  name: string;
  text: string;
  resolve?: string;
  exempt?: string;
}

// spec 352, REQ-7: "A test SHALL fail for an error sentence that
// carries no resolution, over the set of sentences the board can
// show." The fixture grows one phase at a time
// (3-solution.md, "Implementation plan") — Step 0 seeds it with the
// sentences already compliant before this spec (2-analysis.md,
// "producers that already do this right").
const REGISTRY: RegistryEntry[] = [
  {
    name: "the not-landed mark (cell-helpers.ts, notLandedTitle)",
    text: notLandedTitle(undefined, Date.now()),
    resolve: "re-run archive",
  },
  {
    name: "landing left a branch on origin (land-branch/merge.ts:249)",
    text: "aide/1-x is still on origin in /repos/aide — the spec was archived, but its work has not landed. Run archive again to land it.",
    resolve: "Run archive again to land it.",
  },
  {
    name: "held back: not analyzed yet (queue/runner.ts:139)",
    text: "held back: not analyzed yet — run /aide-analyze first",
    resolve: "run /aide-analyze first",
  },
  {
    name: "a spec's queue is already busy (queue/store.ts:135)",
    text: "(job abcd1234) — cancel that one first if you want to start over",
    resolve: "cancel that one first if you want to start over",
  },
  {
    name: "a stale spec edit (git/specs-pull.ts:216)",
    text: "4-status.md has changed since you opened it for editing — nothing was saved, open it again",
    resolve: "open it again",
  },
];

/** One spec's whole rendered block — head row, phase lines and notice
 *  line together — so a fixture entry can assert on whichever of those
 *  a producer's text actually reaches, without three different
 *  extractors to keep in sync. */
const rowBlock = (html: string, folder: string): string =>
  html.match(
    new RegExp(
      `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
        `(?=<tr class="[^"]*spechead|</tbody>|$)`,
    ),
  )?.[0] ?? "";

const live = (folder: string, extra: Partial<QueueRowView>): string =>
  renderQueueRows([row({ specFolder: folder, ...extra })], { runnerAvailable: true, targets: [] });

const archived = (folder: string, over: Partial<ArchivedSpecView>): string =>
  renderQueueRows([], {
    runnerAvailable: true,
    targets: [],
    archived: [`aide/${folder}`],
    archivedSpecs: [
      {
        project: "aide",
        folder,
        archivedAt: "2026-08-22",
        done: ["create", "analyze", "implement", "archive"],
        models: {},
        phaseOutcomes: {},
        ...over,
      },
    ],
    filter: { state: "archived" },
  });

// Phase 1 (pilot, 3-solution.md): the 5 marks in `cell-helpers.ts`, plus
// `word-phase.ts`'s `attemptQualifier()` unlanded case, unified with
// `notLandedTitle()`'s own "re-run archive" resolution. `errorReason:
// "unlanded"` is the SAME fact `notLandedTitle` describes, from a
// different attempt's own qualifier — the plan review flagged the two
// wording it two ways, and this entry is what makes them match.
//
// The "landing failed" mark (`g.landingError`, verbatim) is deliberately
// NOT registered yet: its wording comes entirely from the landing
// producers (`branch-merge.ts`'s `refuse()`, `merge.ts`) migrated in
// later phases, and REQ-7's own acceptance criterion is that an entry
// is added once it is actually fixed, not before.
const PHASE_1_PILOT: RegistryEntry[] = [
  {
    name: "not pushed (cell-helpers.ts, PUSH_ERROR_SENTENCE)",
    text: rowBlock(live("70-push", { pushError: "cannot push: non-fast-forward" }), "70-push"),
    resolve: "checkout on the serving host",
  },
  {
    name: "no pull request (cell-helpers.ts, PR_ERROR_SENTENCE)",
    text: rowBlock(live("70-pr", { prError: "gh auth login required" }), "70-pr"),
    resolve: "checkout on the serving host",
  },
  {
    name: "branch left behind (cell-helpers.ts, BRANCH_LEFT_BEHIND_SENTENCE)",
    text: rowBlock(
      archived("70-left", { notLanded: true, branchDeleteError: "remote rejected" }),
      "70-left",
    ),
    resolve: "checkout on the serving host",
  },
  {
    name: "archived, no pull request was opened (cell-helpers.ts, pullRequestMark)",
    text: rowBlock(archived("70-noPr", { prOpen: true }), "70-noPr"),
    resolve: "Open one by hand, in the checkout on the serving host.",
  },
  {
    name: "attemptQualifier's unlanded case (word-phase.ts)",
    text: wordPhase(true, undefined, row({ state: "failed", errorReason: "unlanded" }), {}).qualifier ?? "",
    resolve: "Re-run archive.",
  },
];

// Phase 2, batch 1 (3-solution.md): the "by hand, no location" group —
// `branch-merge.ts`'s four refusals, its `install.ts` sibling, and
// `specs-pull.ts`/`land-branch/steps.ts`'s refusals. These producers
// return plain strings from deep in a git call chain rather than
// calling `errorSentence()` directly (Approach A, `3-solution.md`), so
// each entry below is the producer's own current text, copied verbatim
// — the same thing a page test asserting on it would copy.
const PHASE_2_BATCH_1: RegistryEntry[] = [
  {
    name: "cannot fast-forward the base (branch-merge.ts refuse(), mergeBranchIntoDefault)",
    text: "cannot fast-forward master — merge it by hand, in the checkout on the serving host (aide/1-x in /repos/aide)",
    resolve: "checkout on the serving host",
  },
  {
    name: "a real merge conflicts (branch-merge.ts refuse(), mergeBranchIntoDefault)",
    text: "cannot merge into master — conflict, merge it by hand, in the checkout on the serving host (aide/1-x in /repos/aide)",
    resolve: "checkout on the serving host",
  },
  {
    name: "the deploy checkout is on the wrong branch (branch-merge.ts refuse(), fastForwardToOrigin)",
    text: "the checkout is on aide/1-x, not master — bring it there by hand first, in the checkout on the serving host (master in /repos/aide)",
    resolve: "checkout on the serving host",
  },
  {
    name: "the deploy checkout cannot fast-forward (branch-merge.ts refuse(), fastForwardToOrigin)",
    text: "cannot fast-forward it — bring it up to date by hand, in the checkout on the serving host (master in /repos/aide)",
    resolve: "checkout on the serving host",
  },
  {
    name: "no install command configured (land-branch/install.ts)",
    text: "merged, not installed — no install command configured. — Set the install command in the project's .aide/config to enable it.",
    resolve: "Set the install command in the project's .aide/config to enable it.",
  },
  {
    name: "a create job's branch never reached origin (land-branch/steps.ts, nothingToLand)",
    text:
      "the spec was created, but the run reported no pushed branch to land it from. — " +
      "Merge it by hand, in the checkout on the serving host, or check the queue's push mode.",
    resolve: "checkout on the serving host",
  },
  {
    name: "the specs checkout is not a git working tree (git/specs-pull.ts, pullFastForward)",
    text:
      "/specs is not a git working tree — nothing was pulled. — " +
      "Check the project's specs root is a git checkout, in the checkout on the serving host.",
    resolve: "checkout on the serving host",
  },
  {
    name: "the specs checkout has uncommitted changes (git/specs-pull.ts, pullFastForward)",
    text:
      "the specs checkout has uncommitted changes — nothing was pulled. — " +
      "Commit or discard them in the checkout on the serving host, then try again.",
    resolve: "checkout on the serving host",
  },
  {
    name: "the specs checkout has no default branch on origin (git/specs-pull.ts, pullFastForward)",
    text:
      "the specs checkout has no default branch on origin — nothing was pulled. — " +
      "Check the specs repo's default branch on origin, from the checkout in the checkout on the serving host.",
    resolve: "checkout on the serving host",
  },
  {
    name: "the specs checkout is on the wrong branch (git/specs-pull.ts, pullFastForward)",
    text:
      "the specs checkout is on aide/1-x, not main — nothing was pulled. — " +
      "Switch it to main in the checkout on the serving host, then try again.",
    resolve: "checkout on the serving host",
  },
  {
    name: "origin could not be reached (git/specs-pull.ts, pullFastForward)",
    text: "origin could not be reached — nothing was pulled. — Check the network from the serving host, then try again.",
    resolve: "the network from the serving host",
  },
  {
    name: "the specs checkout has diverged (git/specs-pull.ts, pullFastForward)",
    text:
      "the specs checkout has commits origin does not, so it cannot fast-forward — nothing was pulled. — " +
      "Merge it by hand, in the checkout on the serving host.",
    resolve: "checkout on the serving host",
  },
  {
    name: "the pull failed (git/specs-pull.ts, pullFastForward)",
    text: "the pull failed — nothing was pulled. — Try again; if it keeps failing, check it in the checkout on the serving host.",
    resolve: "checkout on the serving host",
  },
  {
    name: "a file could not be staged (git/specs-pull.ts, saveSpecFiles)",
    text:
      "1-description.md could not be staged — nothing was saved. — " +
      "Try again; if it keeps failing, check it in the checkout on the serving host.",
    resolve: "checkout on the serving host",
  },
  {
    name: "the commit failed (git/specs-pull.ts, saveSpecFiles)",
    text:
      "1-description.md could not be committed — nothing was saved. — " +
      "Try again; if it keeps failing, check it in the checkout on the serving host.",
    resolve: "checkout on the serving host",
  },
  {
    name: "committed but the push failed (git/specs-pull.ts, saveSpecFiles)",
    text:
      "1-description.md was committed but the push to origin failed — nothing was kept. — " +
      "Try again; if it keeps failing, check it in the checkout on the serving host.",
    resolve: "checkout on the serving host",
  },
];

// Phase 3, batch 2 (3-solution.md): the "no guidance at all" group —
// `runner.ts`'s cap/vanished/restarted sentences, `store.ts`'s
// landing-clash sentence, and the remaining `land-branch/steps.ts`
// `failedNote`s (which now embed a generic resolve alongside the raw
// `why` they still carry — REQ-5's move of that raw text into a hover
// `title` is Phase 4 work, tracked in `4-status.md`, not done here).
const PHASE_3_BATCH_2: RegistryEntry[] = [
  {
    name: "the job cap would be exceeded (queue/runner.ts, startOne)",
    text: "the job cap ($5) would be exceeded by the next step. — Raise the job cap in the project's .aide/config, then press Run again.",
    resolve: "Raise the job cap in the project's .aide/config, then press Run again.",
  },
  {
    name: "the daily cap would be exceeded (queue/runner.ts, startOne)",
    text: "held back: the daily cap ($50) would be exceeded. — Raise the daily cap in the project's .aide/config, or wait for it to reset tomorrow.",
    resolve: "Raise the daily cap in the project's .aide/config, or wait for it to reset tomorrow.",
  },
  {
    name: "the run vanished (queue/runner.ts, poll)",
    text: "the run vanished without leaving a result. — Press Run again.",
    resolve: "Press Run again.",
  },
  {
    name: "the server restarted mid-step (queue/runner.ts, reconcile)",
    text: "the server restarted while this step was running, and it left no result. — Press Run again.",
    resolve: "Press Run again.",
  },
  {
    name: "a spec's last step is still landing (queue/store.ts, insert)",
    text:
      "implement on 81-x cannot start while its last step is still landing (job abcd1234) — " +
      "press Run again in a moment, once the landing finishes",
    resolve: "press Run again",
  },
  {
    name: "a create job's landing threw (land-branch/steps.ts, landNewSpec)",
    text:
      "the spec was created, but landing it failed: git could not be run: ENOENT. — " +
      "Check the checkout on the serving host, then try running the step again.",
    resolve: "checkout on the serving host",
  },
  {
    name: "a step's landing threw (land-branch/steps.ts, landStepBranch)",
    text:
      "the analyze step finished, but landing it failed: git could not be run: ENOENT. — " +
      "Check the checkout on the serving host, then try running the step again.",
    resolve: "checkout on the serving host",
  },
  {
    name: "the shared invalidRequest() wrapper (queue/parse-request.ts) — covers every parse-request.ts and store.ts validation string structurally, the same guarantee a builder call site gets (Approach A, 3-solution.md)",
    text: invalidRequest("invalid project"),
    resolve: "Reload the page and try again",
  },
];

describe("every board-facing error sentence has a resolution or a named exemption (REQ-7)", () => {
  test.each(REGISTRY)("$name", ({ resolve, exempt, text }) => {
    expect(resolve || exempt).toBeTruthy();
    if (resolve) expect(text).toContain(resolve);
  });

  test.each(PHASE_1_PILOT)("$name", ({ resolve, exempt, text }) => {
    expect(resolve || exempt).toBeTruthy();
    if (resolve) expect(text).toContain(resolve);
  });

  test.each(PHASE_2_BATCH_1)("$name", ({ resolve, exempt, text }) => {
    expect(resolve || exempt).toBeTruthy();
    if (resolve) expect(text).toContain(resolve);
  });

  test.each(PHASE_3_BATCH_2)("$name", ({ resolve, exempt, text }) => {
    expect(resolve || exempt).toBeTruthy();
    if (resolve) expect(text).toContain(resolve);
  });
});
