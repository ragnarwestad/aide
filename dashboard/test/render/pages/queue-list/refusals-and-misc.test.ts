import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueuePage,
  renderQueueRows,
  type ArchivedSpecView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";
import { NAV, detail, row } from "../fixtures.ts";

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
describe("every action form carries the current view (criterion 7)", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: QueueTarget[], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  /** The Run form and Cancel are on the line an open row reveals under
   *  its header (spec 109). */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";

  const FILTER = { state: "all", project: "aide", sort: "spec", dir: "desc", open: "aide/99-x" };

  test("the Run form sends every filter key (criterion 7)", () => {
    const line = runLine(rows([], [target("99-x")], { filter: FILTER }), "99-x");
    for (const [key, value] of Object.entries(FILTER)) {
      expect(line).toContain(`<input type="hidden" name="view.${key}" value="${value}">`);
    }
  });

  // `project` is the collision: the Run form already posts a field of
  // that name to say WHICH spec to run, and two of them arrive as a
  // list that the enqueue refuses as "invalid project".
  test("the view's project never collides with the Run form's own (criterion 7)", () => {
    const line = runLine(rows([], [target("99-x")], { filter: FILTER }), "99-x");
    expect(line).toContain(`<input type="hidden" name="project" value="aide">`);
    expect([...line.matchAll(/name="project"/g)]).toHaveLength(1);
  });

  // Nothing is sent that the view does not hold: the row is open, so
  // the Run form is there to carry the fields, and the only key set is
  // the only key posted.
  test("a key the view does not hold is not sent (criterion 7)", () => {
    const line = runLine(rows([], [target("99-x")], { filter: { open: "aide/99-x" } }), "99-x");
    expect(line).toContain('<input type="hidden" name="view.open" value="aide/99-x">');
    for (const key of ["state", "project", "sort", "dir"]) {
      expect(line).not.toContain(`name="view.${key}"`);
    }
  });

  test("the Cancel form sends them too (criterion 7)", () => {
    const running = row({ id: "j1", specFolder: "99-x", state: "running" });
    // Cancel belongs to the open row — a collapsed one offers Approve
    // or Merge and nothing else (spec 103) — and since spec 109 that
    // means the line the open row reveals, not the header's own cell.
    const line = runLine(
      rows([running], [target("99-x")], { filter: { state: "active", open: "aide/99-x" } }),
      "99-x",
    );
    const form = line.match(/<form method="post" action="\/api\/queue\/j1\/cancel"[^>]*>.*?<\/form>/)![0];
    expect(form).toContain('<input type="hidden" name="view.state" value="active">');
  });

});

// The page lists up to 25 rows, so a refusal shown once at the top of
// the page does not say WHICH row it is about.
describe("a refusal is shown on the row it belongs to (criteria 8, 12)", () => {
  const target = (specFolder: string): QueueTarget => ({ project: "aide", specFolder });

  const rows = (targets: QueueTarget[], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      [],
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  /** The row's head AND the message panel under it. Spec 151 moved the
   *  refusal out of the name cell and into that panel, so a matcher
   *  that stopped at the first `</tr>` would no longer see the text
   *  this block is about. */
  const head = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";

  test("the named spec's row carries the reason, and no other row does (criterion 8)", () => {
    const html = rows([target("99-x"), target("99-y")], {
      error: "the tree is dirty in /repos/aide",
      errorSpec: "aide/99-x",
    });
    expect(head(html, "99-x")).toContain("the tree is dirty in /repos/aide");
    expect(head(html, "99-y")).not.toContain("the tree is dirty");
  });

  test("an errorSpec naming another project leaves the row alone (criterion 8)", () => {
    const html = rows([target("99-x")], { error: "refused", errorSpec: "paceup/99-x" });
    expect(head(html, "99-x")).not.toContain("refused");
  });

  test("the page-top banner is not shown as well when a row has it (criterion 12)", () => {
    const page = renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [target("99-x")],
      error: "the tree is dirty in /repos/aide",
      errorSpec: "aide/99-x",
    });
    expect(page).not.toContain('<p class="refusal">');
    // …and the reason is still on the page, on its row.
    expect(page).toContain("the tree is dirty in /repos/aide");
  });

  test("a refusal that belongs to no row keeps the banner (criterion 12)", () => {
    const page = renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [target("99-x")],
      error: "payload too large",
    });
    expect(page).toContain('<p class="refusal rowmsg failed">');
    expect(page).toContain("payload too large");
  });
});

// Spec 100 made the spec list the front page and dropped the nav's own
// "Specs" entry; spec 119 brought it back as one of the two tabs, at
// `/` — the front page still, and still what the wordmark points at.
// The old /specs address is linked from nowhere either way.
describe("spec 119: the list page's own tab", () => {
  test("renderQueuePage marks Specs current, points it at /, and keeps the wordmark home", () => {
    const html = renderQueuePage(
      [],
      "2026-08-18T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: true, targets: [] },
    );
    const navHtml = html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
    expect(navHtml).toContain('<a class="tab" data-nav data-goto href="/" aria-current="page">Specs</a>');
    expect(html).not.toContain('href="/specs"');
    expect(html).toContain('<a class="brand" href="/">');
    // The Projects tab points wherever the caller's first entry does —
    // the served route in production, this stand-in here.
    expect(navHtml).toContain('href="projects.html"');
  });
});

