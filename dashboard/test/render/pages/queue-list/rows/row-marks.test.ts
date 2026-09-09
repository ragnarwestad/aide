// The marks a row can carry beside its state: a pull request, a job the
// scheduler is holding, a landing that failed, a push that never reached
// origin — and what happens when a row has more than one.
//
// Split out of refusals-and-misc.test.ts 2026-09-04 (642 lines); the
// tests are unchanged and keep their names.

import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type ArchivedSpecView,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import { row } from "../../fixtures.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../../../src/project/parse-status.ts";

// Split out of grouping.test.ts by theme.

// One row, as its head cells: the Spec `<td colspan="2">` and the State
// `<td>` right after it. Spec 335 moved every status mark off the first
// and onto the second, so a test asserting which one carries a mark has
// to see the two apart rather than treating the row as one blob of text.
const rowBlock = (html: string, folder: string): string =>
  html.match(
    new RegExp(
      `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
        `(?=<tr class="[^"]*spechead|</tbody>|$)`,
    ),
  )?.[0] ?? "";

const specCell = (html: string, folder: string): string =>
  rowBlock(html, folder).match(/<td colspan="2">[\s\S]*?<\/td>/)?.[0] ?? "";

const stateCellHtml = (html: string, folder: string): string => {
  const block = rowBlock(html, folder);
  const start = block.indexOf('<td colspan="2">');
  const specEnd = start + (block.slice(start).match(/<td colspan="2">[\s\S]*?<\/td>/)?.[0].length ?? 0);
  return block.slice(specEnd).match(/<td>[\s\S]*?<\/td>/)?.[0] ?? "";
};

// The row's own message panel (spec 143), where REQ-2's errors move to.
const noticeCellHtml = (html: string, folder: string): string =>
  html.match(new RegExp(`<tr class="specnotice"[^>]*data-folder="${folder}">[\\s\\S]*?</tr>`))?.[0] ?? "";

// Spec 99: the view survives an action, and a refusal finds its row ------

// Pressing Run, Approve, Cancel or Merge used to drop the reader back
// on the default view: the redirect after the POST can only carry
// forward what the POST itself received, and none of the three forms
// sent anything about the current filter.

// --- spec 220: the pull request a run left open ------------------------------
//
// A project that reviews its code archives with the code still on its
// branch, and a pull request describing it. The row is where a reader
// finds out — the same line that carries the compare links — and a `gh`
// that could not open the request has to say so there too, or an
// orphaned open branch looks exactly like a reviewed one.
describe("a row shows the pull request its run opened (spec 220)", () => {
  const FOLDER = "81-queue-and-runner";
  const open = (extra: Partial<QueueRowView>): string =>
    renderQueueRows([row({ steps: ["archive"], state: "done", ...extra })], {
      runnerAvailable: true,
      targets: [],
    });

  // Spec 403, REQ-1/REQ-2: reverses spec 335's own placement — the link
  // used to sit in the State column; a pull request being open is a fact
  // about the work, not a second state the row is IN, so it moves to the
  // notice line, where every other such fact already lives.
  test("the link is in the notice line, never in the State column", () => {
    const html = open({ prUrl: "https://github.test/aide/pull/7" });
    expect(specCell(html, FOLDER)).not.toContain("pull/7");
    const state = stateCellHtml(html, FOLDER);
    expect(state).not.toContain("pull/7");
    expect(state.toLowerCase()).not.toContain("pull request");
    const notice = noticeCellHtml(html, FOLDER);
    expect(notice).toContain('href="https://github.test/aide/pull/7"');
    expect(notice.toLowerCase()).toContain("pull request");
  });

  // REQ-3: the fact must not be hidden by the "nothing to say while
  // running" branch that blanks an otherwise-empty notice line.
  test("a running row with a pull request open still shows the notice sentence", () => {
    const html = renderQueueRows([row({ steps: ["archive"], state: "running", prUrl: "https://github.test/aide/pull/7" })], {
      runnerAvailable: true,
      targets: [],
    });
    expect(noticeCellHtml(html, FOLDER)).toContain('href="https://github.test/aide/pull/7"');
  });

  // REQ-2: the link must survive being joined with another mark's
  // sentence on the same line, not only when it is the sole mark.
  test("the pull-request link keeps its own href when joined with another mark", () => {
    const html = open({
      pushError: "cannot push aide/81-queue-and-runner: non-fast-forward",
      prUrl: "https://github.test/aide/pull/7",
    });
    const notice = noticeCellHtml(html, FOLDER);
    expect(notice).toContain(
      "A step's push did not reach origin. — Pull the branch in the checkout on the serving host, then push it again from a terminal.",
    );
    expect(notice).toContain('href="https://github.test/aide/pull/7"');
  });

  // REQ-6: the column reads the same with or without a pull request
  // open, across more than one state.
  test.each(["running", "done"] as const)("REQ-6: the State cell is identical with and without prUrl (%s)", (state) => {
    const withPr = renderQueueRows([row({ steps: ["archive"], state, prUrl: "https://github.test/aide/pull/7" })], {
      runnerAvailable: true,
      targets: [],
    });
    const withoutPr = renderQueueRows([row({ steps: ["archive"], state })], {
      runnerAvailable: true,
      targets: [],
    });
    expect(stateCellHtml(withPr, FOLDER)).toBe(stateCellHtml(withoutPr, FOLDER));
  });

  // Spec 339, REQ-2: `prError` is one of the three real ERRORS, not the
  // "pull request" state — it moves to the notice line, distinct from
  // the badge test above, which stays put.
  test("a gh that could not open one says so instead, in a sentence for a person", () => {
    const RAW = "gh auth login required";
    const html = open({ prError: RAW });
    const state = stateCellHtml(html, FOLDER);
    expect(state).not.toContain(RAW);
    expect(state).not.toContain("No pull request could be opened for this branch. — Open one by hand, in the checkout on the serving host.");
    expect(state).not.toContain("pull/7");
    expect(noticeCellHtml(html, FOLDER)).toContain(
      "No pull request could be opened for this branch. — Open one by hand, in the checkout on the serving host.",
    );
  });

  // REQ-3, acceptance criterion 4: the one `prError` case that carries
  // raw `gh pr create` stderr never reaches the row either.
  test("gh's own stderr, on the one case that carries it, never reaches the row", () => {
    const RAW = "error connecting to api.github.com  check your internet connection or https status.github.com";
    const html = open({ prError: RAW });
    expect(html).not.toContain(RAW);
    expect(noticeCellHtml(html, FOLDER)).toContain(
      "No pull request could be opened for this branch. — Open one by hand, in the checkout on the serving host.",
    );
  });

  test("a row with neither is the row it has always been", () => {
    const html = open({});
    expect(html.toLowerCase()).not.toContain("pull request");
  });

  // REQ-5 (spec 411): every row-notice link opens in a new tab now, the
  // pull-request link included.
  test("REQ-5: the pull-request link opens in a new tab", () => {
    const html = open({ prUrl: "https://github.test/aide/pull/7" });
    const notice = noticeCellHtml(html, FOLDER);
    expect(notice).toContain('href="https://github.test/aide/pull/7" target="_blank" rel="noopener"');
  });
});

// --- spec 411: a spec held for Checks links to a board on its branch --------
//
// The machinery to run a board off a spec's own branch already exists;
// nothing on the row offered it. Gives the held-for-Checks message the
// same shape the pull-request mark already has: a sentence that carries
// a link.
describe("a spec held for Checks carries a link to a board on its branch (spec 411)", () => {
  const FOLDER = "101-b";
  const target = (extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder: FOLDER,
    ...extra,
  });
  const heldForChecks = (targetExtra: Partial<QueueTarget> = {}) =>
    renderQueueRows([row({ specFolder: FOLDER, steps: ["archive"], state: "done" })], {
      runnerAvailable: true,
      targets: [target({ done: ["implement"], archiveHeldBack: { reason: ACCEPTANCE_CRITERIA_UNTICKED_NOTE }, ...targetExtra })],
    });

  // REQ-1: the exact sentence, carrying the link.
  test("REQ-1: the sentence, with a link, is in the notice line", () => {
    const notice = noticeCellHtml(heldForChecks(), FOLDER);
    expect(notice).toContain("Click the link to start a test server running this branch");
    expect(notice).toContain(`href="/specs/aide/${FOLDER}?tab=steps&amp;startBoard=1"`);
  });

  // REQ-2: the link opens in a new tab and carries the start trigger.
  test("REQ-2: the link opens in a new tab", () => {
    const notice = noticeCellHtml(heldForChecks(), FOLDER);
    expect(notice).toMatch(
      new RegExp(`href="/specs/aide/${FOLDER}\\?tab=steps&amp;startBoard=1" target="_blank" rel="noopener"`),
    );
  });

  // The queue holds a job for this exact reason with a message of its
  // own, and the notice line draws that above these marks. Both said it
  // until 2026-09-08 — twice on one line, and the mark's half in
  // English on a Norwegian board, because the file's note is a fixed
  // constant where the runner's message is translated.
  test("the file's note is not repeated when the queue is already saying it", () => {
    const notice = noticeCellHtml(
      renderQueueRows(
        [
          row({
            specFolder: FOLDER,
            steps: ["archive"],
            state: "queued",
            errorReason: "held-back",
            error: { key: "runner.acceptanceCriteriaUnticked" },
          }),
        ],
        {
          runnerAvailable: true,
          targets: [
            target({
              done: ["implement"],
              archiveHeldBack: { reason: ACCEPTANCE_CRITERIA_UNTICKED_NOTE },
            }),
          ],
        },
      ),
      FOLDER,
    );
    // The queue's sentence, once.
    expect(notice.match(/Acceptance criteria are not all ticked yet/g)).toHaveLength(1);
    // Said once. The queue's own sentence opens "archive held back:"
    // now, so the file's note being absent is a COUNT, not the absence
    // of those words.
    expect(notice.match(/held back/g)).toHaveLength(1);
    // And the link is untouched: it is a different fact.
    expect(notice).toContain("Click the link to start a test server running this branch");
  });

  // REQ-6: every other held-back reason carries no link.
  test("REQ-6: a row held back for a different reason carries no link", () => {
    const notice = noticeCellHtml(
      renderQueueRows([row({ specFolder: FOLDER, steps: ["archive"], state: "done" })], {
        runnerAvailable: true,
        targets: [target({ archiveHeldBack: { reason: "the Slack webhook" } })],
      }),
      FOLDER,
    );
    expect(notice).not.toContain("Click the link to start a test server");
    expect(notice).not.toContain("startBoard=1");
  });

  // REQ-6: a row not held back at all carries no link either.
  test("REQ-6: a row not held back at all carries no link", () => {
    const notice = noticeCellHtml(
      renderQueueRows([row({ specFolder: FOLDER, state: "done" })], { runnerAvailable: true, targets: [] }),
      FOLDER,
    );
    expect(notice).not.toContain("startBoard=1");
  });
});

// --- a held-back job is info when it resolves on its own, waiting when it needs a person (spec 389) --
//
// Every reason the scheduler leaves a job queued starts "held back:", but
// they are not all the same: three resolve on their own (another landing
// or archive finishing, a dependency being archived) and take the info
// kind; three wait on a person (not analyzed, acceptance rows unticked,
// the daily cap) and keep the amber "archive held back" warning triangle.
describe("a job the scheduler is holding is info when it resolves on its own, waiting when a person must act", () => {
  const FOLDER = "81-queue-and-runner";
  const notice = (error: QueueRowView["error"], errorReason?: "conflict" | "held-back" | "tests-red" | "unlanded") =>
    noticeCellHtml(
      renderQueueRows([row({ state: "queued", error, errorReason })], { runnerAvailable: true, targets: [] }),
      FOLDER,
    );

  test("a held-back reason that resolves on its own is drawn info, not waiting or failed", () => {
    for (const key of ["runner.landingPause", "runner.archiveRunning", "runner.dependencyNotArchived"] as const) {
      const html = notice({ key }, "held-back");
      expect(html).toMatch(/class="[^"]*rowmsg info/);
      expect(html).not.toMatch(/class="[^"]*rowmsg waiting/);
      expect(html).not.toMatch(/class="[^"]*rowmsg failed/);
    }
  });

  test("a held-back reason that waits on a person is drawn waiting, not info or failed", () => {
    for (const key of ["runner.notAnalyzed", "runner.acceptanceCriteriaUnticked", "runner.dailyCapExceeded"] as const) {
      const html = notice({ key }, "held-back");
      expect(html).toMatch(/class="[^"]*rowmsg waiting/);
      expect(html).not.toMatch(/class="[^"]*rowmsg info/);
      expect(html).not.toMatch(/class="[^"]*rowmsg failed/);
    }
  });

  test("a refusal stays red", () => {
    const html = notice("cannot fast-forward main — merge it by hand, in the checkout on the serving host");
    expect(html).toMatch(/class="[^"]*rowmsg failed/);
  });
});

// --- spec 327: a landing failure survives its job's later steps ------------
//
// The mark is read straight off `lead.landingError` and drawn
// independent of `state` — a later step's own state says nothing about
// whether an EARLIER step's landing ever finished.
describe("a row shows an unresolved landing failure (spec 327)", () => {
  const FOLDER = "81-queue-and-runner";
  const MESSAGE = "analyze landing failed: cannot merge aide/81-queue-and-runner in /repos/aide-specs";
  const withFailure = (state: QueueRowView["state"]): string =>
    renderQueueRows([row({ state, landingError: MESSAGE })], { runnerAvailable: true, targets: [] });

  // Spec 339, REQ-2: `landingError` is already human prose (nothing for
  // REQ-3 to clean up here), so it moves to the notice line and nothing
  // else — the State column keeps only the running/resting word.
  test("the mark is in the notice line while a later step is still running", () => {
    const html = withFailure("running");
    expect(specCell(html, FOLDER)).not.toContain(MESSAGE);
    expect(stateCellHtml(html, FOLDER)).not.toContain(MESSAGE);
    expect(noticeCellHtml(html, FOLDER)).toContain(MESSAGE);
  });

  test("the mark still shows once the job is done", () => {
    const html = withFailure("done");
    expect(stateCellHtml(html, FOLDER)).not.toContain(MESSAGE);
    expect(noticeCellHtml(html, FOLDER)).toContain(MESSAGE);
  });

  // The one landing failure that is not a refusal: the merge was built,
  // the project's own suite went red on it, and nothing was pushed. The
  // row says "tests red" in amber — a red mark here reads as a broken
  // machine when the answer is to run implement again.
  test("a landing the suite refused is amber and says so", () => {
    const RED =
      "archive landing stopped: the project's tests are red on this merge, so nothing was pushed. " +
      "The gate log names the failing test; archive lands the work once it passes.";
    const html = renderQueueRows(
      [row({ state: "stopped", stopReason: "tests-red", landingError: RED, errorReason: "tests-red" })],
      { runnerAvailable: true, targets: [] },
    );
    const notice = noticeCellHtml(html, FOLDER);
    expect(notice).toContain(RED);
    expect(notice).toMatch(/class="[^"]*rowmsg waiting/);
    expect(notice).not.toMatch(/class="[^"]*rowmsg failed/);
  });

  test("any other landing failure stays red", () => {
    const html = renderQueueRows([row({ state: "done", landingError: MESSAGE, errorReason: "conflict" })], {
      runnerAvailable: true,
      targets: [],
    });
    expect(noticeCellHtml(html, FOLDER)).toMatch(/class="[^"]*rowmsg failed/);
  });

  // A failed landing writes the same sentence as the job's `error` and,
  // step-prefixed, as its `landingError`; the notice line said both,
  // 300 characters twice with " · archive landing failed:" between.
  test("the job's own error is not repeated when the landing mark already carries it", () => {
    const REASON = "cannot fast-forward main — merge it by hand, in the checkout on the serving host";
    const html = renderQueueRows(
      [row({ state: "failed", error: REASON, landingError: `archive landing failed: ${REASON}` })],
      { runnerAvailable: true, targets: [] },
    );
    const notice = noticeCellHtml(html, FOLDER);
    expect(notice.split(REASON).length - 1).toBe(1);
    expect(notice).toContain(`archive landing failed: ${REASON}`);
  });

  test("a row with no landing failure carries no mark", () => {
    const html = renderQueueRows([row({ state: "done" })], { runnerAvailable: true, targets: [] });
    expect(html).not.toContain("landing failed");
  });
});

// --- spec 328: a push that never reached origin ------------------------------
//
// `aide-run-spec` never fails a run over a push that could not land —
// the step's own work is already committed, so it reports `completed`
// regardless. `pushError` is the field that says the branch itself did
// not make it, and REQ-3 is that the row shows it rather than leaving a
// reader to find out two steps later, the way spec 327 did.
describe("a row shows a push that never reached origin (spec 328)", () => {
  const FOLDER = "81-queue-and-runner";
  const MESSAGE = "cannot push aide/81-queue-and-runner in /repos/aide: non-fast-forward";

  // Spec 339, REQ-2/REQ-3: the failure is in the notice line now, and
  // `pushError`'s own raw stderr never reaches the row at all — a fixed
  // sentence for a person takes its place. The State column keeps only
  // the running/resting word.
  test("the failure is in the notice line, as a sentence for a person", () => {
    const html = renderQueueRows([row({ pushError: MESSAGE })], { runnerAvailable: true, targets: [] });
    expect(specCell(html, FOLDER)).not.toContain(MESSAGE);
    const state = stateCellHtml(html, FOLDER);
    expect(state).not.toContain(MESSAGE);
    expect(state).not.toContain("not pushed");
    expect(noticeCellHtml(html, FOLDER)).toContain(
      "A step's push did not reach origin. — Pull the branch in the checkout on the serving host, then push it again from a terminal.",
    );
  });

  // REQ-3, acceptance criterion 4: the description's own headline
  // example — git's `hint:` lines and its `'git push --help'` pointer,
  // flattened onto one line upstream — never reaches the row.
  test("git's own stderr, hint lines included, never reaches the row", () => {
    const RAW =
      "cannot push aide/333-x in /repos/aide/specs:  behind hint: its remote counterpart. " +
      "hint: use 'git pull' before pushing again. " +
      "hint: See the 'Note about fast-forwards' in 'git push --help' for details.";
    const html = renderQueueRows([row({ pushError: RAW })], { runnerAvailable: true, targets: [] });
    expect(html).not.toContain("hint:");
    expect(html).not.toContain("git push --help");
    expect(noticeCellHtml(html, FOLDER)).toContain(
      "A step's push did not reach origin. — Pull the branch in the checkout on the serving host, then push it again from a terminal.",
    );
  });

  test("a row with no push failure carries no mark", () => {
    const html = renderQueueRows([row({})], { runnerAvailable: true, targets: [] });
    expect(html).not.toContain(MESSAGE);
    expect(html).not.toContain("not pushed");
  });
});

// --- spec 341/352: a stale pushError does not outlive its own job ----------
//
// `recent.find((r) => r.pushError)` (group-builders.ts) used to scan every
// job for the spec, newest first, and stop at the first one with a
// `pushError` set — which is not necessarily the LEAD job. A spec whose
// current (lead) job pushed fine still showed an older job's failure,
// with advice that no longer applied (REQ-4).
describe("a stale pushError clears once the spec's lead job has none (spec 341, REQ-4)", () => {
  const FOLDER = "81-queue-and-runner";

  test("an older job's pushError does not outlive it once a newer job pushes fine", () => {
    const html = renderQueueRows(
      [
        row({
          id: "older",
          specFolder: FOLDER,
          state: "done",
          createdAt: "2026-08-16T09:00:00Z",
          pushError: "cannot push aide/81-queue-and-runner: non-fast-forward",
        }),
        row({ id: "newer", specFolder: FOLDER, state: "done", createdAt: "2026-08-16T11:00:00Z" }),
      ],
      { runnerAvailable: true, targets: [] },
    );
    expect(noticeCellHtml(html, FOLDER)).not.toContain(
      "A step's push did not reach origin. — Pull the branch in the checkout on the serving host, then push it again from a terminal.",
    );
  });

  test("the lead job's own pushError still shows", () => {
    const html = renderQueueRows(
      [
        row({ id: "older", specFolder: FOLDER, state: "done", createdAt: "2026-08-16T09:00:00Z" }),
        row({
          id: "newer",
          specFolder: FOLDER,
          state: "done",
          createdAt: "2026-08-16T11:00:00Z",
          pushError: "cannot push aide/81-queue-and-runner: non-fast-forward",
        }),
      ],
      { runnerAvailable: true, targets: [] },
    );
    expect(noticeCellHtml(html, FOLDER)).toContain(
      "A step's push did not reach origin. — Pull the branch in the checkout on the serving host, then push it again from a terminal.",
    );
  });
});

// --- spec 339: more than one error mark on the same live row --------------
//
// `pushError`, `landingError` and `prError` are independent booleans and
// can all be true on the same row at once. REQ-4 asks for every
// applicable sentence, ranked, visible on the notice line — no badge, no
// hover, since the State column carries no error marks any more.
describe("more than one error mark, ranked, both visible in the notice line (REQ-4)", () => {
  const FOLDER = "81-queue-and-runner";

  test("both sentences show, in the same order liveMarks ranks them", () => {
    const LANDING = "analyze landing failed: cannot merge aide/81-queue-and-runner in /repos/aide-specs";
    const PUSH_SENTENCE = "A step's push did not reach origin. — Pull the branch in the checkout on the serving host, then push it again from a terminal.";
    const html = renderQueueRows(
      [row({ pushError: "cannot push aide/81-queue-and-runner: non-fast-forward", landingError: LANDING })],
      { runnerAvailable: true, targets: [] },
    );
    const state = stateCellHtml(html, FOLDER);
    expect(state).not.toContain("not pushed");
    expect(state).not.toContain("landing failed");
    const notice = noticeCellHtml(html, FOLDER);
    expect(notice).toContain(PUSH_SENTENCE);
    expect(notice).toContain(LANDING);
    expect(notice.indexOf(PUSH_SENTENCE)).toBeLessThan(notice.indexOf(LANDING));
  });
});

// --- spec 335: no status mark ever renders beside the name ------------------
describe("no status mark renders inside the Spec cell (REQ-1, REQ-7)", () => {
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

  const fixtures: Array<[string, string, string]> = [
    ["pushError", "70-a", live("70-a", { pushError: "cannot push aide/70-a: non-fast-forward" })],
    ["landingError", "70-b", live("70-b", { landingError: "analyze landing failed: cannot merge aide/70-b" })],
    ["prError", "70-c", live("70-c", { prError: "gh auth login required" })],
    ["prUrl", "70-d", live("70-d", { prUrl: "https://github.test/aide/pull/1" })],
    ["archive.prOpen", "70-e", archived("70-e", { prOpen: true, prUrl: "https://github.test/aide/pull/2" })],
    [
      "archive.branchDeleteError",
      "70-f",
      archived("70-f", {
        notLanded: true,
        branchDeleteError: "merged, but deleting aide/70-f on origin failed: remote rejected",
      }),
    ],
    ["archive.notLanded", "70-g", archived("70-g", { notLanded: true })],
    ["plain row", "70-h", live("70-h", {})],
  ];

  test.each(fixtures)("%s: the Spec cell carries no badge", (_name, folder, html) => {
    expect(specCell(html, folder)).not.toContain('class="badge');
  });
});
