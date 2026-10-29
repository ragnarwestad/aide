import { describe, expect, test } from "bun:test";
import {
  renderSpecsRows,
  type ArchivedSpecView,
  type SpecsPageOptions,
  type QueueRowView,
  type SpecTarget,
} from "../../../../../src/render";
import {
  ARCHIVED_OPEN_STATE,
  ARCHIVED_STATE,
  groupBySpec,
} from "../../../../../src/render/pages/specs-list/data-model";
import { archivedRowNotices } from "../../../../../src/render/pages/specs-list/row-marks.ts";
import { t } from "../../../../../src/i18n";
import { row } from "../../fixtures.ts";

// The row's own message panel, where the row's errors move to.
const noticeCellHtml = (html: string, folder: string): string =>
  html.match(new RegExp(`<tr class="specnotice"[^>]*data-folder="${folder}">[\\s\\S]*?</tr>`))?.[0] ?? "";

// The create exception ends where the archive begins: a create job keeps
// its group on the page while its spec has not landed, but once the
// folder is in archive/ that same exception kept a ghost row with
// nonsense statuses — seen with 111 and 112 on 2026-08-19.
describe("an archived spec's create job is not a row", () => {
  const createJob = (folder: string): QueueRowView => ({
    id: "c1",
    project: "aide",
    specFolder: folder,
    steps: ["create"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-19T10:00:00Z",
  });
  test("visible while unlanded, gone once archived", () => {
    const opts = { runnerAvailable: true, targets: [{ project: "aide", specFolder: "90-other" }] };
    const before = renderSpecsRows([createJob("111-x")], opts, Date.parse("2026-08-19T12:00:00Z"));
    expect(before).toContain('data-folder="111-x"');
    const after = renderSpecsRows([createJob("111-x")], { ...opts, archived: ["aide/111-x"] }, Date.parse("2026-08-19T12:00:00Z"));
    expect(after).not.toContain('data-folder="111-x"');
  });
});

// Being archived is the proof the phases ran, so an archived spec's row
// has nothing left to argue about — including when the job that made it
// is not a `create`. The check above lived on the create branch alone,
// and a project with no OTHER live target reached the group through the
// "we are not entitled to judge this project" branch instead: every
// phase read "not run yet" under a job reporting done, which the row
// then worded as "the files disagree". Seen on 129 the day it was
// archived (2026-08-20).
describe("an archived spec's non-create job is not a row either", () => {
  const analyzeJob = (folder: string): QueueRowView => ({
    id: "a1",
    project: "aide",
    specFolder: folder,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-19T10:00:00Z",
  });
  // Opened, because the qualifier the bug produces only renders on the
  // phase lines behind the fold — a shut row shows the pips and nothing
  // else, so a closed-row assertion on that sentence would pass either
  // way and prove nothing.
  const opened = (folder: string, archived: string[]) =>
    renderSpecsRows(
      [analyzeJob(folder)],
      {
        runnerAvailable: true,
        targets: [],
        archived,
        filter: { open: `aide/${folder}` },
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );

  test("even when its project has no other live target", () => {
    const html = opened("129-x", ["aide/129-x"]);
    expect(html).not.toContain('data-folder="129-x"');
    expect(html).not.toContain("last run reported done");
  });

  // The other half of the same fixture: without the archive fact, the
  // row is still there AND still says the files disagree — read, since
  // as "nothing reached the files" (no target here carries a
  // `historyDone` commit signal for "analyze"). That is what the
  // assertions above are pinned against — remove the archive entry and
  // both of them fire.
  test("the same spec unarchived keeps its row, contradiction and all", () => {
    const html = opened("129-x", []);
    expect(html).toContain('data-folder="129-x"');
    expect(html).toContain("last run reported done, but nothing reached the files — run it again");
  });
});

// The one exception to "archived beats
// every other reason to keep a group visible".
//
// Being archived answers "did this spec finish" with certainty only
// while nothing of the spec is still open. Three specs were archived
// with their code sitting on a branch and every row saying done, so the
// certainty was misplaced — and the filter is the branch, not the job's
// `errorReason`: 146 carried no reason at all, and a stale reason on an
// old job would resurrect a row for a spec that is genuinely finished.
describe("an archived spec whose branch is still on origin", () => {
  const failedArchive = (folder: string): QueueRowView => ({
    id: "z1",
    project: "aide",
    specFolder: folder,
    steps: ["archive"],
    stepIndex: 0,
    state: "failed",
    error: "aide/191-x is still on origin in /repos/aide",
    errorReason: "unlanded",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-22T10:00:00Z",
  });

  // WHERE that answer is drawn does not change what it
  // answers. The row used to be this failed job's own, kept alive by an
  // exception inside `groupBySpec` — which meant an archived spec's row
  // carried a Run, model selects and tick boxes the server would have
  // refused. Every archived spec has a reader row now, and the not-landed
  // fact rides on it as a mark.
  const listed = (notLanded: boolean) =>
    renderSpecsRows(
      [failedArchive("191-x")],
      {
        runnerAvailable: true,
        targets: [],
        archived: ["aide/191-x"],
        archivedSpecs: [
          {
            project: "aide",
            folder: "191-x",
            notLanded,
            done: ["create", "analyze", "implement", "archive"],
            models: {},
            phaseOutcomes: {},
          },
        ],
        filter: { state: "archived" },
      },
      Date.parse("2026-08-23T12:00:00Z"),
    );

  test("keeps its row, and the notice line says the branch is still open", () => {
    const html = listed(true);
    expect(html).toContain('data-folder="191-x"');
    expect(noticeCellHtml(html, "191-x")).toContain("Its branch is still on origin — re-run archive");
  });

  test("and the one whose branch is gone gets the row without the mark", () => {
    const html = listed(false);
    expect(html).toContain('data-folder="191-x"');
    expect(html).not.toContain("still on origin — re-run archive");
  });

  // The failed archive job does NOT get a row of its own beside it: one
  // spec is one line, and an archived spec's line is the reader row.
  test("the failed archive job adds no second row", () => {
    expect(listed(true).match(/<tr class="spechead/g)).toHaveLength(1);
  });
});

// An archived spec is a row on the spec list, and the list
// grew a chip axis and a search field to hold it. The route-level half
// is `archived-specs.test.ts`; this is the renderer on its own, where a
// fixture can say things a real archive on disk cannot — an archived
// spec and a live one whose folder numbers interleave, a search term
// that matches only one of them.
describe("archived specs on the spec list", () => {
  const archivedSpec = (
    folder: string,
    over: Partial<ArchivedSpecView> = {},
  ): ArchivedSpecView => ({
    project: "aide",
    folder,
    title: `Title of ${folder}`,
    description: `What ${folder} was about.`,
    // A real default so tests that do not care about Created
    // are not surprised by the archive-date tests' own "date unknown"/
    // "checking" text turning up in a second, unrelated cell.
    createdAt: "2026-08-01T09:00:00Z",
    // What the spec's own 4-status.md claims it has had —
    // the whole workflow, which is what an archived spec normally says.
    done: ["create", "analyze", "implement", "archive"],
    // Compile-time default only — no fixture here records a
    // model; the route-level suite (`archived-specs.test.ts`) covers the
    // parse-through-render path.
    models: {},
    // Compile-time default only, same terms as `models` above.
    phaseOutcomes: {},
    ...over,
  });

  const live = (specFolder: string): SpecTarget => ({ project: "aide", specFolder });

  const rows = (opts: Partial<SpecsPageOptions> = {}): string =>
    renderSpecsRows([], { runnerAvailable: true, targets: [], ...opts });

  const folders = (html: string): string[] =>
    [...html.matchAll(/href="\/specs\/[A-Za-z0-9._-]+\/([A-Za-z0-9._-]+)(?:#[^"]*)?"/g)].map((m) => m[1]!);

  // All is the default now, and first in the panel with it — a spec that
  // reaches the archive stays on the list the reader is already looking
  // at instead of dropping off it.
  test("All is the default chip, and it comes first", () => {
    const html = rows({ archivedSpecs: [archivedSpec("50-archived")] });
    // Nothing is passed as the filter at all: this is the fallback every
    // reader with a bare `/` gets.
    expect(html).toMatch(/aria-checked="true"><span class="check" aria-hidden="true"><\/span>All/);
    expect(html.indexOf(">All")).toBeLessThan(html.indexOf(">Active"));
  });

  test("the default chip keeps an archived row on the list beside a live one", () => {
    const html = rows({ archivedSpecs: [archivedSpec("50-archived")], targets: [live("60-live")] });
    expect(folders(html).sort()).toEqual(["50-archived", "60-live"]);
  });

  test("the Active chip is what cuts an archived row now", () => {
    // The server gates the data too, but the renderer
    // must not depend on that: a row that reached it must still be cut
    // by the filter, or the two halves of one rule could disagree.
    const html = rows({
      archivedSpecs: [archivedSpec("50-archived")],
      targets: [live("60-live")],
      filter: { state: "not-archived" },
    });
    expect(folders(html)).toEqual(["60-live"]);
  });

  test("the Archived chip shows only archived rows", () => {
    const html = rows({
      archivedSpecs: [archivedSpec("50-archived")],
      targets: [live("60-live")],
      filter: { state: "archived" },
    });
    expect(folders(html)).toEqual(["50-archived"]);
  });

  // Pinned to the "spec" sort explicitly (so a change of the default sort
  // does not matter) — the property under test is that live and
  // archived rows interleave by ONE shared key, not which key that
  // happens to be by default.
  test("All interleaves the two kinds by one sort key", () => {
    const html = rows({
      archivedSpecs: [archivedSpec("70-archived"), archivedSpec("50-archived")],
      targets: [live("60-live")],
      filter: { state: "all", sort: "spec" },
    });
    expect(folders(html)).toEqual(["70-archived", "60-live", "50-archived"]);
  });

  test("the three older chips still exclude archived rows", () => {
    for (const state of ["active", "waiting", "failed"]) {
      const html = rows({
        archivedSpecs: [archivedSpec("50-archived")],
        targets: [live("60-live")],
        filter: { state },
      });
      expect(folders(html)).not.toContain("50-archived");
    }
  });

  test("an archived row draws no control the server would refuse", () => {
    const shut = rows({ archivedSpecs: [archivedSpec("50-archived")], filter: { state: "archived" } });
    expect(shut).not.toContain("<select");
    expect(shut).not.toContain('type="checkbox"');
    expect(shut).not.toContain('class="rowrun"');
    // A locked row's one action is Reopen, and it rides the caption
    // line the fold opens like every other row's (2026-09-08). The Run
    // form is still not there — Reopen carries its own.
    const open = rows({
      archivedSpecs: [archivedSpec("50-archived")],
      filter: { state: "archived", open: "aide/50-archived" },
    });
    expect(open).toContain("Reopen");
    expect(open).not.toContain("<select");
    expect(open).not.toContain('class="rowrun"');
  });

  const openFilter = { state: "archived", open: "aide/50-archived" };
  const dialogById = (html: string, id: string): string =>
    html.match(new RegExp(`<dialog[^>]*id="${id}"[^>]*>[\\s\\S]*?</dialog>`))?.[0] ?? "";
  /** What both of the list's Reopen dialogs carry: the post the page
   *  script sends, and goes on to the Running page from. */
  const expectListParts = (dialog: string): void => {
    const form = dialog.match(/<form\b[^>]*\saction="\/api\/queue"[^>]*>/);
    expect(form).not.toBeNull();
    expect(form![0]).toContain("data-progress");
  };

  test("an open archived row's Reopen names a dialog over the list", () => {
    const open = rows({ archivedSpecs: [archivedSpec("50-archived")], filter: openFilter });
    const id = open.match(/<button\b[^>]*\sdata-ask="([^"]+)"[^>]*>Reopen<\/button>/)?.[1];
    expect(id).toBeDefined();
    expectListParts(dialogById(open, id!));
  });

  test("a Failed criterion's Reopen in the unfolded checks names a dialog outside the panel's form", () => {
    const failed = { phase: "Acceptance criteria", task: "AC-1", line: "| AC-1 | ❌ Failed | |", note: "", done: false, failed: true };
    const waiting = { phase: "Acceptance criteria", task: "AC-2", line: "| AC-2 | Not verified | |", note: "", done: true, notVerified: true };
    const html = rows({
      archivedSpecs: [archivedSpec("50-archived", { failed: 1, notVerified: 1, acceptance: [failed, waiting] })],
      filter: { state: "archived", checks: "aide/50-archived" },
    });
    const panel = html.match(/<form\b[^>]*class="[^"]*\browchecks\b[\s\S]*?<\/form>/)?.[0] ?? "";
    const id = panel.match(/data-ask="([^"]+)"[^>]*>Reopen</)?.[1];
    expect(id).toBeDefined();
    expect(panel).not.toContain("<dialog");
    const dialog = dialogById(html, id!);
    expectListParts(dialog);
  });

  test("and carries the not-landed mark when its branch is still open", () => {
    const html = rows({
      archivedSpecs: [archivedSpec("50-archived", { notLanded: true })],
      filter: { state: "archived" },
    });
    expect(html).toContain("Its branch is still on origin — re-run archive");
  });

  // An archive whose code landing did not finish can leave the spec
  // archived with its code unlanded. The
  // queue refuses Reopen for it ("already active") and takes Archive, so
  // the row offers what the queue takes: Archive, with its model.
  test("whose code has not landed offers Archive, with the Archive line's model to pick, not Reopen", () => {
    const open = rows({
      archivedSpecs: [archivedSpec("50-archived", { notLanded: true })],
      filter: { state: "archived", open: "aide/50-archived" },
      modelChoices: [{ name: "claude opus", tool: "claude" }, { name: "codex gpt-6.1-sol", tool: "codex" }],
    });
    const form = open.match(/<form\b[^>]*\sid="rowrun-aide\/50-archived"[^>]*>[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toContain('action="/api/queue"');
    expect(form).toContain('name="steps" value="archive"');
    expect(form).toContain(">Archive</button>");
    expect(form).not.toContain("<select");
    // The Archive line's own selects, named after that form and open to a pick.
    const archiveModel = open.match(/<select name="model\.archive"[^>]*>/)?.[0] ?? "";
    expect(archiveModel).toContain('form="rowrun-aide/50-archived"');
    expect(archiveModel).not.toContain("disabled");
    // Every other line stays a record.
    expect(open.match(/<select name="model\.implement"[^>]*>/)?.[0]).toContain("disabled");
    expect(open).not.toContain(">Reopen</button>");
  });

  // 659 on 2026-10-22: the row ignored the archive running on it, and
  // said Archived, offered Archive and asked for a re-run while it ran.
  test("whose archive is running reads as running, offers Cancel and asks for no re-run", () => {
    const running = row({
      id: "j-659", specFolder: "50-archived", steps: ["archive"], stepIndex: 0, state: "running",
    });
    const open = renderSpecsRows([running], {
      runnerAvailable: true, targets: [],
      archivedSpecs: [archivedSpec("50-archived", { notLanded: true })],
      filter: { state: "archived", open: "aide/50-archived" },
    });
    expect(open).toContain(">Cancel</button>");
    expect(open).not.toContain(">Archive</button>");
    expect(open).not.toContain(">Archived<");
    expect(open).not.toContain("re-run archive");
  });

  test("whose branch is open for review keeps Reopen", () => {
    const open = rows({
      archivedSpecs: [archivedSpec("50-archived", { prOpen: true, prUrl: "https://github.test/aide/pull/9" })],
      filter: { state: "archived", open: "aide/50-archived" },
    });
    expect(open).toContain(">Reopen</button>");
    expect(open).not.toContain('name="steps" value="archive"');
  });

  // `archive.prOpen` had no coverage anywhere —
  // and no State-column mark at all, since `g.state` reads `notLanded`
  // alone (spec-views.ts) and `prOpen` is mutually exclusive with it.
  // The State column now shows a `pull request` badge for this fact,
  // same as it does for a live row's own `prUrl`.
  test("and carries the pull-request mark when its branch is open for review", () => {
    const html = rows({
      archivedSpecs: [
        archivedSpec("50-archived", { prOpen: true, prUrl: "https://github.test/aide/pull/9" }),
      ],
      filter: { state: "archived" },
    });
    expect(html.toLowerCase()).toContain("pull request");
    expect(html).toContain('href="https://github.test/aide/pull/9"');
    expect(html).not.toContain("not landed");
  });

  // `gh` could not open one — the archived counterpart
  // to a live row's `prError`, unlinked, said in the notice line the
  // same way `pullRequestMark`'s hover title used to say it.
  test("says a pull request could not be opened when the branch is open with no URL", () => {
    const html = rows({
      archivedSpecs: [archivedSpec("50-archived", { prOpen: true })],
      filter: { state: "archived" },
    });
    const notice = noticeCellHtml(html, "50-archived");
    expect(notice).toContain("no pull request was opened for it");
    expect(notice).not.toContain("<a href=");
  });

  test("the search reads folder, title and description, across both kinds", () => {
    const both = {
      archivedSpecs: [archivedSpec("50-archived", { title: "Wolverine", description: "gone" })],
      targets: [live("60-live")],
    };
    const seen = (q: string) => folders(rows({ ...both, filter: { state: "all", q } }));
    expect(seen("wolverine")).toEqual(["50-archived"]);
    expect(seen("60-live")).toEqual(["60-live"]);
    expect(seen("gone")).toEqual(["50-archived"]);
    // Whitespace is not a term: it must not empty the list. Order is
    // the list's own default: Created, newest first — the
    // archived fixture's own `createdAt` default is a real date, the
    // live target's is not, and a spec git has not dated sorts as the
    // newest, so the live row sorts first.
    expect(seen("  ")).toEqual(["60-live", "50-archived"]);
  });

  test("the chips count the archived specs the page did not build", () => {
    // The route hands the KEYS whatever the filter is (they are what
    // `groupBySpec` drops job rows by) and the ROWS only when the filter
    // shows them — so a chip that would show archived rows counts the
    // keys rather than reading "0" off a set nobody built.
    const html = rows({ targets: [live("60-live")], archived: ["aide/50-archived", "aide/40-archived"] });
    expect(html).toMatch(/>Archived \(2\)</);
    expect(html).toMatch(/>All \(3\)</);
    expect(html).toMatch(/>Active \(1\)</);
  });

  test("and never twice, once those rows are actually on the page", () => {
    const html = rows({
      targets: [live("60-live")],
      archived: ["aide/50-archived"],
      archivedSpecs: [archivedSpec("50-archived")],
      filter: { state: "all" },
    });
    expect(html).toMatch(/>Archived \(1\)</);
    expect(html).toMatch(/>All \(2\)</);
  });
});

// A create cancelled before it made a folder is not a row — also on a
// project whose every spec is archived. The "not entitled to judge this
// project" branch used to fire on such a project, since it looked at
// active specs alone, and the cancelled create stood on the list with
// an Analyze button for a spec that does not exist (2026-09-15).
describe("a cancelled create is not a row on a project with only archived specs", () => {
  const cancelledCreate: QueueRowView = {
    id: "c9",
    project: "aide",
    specFolder: "new-8638781b",
    steps: ["create"],
    stepIndex: 0,
    state: "cancelled",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-09-15T08:11:00Z",
  };
  test("with the project's specs listed as archived", () => {
    const html = renderSpecsRows([cancelledCreate], { runnerAvailable: true, targets: [], archived: ["aide/466-x"] }, Date.parse("2026-09-15T10:00:00Z"));
    expect(html).not.toContain('data-folder="new-8638781b"');
  });
  test("with the project's specs given as archived views", () => {
    const archivedSpec: ArchivedSpecView = { project: "aide", folder: "466-x", done: ["create"], models: {}, phaseOutcomes: {} };
    const html = renderSpecsRows([cancelledCreate], { runnerAvailable: true, targets: [], archivedSpecs: [archivedSpec] }, Date.parse("2026-09-15T10:00:00Z"));
    expect(html).not.toContain('data-folder="new-8638781b"');
  });
});

// A locked row (archived or closed) reads truth from its own
// files, never from a job the queue happens to still remember
// (`readerGroup`'s own comment, group-builders.ts) — except the notice
// panel's `phaseDisagreement`, which read a locked row's queue-remembered
// `attempts` (added for the duration/cost cells) the same way
// it reads a live row's, and so warned about a re-run that happened
// before the spec was locked and is no longer actionable.
describe("an archived spec's row does not warn about an earlier cancelled re-run", () => {
  const BUILT = ["create", "analyze", "implement", "archive"];

  // The queue's own memory of a re-run attempted after the spec was
  // archived — `implement` done in the files, but the most recent
  // attempt the queue remembers for it did not end in "done".
  const cancelledRerun: QueueRowView = {
    id: "r1",
    project: "aide",
    specFolder: "480-locked",
    steps: ["implement"],
    stepIndex: 0,
    state: "cancelled",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-09-16T10:00:00Z",
  };

  const archivedSpec = (over: Partial<ArchivedSpecView> = {}): ArchivedSpecView => ({
    project: "aide",
    folder: "480-locked",
    done: BUILT,
    models: {},
    phaseOutcomes: {},
    ...over,
  });

  test("an archived row shows no last-re-run qualifier", () => {
    const html = renderSpecsRows(
      [cancelledRerun],
      { runnerAvailable: true, targets: [], archivedSpecs: [archivedSpec()], filter: { state: "archived" } },
      Date.parse("2026-09-17T12:00:00Z"),
    );
    expect(noticeCellHtml(html, "480-locked")).not.toContain("last re-run");
  });

  test("a closed row shows the same absence", () => {
    const html = renderSpecsRows(
      [cancelledRerun],
      { runnerAvailable: true, targets: [], archivedSpecs: [archivedSpec({ closed: true })], filter: { state: "all" } },
      Date.parse("2026-09-17T12:00:00Z"),
    );
    expect(noticeCellHtml(html, "480-locked")).not.toContain("last re-run");
  });

  test("the identical shape on an active row still shows the qualifier", () => {
    const html = renderSpecsRows(
      [cancelledRerun],
      { runnerAvailable: true, targets: [{ project: "aide", specFolder: "480-locked", done: BUILT }] },
      Date.parse("2026-09-17T12:00:00Z"),
    );
    expect(noticeCellHtml(html, "480-locked")).toContain("last re-run");
  });
});

// A spec whose branch merged but could not be deleted on origin has
// landed: it is archived, and only a cleanup is left. A spec whose open
// branch never merged still reads "not landed".
describe("an archived spec whose merged branch is still on origin", () => {
  const NOW = Date.parse("2026-09-29T12:00:00Z");
  const spec = (over: Partial<ArchivedSpecView>): ArchivedSpecView => ({
    project: "aide",
    folder: "570-x",
    done: ["create", "analyze", "implement", "archive"],
    models: {},
    phaseOutcomes: {},
    ...over,
  });
  const listed = (s: ArchivedSpecView, state: string): string =>
    renderSpecsRows([], { runnerAvailable: true, targets: [], archivedSpecs: [s], filter: { state } }, NOW);
  const DELETE_ACTION = 'action="/api/queue/specs/aide/570-x/delete-branch"';

  test("is archived, and the Active and Failed chips cut it", () => {
    const left = spec({ branchLeftBehind: true });
    expect(groupBySpec([], [], undefined, [left], NOW)[0]?.state).toBe(ARCHIVED_STATE);
    expect(listed(left, "not-archived")).not.toContain('data-folder="570-x"');
    expect(listed(left, "failed")).not.toContain('data-folder="570-x"');
    expect(listed(left, "archived")).toContain('data-folder="570-x"');
  });

  test("its note says the branch is still on origin, on a line of its own, and offers Delete branch", () => {
    expect(archivedRowNotices(spec({ branchLeftBehind: true }), NOW, "en")).toEqual([
      { variant: "waiting", text: t("en", "list.branchStillOnOrigin"), own: true, kind: "branch-left-behind" },
    ]);
    expect(noticeCellHtml(listed(spec({ branchLeftBehind: true }), "archived"), "570-x")).toContain(DELETE_ACTION);
  });

  test("a branch that never merged keeps the re-run-archive note, and no Delete branch", () => {
    const open = spec({ notLanded: true, notLandedCheckedAt: NOW });
    expect(groupBySpec([], [], undefined, [open], NOW)[0]?.state).toBe(ARCHIVED_OPEN_STATE);
    const html = listed(open, "not-archived");
    expect(noticeCellHtml(html, "570-x")).toContain("Its branch is still on origin — re-run archive");
    expect(html).not.toContain(DELETE_ACTION);
  });

  test("a closed row whose delete failed keeps its by-hand sentence, and no Delete branch", () => {
    const closed = spec({
      closed: true,
      notLanded: true,
      branchDeleteError: { key: "landing.branchDeleteFailed", values: {} } as never,
    });
    expect(archivedRowNotices(closed, NOW, "en")).toEqual([{ variant: "failed", text: t("en", "list.branchLeftBehind") }]);
    expect(listed(closed, "all")).not.toContain(DELETE_ACTION);
  });
});

// A spec whose latest analysis was short says so on its row, archived or not:
// the row is built from the analyze phase's own record.
describe("an archived spec whose analysis was short", () => {
  const NOW = Date.parse("2026-10-19T12:00:00Z");
  const spec = (analysis: "short" | "full" | undefined): ArchivedSpecView => ({
    project: "aide",
    folder: "650-x",
    done: ["create", "analyze", "implement", "archive"],
    models: {},
    phaseOutcomes: { analyze: { result: "completed", ...(analysis ? { analysis } : {}) } },
  });
  const noticed = (s: ArchivedSpecView): string =>
    noticeCellHtml(renderSpecsRows([], { runnerAvailable: true, targets: [], archivedSpecs: [s], filter: { state: "archived" } }, NOW), "650-x");

  test("the row carries the short-analysis line, and a full or unmarked one does not", () => {
    expect(noticed(spec("short"))).toContain("Short analysis: no plan and no plan review");
    expect(noticed(spec("full"))).not.toContain("Short analysis");
    expect(noticed(spec(undefined))).not.toContain("Short analysis");
  });
});

// A spec sent back to a full analysis says so, and why, on its row, archived or
// not: the row is built from the create phase's own record, the description.
describe("an archived spec that was sent back to a full analysis", () => {
  const NOW = Date.parse("2026-10-19T12:00:00Z");
  const spec = (sentBack: string | undefined): ArchivedSpecView => ({
    project: "aide",
    folder: "651-x",
    done: ["create", "analyze", "implement", "archive"],
    models: {},
    phaseOutcomes: { create: { result: "completed", ...(sentBack ? { sentBack } : {}) } },
  });
  const noticed = (s: ArchivedSpecView): string =>
    noticeCellHtml(renderSpecsRows([], { runnerAvailable: true, targets: [], archivedSpecs: [s], filter: { state: "archived" } }, NOW), "651-x");

  test("the row carries the sent-back line with the sentence, and an unmarked one does not", () => {
    expect(noticed(spec("it needs nine files"))).toContain("Sent back to a full analysis: it needs nine files");
    expect(noticed(spec(undefined))).not.toContain("Sent back to a full analysis");
  });

  test("the sentence is HTML-escaped, since the session wrote it", () => {
    const html = noticed(spec("<script>alert(1)</script> & more"));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
  });
});