describe("an unmeasured cost is marked where it is totalled", () => {
  const marker = '<span class="muted small">est.</span>';

  test("the job page's overview total is marked when a summed step was over-charged", () => {
    const html = renderJobDetailPage(
      detail({
        steps: ["implement"],
        stepIndex: 0,
        state: "stopped",
        stopReason: "timeout",
        spentUsd: 35,
        results: [
          {
            step: "implement", ok: false, costUsd: 35, costMeasured: false,
            terminalReason: "timeout", at: "2026-08-21T07:58:00Z",
          },
        ],
      }),
      "2026-08-21T08:00:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("Cost so far");
    expect(html).toContain(marker);
  });

  test("a job whose every step was measured carries no marker on its total", () => {
    const html = renderJobDetailPage(
      detail({
        state: "done",
        spentUsd: 0.42,
        results: [
          {
            step: "analyze", ok: true, costUsd: 0.42, costMeasured: true,
            terminalReason: "completed", at: "2026-08-21T10:01:00Z",
          },
        ],
      }),
      "2026-08-21T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("Cost so far");
    expect(html).not.toContain(marker);
  });

  // The row's own cell is a roll-up across every job the spec has had,
  // which is the "41.13 USD for 149" figure the incident was about.
  const spentRow = (extra: Partial<QueueRowView>): QueueRowView =>
    row({ state: "done", ...extra });

  test("the spec row's total is marked when any job under it was over-charged", () => {
    const html = renderQueueRows(
      [
        spentRow({
          id: "j1", steps: ["analyze"], spentUsd: 6.13,
          results: [{ step: "analyze", ok: true, costUsd: 6.13, costMeasured: true }],
        }),
        spentRow({
          id: "j2", steps: ["implement"], state: "stopped", stopReason: "timeout", spentUsd: 35,
          results: [{ step: "implement", ok: false, costUsd: 35, costMeasured: false }],
        }),
      ],
      { runnerAvailable: true, targets: [] },
      Date.parse("2026-08-21T12:00:00Z"),
    );
    expect(html).toContain("$41.13");
    expect(html).toContain(marker);
  });

  test("a spec whose every step was measured renders no marker", () => {
    const html = renderQueueRows(
      [
        spentRow({
          id: "j1", steps: ["analyze"], spentUsd: 6.13,
          results: [{ step: "analyze", ok: true, costUsd: 6.13, costMeasured: true }],
        }),
      ],
      { runnerAvailable: true, targets: [] },
      Date.parse("2026-08-21T12:00:00Z"),
    );
    expect(html).toContain("$6.13");
    expect(html).not.toContain(marker);
  });

  // The phase lines answer for their OWN attempt, so the marker has to
  // be decided per line rather than inherited from the row above them.
  test("an expanded phase line marks its own attempt, and a measured one beside it does not", () => {
    const rows = [
      spentRow({
        id: "j1", steps: ["analyze"], spentUsd: 6.13,
        results: [{ step: "analyze", ok: true, costUsd: 6.13, costMeasured: true }],
      }),
      spentRow({
        id: "j2", steps: ["implement"], state: "stopped", stopReason: "timeout", spentUsd: 35,
        results: [{ step: "implement", ok: false, costUsd: 35, costMeasured: false }],
      }),
    ];
    const html = renderQueueRows(
      rows,
      { runnerAvailable: true, targets: [], filter: { open: "aide/81-queue-and-runner" } },
      Date.parse("2026-08-21T12:00:00Z"),
    );
    const implementLine = html.slice(html.indexOf('data-step="implement"'));
    const analyzeLine = html.slice(html.indexOf('data-step="analyze"'), html.indexOf('data-step="implement"'));
    expect(implementLine.slice(0, implementLine.indexOf("</tr>"))).toContain(marker);
    expect(analyzeLine).toContain("$6.13");
    expect(analyzeLine).not.toContain(marker);
  });
});

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

  // Spec 335, REQ-2: the link used to sit beside the name; it is read
  // from the State column now, same as every other status the row has.
  test("the link is in the State column, beside the running/resting word", () => {
    const html = open({ prUrl: "https://github.test/aide/pull/7" });
    expect(specCell(html, FOLDER)).not.toContain("pull/7");
    const state = stateCellHtml(html, FOLDER);
    expect(state).toContain('href="https://github.test/aide/pull/7"');
    expect(state.toLowerCase()).toContain("pull request");
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
});

// --- a held-back job waits in amber, never in red --------------------------
//
// Every reason the scheduler leaves a job queued starts "held back:", and
// each is ordinary progress (a dependency, a missing analyze, another
// archive landing, an acceptance row for a person to tick). They take
// the amber "archive held back" already takes, not the red of a refusal.
describe("a job the scheduler is holding is a warning, not an error", () => {
  const FOLDER = "81-queue-and-runner";
  const notice = (error: string, errorReason?: "conflict" | "held-back" | "tests-red" | "unlanded") =>
    noticeCellHtml(
      renderQueueRows([row({ state: "queued", error, errorReason })], { runnerAvailable: true, targets: [] }),
      FOLDER,
    );

  test("every held-back reason is drawn amber", () => {
    for (const reason of [
      "held back: another archive is running in this project — it starts when that one has landed",
      "held back: depends on 80-dependency, which is not archived yet",
      "held back: not analyzed yet — run /aide-analyze first",
      "held back: the Acceptance criteria are not all ticked yet — tick them on the Checks tab",
    ]) {
      const html = notice(reason, "held-back");
      expect(html).toContain(reason);
      expect(html).toMatch(/class="[^"]*rowmsg waiting/);
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
