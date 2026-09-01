import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type ArchivedSpecView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";


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
    const before = renderQueueRows([createJob("111-x")], opts, Date.parse("2026-08-19T12:00:00Z"));
    expect(before).toContain('data-folder="111-x"');
    const after = renderQueueRows([createJob("111-x")], { ...opts, archived: ["aide/111-x"] }, Date.parse("2026-08-19T12:00:00Z"));
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
    renderQueueRows(
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
    expect(html).not.toContain("last run reported done, but the files disagree");
  });

  // The other half of the same fixture: without the archive fact, the
  // row is still there AND still says the files disagree. That is what
  // the assertions above are pinned against — remove the archive entry
  // and both of them fire.
  test("the same spec unarchived keeps its row, contradiction and all", () => {
    const html = opened("129-x", []);
    expect(html).toContain('data-folder="129-x"');
    expect(html).toContain("last run reported done, but the files disagree");
  });
});

// Spec 193, criteria 5 and 6: the one exception to "archived beats
// every other reason to keep a group visible".
//
// Being archived answers "did this spec finish" with certainty only
// while nothing of the spec is still open. Three specs were archived
// with their code sitting on a branch and every row saying done, so the
// certainty was misplaced — and the filter is the branch, not the job's
// `errorReason`: 146 carried no reason at all, and a stale reason on an
// old job would resurrect a row for a spec that is genuinely finished.
describe("an archived spec whose branch is still on origin (spec 193)", () => {
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

  // Spec 221 moved WHERE that answer is drawn without changing what it
  // answers. The row used to be this failed job's own, kept alive by an
  // exception inside `groupBySpec` — which meant an archived spec's row
  // carried a Run, model selects and tick boxes the server would have
  // refused. Every archived spec has a reader row now, and spec 193's
  // fact rides on it as a mark.
  const listed = (notLanded: boolean) =>
    renderQueueRows(
      [failedArchive("191-x")],
      {
        runnerAvailable: true,
        targets: [],
        archived: ["aide/191-x"],
        archivedSpecs: [
          {
            project: "aide",
            folder: "191-x",
            archivedAt: "2026-08-22",
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

  test("keeps its row, and the row says the branch is still open", () => {
    const html = listed(true);
    expect(html).toContain('data-folder="191-x"');
    expect(html).toContain("not landed");
    expect(html).toContain("its branch is still on origin — re-run archive");
  });

  test("and the one whose branch is gone gets the row without the mark", () => {
    const html = listed(false);
    expect(html).toContain('data-folder="191-x"');
    expect(html).not.toContain("not landed");
  });

  // The failed archive job does NOT get a row of its own beside it: one
  // spec is one line, and an archived spec's line is the reader row.
  test("the failed archive job adds no second row", () => {
    expect(listed(true).match(/<tr class="spechead/g)).toHaveLength(1);
  });

  // Spec 275, criteria 4-5: the State cell used to say the bare word
  // "archived" for BOTH answers, so a reader saw "archived" in that
  // column and "not landed" in the red pill beside the name — two words
  // that read as a contradiction, on the same row, regardless of which
  // one was actually stale. The State cell now echoes the same fact the
  // mark carries, in words, rather than leaving the mark to stand alone
  // against an unqualified "archived".
  test("the State cell echoes the mark instead of contradicting it (criterion 4)", () => {
    expect(listed(true)).toContain('<span class="badge b-done">archived, not landed</span>');
  });

  test("and reverts to the bare word once the branch is gone (criterion 5)", () => {
    const html = listed(false);
    expect(html).toContain('<span class="badge b-done">archived</span>');
    expect(html).not.toContain("archived, not landed");
  });
});

// Spec 221: an archived spec is a row on the spec list, and the list
// grew a chip axis and a search field to hold it. The route-level half
// is `archived-specs.test.ts`; this is the renderer on its own, where a
// fixture can say things a real archive on disk cannot — an archived
// spec and a live one whose folder numbers interleave, a search term
// that matches only one of them.
describe("spec 221: archived specs on the spec list", () => {
  const archivedSpec = (
    folder: string,
    over: Partial<ArchivedSpecView> = {},
  ): ArchivedSpecView => ({
    project: "aide",
    folder,
    title: `Title of ${folder}`,
    description: `What ${folder} was about.`,
    archivedAt: "2026-08-13",
    // Spec 317: a real default so tests that do not care about Created
    // are not surprised by the archive-date tests' own "date unknown"/
    // "checking" text turning up in a second, unrelated cell.
    createdAt: "2026-08-01T09:00:00Z",
    // What the spec's own 4-status.md claims it has had (spec 224) —
    // the whole workflow, which is what an archived spec normally says.
    done: ["create", "analyze", "implement", "archive"],
    // Compile-time default only (spec 244) — no fixture here records a
    // model; the route-level suite (`archived-specs.test.ts`) covers the
    // parse-through-render path.
    models: {},
    // Compile-time default only (spec 247), same terms as `models` above.
    phaseOutcomes: {},
    ...over,
  });

  const live = (specFolder: string): QueueTarget => ({ project: "aide", specFolder });

  const rows = (opts: Partial<QueuePageOptions> = {}): string =>
    renderQueueRows([], { runnerAvailable: true, targets: [], ...opts });

  const folders = (html: string): string[] =>
    [...html.matchAll(/href="\/specs\/[A-Za-z0-9._-]+\/([A-Za-z0-9._-]+)"/g)].map((m) => m[1]!);

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
    // The server gates the data too (criterion 10), but the renderer
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

  // Pinned to the "spec" sort explicitly (spec 317 changed which sort
  // is the default) — the property under test is that live and
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
    for (const state of ["active", "done", "problem"]) {
      const html = rows({
        archivedSpecs: [archivedSpec("50-archived")],
        targets: [live("60-live")],
        filter: { state },
      });
      expect(folders(html)).not.toContain("50-archived");
    }
  });

  test("an archived row draws no control the server would refuse", () => {
    const html = rows({ archivedSpecs: [archivedSpec("50-archived")], filter: { state: "archived" } });
    expect(html).toContain("Reopen");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('class="rowrun"');
  });

  test("and carries the not-landed mark when its branch is still open", () => {
    const html = rows({
      archivedSpecs: [archivedSpec("50-archived", { notLanded: true })],
      filter: { state: "archived" },
    });
    expect(html).toContain("not landed");
  });

  test("a date nobody could find is said in words, not left blank", () => {
    const html = rows({
      archivedSpecs: [archivedSpec("50-archived", { archivedAt: null })],
      filter: { state: "archived" },
    });
    expect(html).toContain("date unknown");
  });

  test("and one nobody has asked git about yet says it is checking", () => {
    const html = rows({
      archivedSpecs: [archivedSpec("50-archived", { archivedAt: null, dateChecking: true })],
      filter: { state: "archived" },
    });
    expect(html).not.toContain("date unknown");
    expect(html.toLowerCase()).toContain("checking");
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
    // the list's own default now (spec 317): Created, newest first —
    // the archived fixture's own `createdAt` default is a real date,
    // the live target's is not, so the archived row sorts first.
    expect(seen("  ")).toEqual(["50-archived", "60-live"]);
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
