import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueueRows,
  type JobDetailView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";
import {
  generatedAt,
  NAV,
  detail,
  row,
  openKeys,
} from "../fixtures.ts";

// --- spec 108: one rule for what a phase shows -------------------------------

// The row for spec 81 said three things at once: pips and phase lines
// read the JOB HISTORY (a July analysis re-run, cancelled, spoke for an
// analysis that was long since done and merged), the checkbox read the
// files unioned with that same history, and archive read "done" from a
// job that had finished without moving anything.
//
// One rule now, for every phase: the FILES say what has happened, the
// last attempt is a qualifier when it disagrees, and archive says "held
// back" with its reason when a run declined to move the folder.
describe("spec 108: one rule per phase", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-19T12:00:00Z"),
    );
  const head = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** The Run button's own line, under the header since spec 109. */
  /** Everything one row draws: its header line and, when it is open,
   *  the phase lines under it — where the boxes live since spec 124. */
  const runLine = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** The row's one panel (spec 143), which is where every sentence a
   *  phase used to write under its own badge is said instead (spec 195). */
  const panel = (html: string) => html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  // The pips carry the phase's own reader-facing name as their title,
  // which is how one is told from the next three.
  const pipFor = (html: string, label: string) =>
    head(html).match(new RegExp(`<span class="pip ([a-z]+)" title="${label}"`))?.[1] ?? "";
  // The two phases that CAN be true from the files, for a spec whose
  // only open question is archive.
  const BUILT = ["analyze", "implement"];

  test("a phase the files show done, with no job ever queued, reads done (criterion 1)", () => {
    const html = rows([], [target("108-hand-analysed", { done: ["analyze"] })]);
    expect(pipFor(html, "analyze")).toBe("past");
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain("b-done");
    expect(analyze).not.toContain("not run yet");
    expect(analyze).not.toContain("last re-run");
  });

  // Spec 168 gave `.pip.now` the only motion on the page, so what
  // decides whether a spec HAS a `now` pip is now load-bearing twice
  // over: draw one for a spec with nothing running and the closed row
  // says a phase is alive when none is.
  test("a spec with nothing running has no now pip at all", () => {
    const html = rows([], [target("108-hand-analysed", { done: ["analyze"] })]);
    expect(head(html)).toContain('class="pip ');
    expect(head(html)).not.toContain('class="pip now"');
  });

  test("a cancelled re-run never overturns a finished analysis (criterion 2)", () => {
    const html = rows(
      [row({ id: "recancelled", specFolder: "108-recancelled", steps: ["analyze"], state: "cancelled" })],
      [target("108-recancelled", { done: ["analyze"] })],
    );
    expect(pipFor(html, "analyze")).toBe("past");
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain("b-done");
    // Spec 195: the qualifier is a sentence, and a sentence under a
    // badge makes one phase line taller than the ones beside it. The
    // row's panel says it instead — named for the phase it is about.
    expect(analyze).not.toContain("last re-run cancelled");
    expect(panel(html)).toContain("analyze: last re-run cancelled");
  });

  // Criterion 3's "Run again" wording was retired 2026-08-19, and the
  // bare word "Run" with it (spec 157): the button is named for the
  // phase a press would run, which says what "again" was groping for
  // and cannot be wrong at the edges.
  test("with every phase but archive done the button is named for archive", () => {
    const html = rows([], [target("108-ready", { done: BUILT })]);
    expect(pipFor(html, "archive")).toBe("todo");
    expect(subRow(html, "archive")).toContain("not run yet");
    expect(runLine(html)).not.toContain("Run again");
    expect(runLine(html)).toContain(">Archive</button>");
  });

  test("an archive run that declined reads held back, not done (criterion 4)", () => {
    const html = rows(
      [row({ id: "declined", specFolder: "108-held", steps: ["archive"], state: "done" })],
      [
        target("108-held", {
          done: BUILT,
          archiveHeldBack: { reason: "the Slack webhook (Phase 4, still unchecked)" },
        }),
      ],
    );
    expect(pipFor(html, "archive")).toBe("todo");
    const archive = subRow(html, "archive");
    expect(archive).toContain("held back");
    // Spec 143: the REASON is the row's panel's, said once for the
    // whole row. The phase line keeps the word that is its own answer.
    expect(archive).not.toContain("the Slack webhook (Phase 4, still unchecked)");
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "the Slack webhook (Phase 4, still unchecked)",
    );
    // The one thing it must never read as, which is what it read as
    // before this spec: an ordinary finished step.
    expect(archive).not.toContain("b-done");
  });

  test("an archive run in flight outranks a stale held-back note (criterion 6)", () => {
    const html = rows(
      [row({ id: "retry", specFolder: "108-retry", steps: ["archive"], state: "running" })],
      [target("108-retry", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
    );
    expect(pipFor(html, "archive")).toBe("now");
    expect(subRow(html, "archive")).toContain("b-running");
  });

  test("a finished implement job is not done while the files disagree (criterion 8)", () => {
    const html = rows(
      [row({ id: "lagging", specFolder: "108-lagging", steps: ["implement"], state: "done" })],
      [target("108-lagging", { done: ["analyze"] })],
    );
    expect(pipFor(html, "implement")).toBe("todo");
    const implement = subRow(html, "implement");
    expect(implement).not.toContain("b-done");
    // Never silently hidden — and never on the line either, since spec
    // 195: the row's panel is where the sentence goes, named for the
    // phase it is about.
    expect(implement).not.toContain("the files disagree");
    expect(panel(html)).toContain("implement: last run reported done, but the files disagree");
  });

  test("the job page's Steps tab says held back where the row does (criterion 5)", () => {
    const archiveRun = (extra: Partial<JobDetailView> = {}): JobDetailView =>
      detail({
        id: "job-archive",
        steps: ["archive"],
        state: "done",
        results: [
          {
            step: "archive", ok: true, costUsd: 0.51, costMeasured: true,
            terminalReason: "completed", at: "2026-08-19T10:01:00Z",
          },
        ],
        ...extra,
      });
    const held = renderJobDetailPage(
      archiveRun({ archiveHeldBack: "the Slack webhook (Phase 4, still unchecked)" }),
      generatedAt,
      NAV,
      { tab: "steps" },
    );
    expect(held).toContain("held back — the Slack webhook (Phase 4, still unchecked)");
    expect(held).not.toContain("<td>ok</td>");

    // Without a reason the table is exactly what it always was.
    const plain = renderJobDetailPage(archiveRun(), generatedAt, NAV, { tab: "steps" });
    expect(plain).toContain("<td>ok</td>");
    expect(plain).not.toContain("held back");
  });
});
// --- spec 114: a spec with an unmerged dependency says so on the row ---------

// Spec 114 put a badge here — "after 106", one per dependency whose
// branch was still unmerged — so the row said what it was waiting on.
// Taken out again 2026-08-20: the title line already says "depends on
// <folder>" (spec 110) one cell to the left, and the two stood side by
// side saying nearly the same words about the same fact. The state cell
// is the sentence and nothing else again.
describe("a dependency is named once, on the title line, and not in the state cell", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(list, { runnerAvailable: true, targets }, Date.parse("2026-08-19T12:00:00Z"));
  const rowHtml = (html: string, folder: string) =>
    html.match(
      new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?</tr>`),
    )?.[0] ?? "";
  const hintCell = (html: string, folder: string) =>
    (rowHtml(html, folder).split("<td")[3] ?? "").match(
      /<div class="muted small">([\s\S]*?)<\/div><\/td>/,
    )?.[1] ?? "";
  const unmerged = (specFolder: string) =>
    row({
      specFolder,
      state: "done",
      branchUrls: [{ label: "aide", url: "https://example.test/aide" }],
    });

  test("an unmerged dependency puts nothing in the state cell", () => {
    const html = rows([unmerged("106-x")], [target("106-x"), target("114-b", { dependsOn: ["106"] })]);

    expect(hintCell(html, "114-b")).not.toContain("after");
    // The whole cell is the sentence, and nothing else.
    expect(hintCell(html, "114-b")).toMatch(/^[^<]*$/);
  });

  test("the title line still says what the spec builds on", () => {
    const html = rows([unmerged("106-x")], [target("106-x"), target("114-b", { dependsOn: ["106"] })]);

    expect(rowHtml(html, "114-b")).toContain("depends on: 106");
  });
});

// A spec made from the New-spec form starts life as a `create` job — a
// claude run that costs money and can fail — and that run used to be
// findable only by knowing the job id, or appended after `archive` as a
// straggler. It is the spec's FIRST phase, and every spec has had one,
// whether or not the queue ran it.
describe("spec 116: create is the first phase line", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const createJob = (specFolder: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({
      id: "c1",
      specFolder,
      steps: ["create"],
      stepIndex: 0,
      state: "done",
      startedAt: "2026-08-19T10:00:00Z",
      ...extra,
    });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-19T12:00:00Z"),
    );
  const head = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** Everything one row draws: its header line and, when it is open,
   *  the phase lines under it — where the boxes live since spec 124. */
  const runLine = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  const order = (html: string) => [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
  const pipFor = (html: string, label: string) =>
    head(html).match(new RegExp(`<span class="pip ([a-z]+)" title="${label}"`))?.[1] ?? "";
  /** Every pip's title, in order — the only way to prove one is ABSENT. */
  const pipTitles = (html: string) =>
    [...head(html).matchAll(/<span class="pip [a-z]+" title="([^"]+)"/g)].map((m) => m[1]);

  // --- criterion 1: five lines, create first ---------------------------------

  test("a spec with no job at all leads with create (criterion 1)", () => {
    const html = rows([], [target("116-hand-made", { done: ["create", "analyze"] })]);
    expect(order(html)).toEqual(["create", "analyze", "implement", "archive"]);
  });

  // --- criterion 2: no create job means an inert line, not a missing one -----

  test("a hand-made spec's create line reads done, with nothing to RUN (criterion 2)", () => {
    // "Nothing to run" now includes a box that is ticked and
    // disabled (2026-08-21): it is the line saying the phase is behind
    // you, in the same shape the other four use, and it takes no click.
    //
    // Spec 237 left one thing on the line that IS a click: the name,
    // which opens the Description tab. No job ever ran create here — the
    // folder was made by hand — and the tab is the spec's rather than a
    // run's, so it is there to open all the same.
    const html = rows([], [target("116-hand-made", { done: ["create", "analyze"] })]);
    const line = subRow(html, "create");
    expect(line).toContain("b-done");
    expect(line).not.toContain("<form");
    expect(line).not.toContain("<button");
    expect(line).not.toContain("not run yet");
    // No model note, no elapsed time, no cost — what a finished attempt
    // fills and an attempt-less line leaves empty. Since spec 123 the
    // model shares the phase name's own cell rather than having one of
    // its own, so the emptiness is inside that cell.
    // The name leads the first cell since spec 165 — wrapped in the
    // mobile fold control since 2026-08-24, which is inert on desktop —
    // and the box moved in beside the model. `create`'s box is ticked,
    // disabled and nameless: the folder being on disk IS its answer,
    // and a line with no box at all read as a different KIND of line.
    expect(line).toMatch(
      new RegExp(
        `<td class="phasecell"><label class="phasefold">[\\s\\S]*?` +
          `<a href="/specs/aide/116-hand-made\\?tab=description">create</a></label></td>`,
      ),
    );
    expect(line).toContain(
      '<label class="phase checked" data-phase="create">' +
        '<input type="checkbox" value="create" checked disabled ' +
        'aria-label="create — already done, and not a step you can run"> ' +
        "<span></span></label>",
    );
    expect(line).toContain(
      '<td><span class="badge b-done">done</span></td>' +
        '<td data-col="started"></td><td class="num" data-col="cost"></td>',
    );
  });

  // --- criteria 3-4: a real create job, before and after it lands ------------

  test("an unlanded create job's line reads the job's own state (criterion 3)", () => {
    // No target: the folder is what the job is still making, so the
    // files cannot say create has happened.
    const html = rows([createJob("116-landing", { state: "running" })], []);
    expect(order(html)).toEqual(["create", "analyze", "implement", "archive"]);
    const line = subRow(html, "create");
    expect(line).toContain("running");
    expect(line).not.toContain("b-done");
  });

  test("a landed create job's line reads done and links to the description (criterion 4)", () => {
    const html = rows(
      [createJob("116-landed", { model: "sonnet", spentUsd: 0.42 })],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    expect(order(html)[0]).toBe("create");
    const line = subRow(html, "create");
    // Spec 237: create's own file is `1-description.md`, so its line
    // opens the Description tab rather than the run's page.
    expect(line).toContain('href="/specs/aide/116-landed?tab=description"');
    expect(line).toContain("b-done");
    // The model it ran on shows as the select's pre-filled value when
    // choices are configured — no spelled-out text since 2026-08-19,
    // so without a picker the line simply says nothing about it.
    expect(line).not.toContain("last ran");
    expect(line).toContain("$0.42");
  });

  // --- criterion 5: a fifth pip, past because the spec exists ----------------
  //
  // Create had no pip from spec 116 until spec 167: the glance was about
  // the four phases a reader can still run. The hole made create read as
  // a different kind of thing rather than as the phase already behind
  // you — the same reason the phase LINE got a box on 2026-08-21 — so it
  // is a pip like the other four now.
  //
  // It cannot simply be un-filtered. `done` comes from the git history,
  // which counts only `Run /aide-<step> for <folder>` commits, and a
  // spec written by hand has no create commit — every one of those would
  // show a grey pip. The rule is the box's rule: a spec that exists was
  // created, so the pip is past unless a create job is running right
  // now.

  test("create is a past pip once the spec exists, with or without a create commit", () => {
    const withJob = rows(
      [createJob("116-landed")],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    // The hand-written spec is the case `done` cannot answer: no create
    // commit, so `wordPhase`'s ordinary rule would call it "todo".
    const handMade = rows([], [target("116-hand-made", { done: ["analyze"] })]);
    for (const html of [withJob, handMade]) {
      expect(pipTitles(html)).toEqual(["create", "analyze", "implement", "archive"]);
      expect(pipFor(html, "create")).toBe("past");
    }
  });

  test("create is the running pip while a create job is in flight", () => {
    const html = rows(
      [createJob("116-landing", { state: "running" })],
      [target("116-landing")],
    );
    expect(pipFor(html, "create")).toBe("now");
  });

  // --- criterion 6: history, not a control -----------------------------------

  test("create is never a run-form checkbox (criterion 6)", () => {
    const html = rows(
      [createJob("116-landed")],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    const line = runLine(html);
    const boxes = [...line.matchAll(/<input type="checkbox" name="steps" value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    // `analyze` is done too, so its box is ticked and locked (spec
    // 267) and carries no `name="steps"` either — `create`'s own
    // treatment is no longer unique, only first.
    expect(boxes).toEqual(["implement", "archive"]);
  });

  // --- criterion 7: the status sentence and the button do not move -----------

  test("neither the next-phase sentence nor the Run button notices create (criterion 7)", () => {
    // The same spec twice, differing only in whether create is done. A
    // finished job, so the sentence is the one that names the phase the
    // spec is ready for — "ready for create" is what a widened
    // `QUEUE_STEPS` would produce here, and must not.
    const analyzed = row({ id: "a1", specFolder: "116-status", steps: ["analyze"], state: "done" });
    const withCreate = rows([analyzed], [target("116-status", { done: ["create", "analyze"] })]);
    const withoutCreate = rows([analyzed], [target("116-status", { done: ["analyze"] })]);
    // Spec 132: the sentence is the badge itself once the job is at
    // rest. The dot comes off first — it is the badge's live mark.
    const said = (html: string) =>
      head(html)
        .replace(/<span class="dot"[^>]*><\/span>/g, "")
        .match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
    expect(said(withCreate)).toBe(said(withoutCreate));
    expect(said(withCreate)).toBe("ready");
    // The button is named for the phase a press would run (spec 157),
    // and `create` is not one of them whether it is done or not.
    expect(runLine(withCreate)).toContain(">Implement</button>");
    expect(runLine(withoutCreate)).toContain(">Implement</button>");
    // And with everything built it names archive — never "create", and
    // never the again-variant that went 2026-08-19.
    const allBuilt = rows([analyzed], [target("116-status", { done: ["analyze", "implement"] })]);
    expect(runLine(allBuilt)).not.toContain("Run again");
    expect(runLine(allBuilt)).toContain(">Archive</button>");
  });

  // --- criterion 8: once, at the front, never twice --------------------------

  test("a create job appears once, never also appended after archive (criterion 8)", () => {
    const html = rows(
      [createJob("116-landed"), row({ id: "a1", specFolder: "116-landed", steps: ["analyze"], state: "done" })],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    expect(order(html)).toEqual(["create", "analyze", "implement", "archive"]);
    expect(html.match(/data-step="create"/g)).toHaveLength(1);
  });
});

// --- spec 254: a landed step reads busy until its branch actually lands -------
//
// `Runner.complete()` writes `state: "done"` and `landing: true` in the
// same update — the merge into the default branch has not happened yet.
// A row that reads `state` alone sees "done" the instant the step
// finishes, well before the merge settles, and offers "ready" with a
// Run/Analyze button for a spec whose files do not exist yet.
describe("spec 254: a step still landing reads busy, not ready", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-26T12:00:00Z"),
    );
  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The row's own controls line: since spec 109 the run form and
   *  Cancel are a `<tr>` under the header, not a cell inside it. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the State cell — the head row's
   *  THIRD — since spec 157, open or shut alike. */
  const actionCell = (chunk: string) => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[1] ?? "";
  };

  // Criterion 1: a create job whose result has just arrived
  // (`state: "done"`) but whose `landBranch()` merge has not yet
  // resolved (`landing: true`) — the row must read busy, the same as a
  // genuinely running job, and offer Cancel rather than Analyze.
  test("a job done but still landing reads busy and offers Cancel, not Analyze (criterion 1)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "254-landing", steps: ["create"], stepIndex: 0, state: "done", landing: true })],
      [target("254-landing")],
    );
    const line = head(html, "254-landing");
    expect(line).toContain('class="badge b-running"');
    expect(line).toContain("creating");
    expect(line).not.toContain('class="badge b-ready"');
    const cell = actionCell(controlsLine(html, "254-landing"));
    expect(cell).toContain(">Cancel</button>");
    expect(cell).not.toContain(">Analyze</button>");
  });

  // Criterion 4, the regression guard: once `landing` has cleared (the
  // ordinary, already-correct case today), the row is exactly what it
  // is today — no visible change for the settled state.
  test("a job done and no longer landing reads ready, as before (criterion 4)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "254-landed", steps: ["create"], stepIndex: 0, state: "done", landing: false })],
      [target("254-landed")],
    );
    const line = head(html, "254-landed");
    expect(line).toContain('class="badge b-ready"');
    expect(line).not.toContain('class="badge b-running"');
    const cell = actionCell(controlsLine(html, "254-landed"));
    expect(cell).toContain(">Analyze</button>");
    expect(cell).not.toContain(">Cancel</button>");
  });
});

// --- spec 157: one action beside the state, and the phases hard left ---------
//
// The first column of a row has never settled. Spec 124 gave the
// buttons a column of their own, which pushed the whole table sideways;
// 2026-08-19 moved the stack into the spec column, leading one phase
// line and spanning the rest. Spec 149 then took Merge and Approve
// away, and spec 171 took Resolve; what is left — Run and Cancel — is
// never two things
// at once. So the row draws ONE control, in the State column, right
// after the sentence it completes ("archive held back · Implement"),
// and the phase lines take the left edge the stack vacated.
//
// The button is named for the first TICKED phase, not for the state's
// own suggestion, so a reader can see the two disagree before pressing.
describe("spec 157: the row's one action sits in the State column", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("157-one-action")],
    o: { open?: boolean } & Partial<QueuePageOptions> = {},
  ) => {
    const { open = false, ...opts } = o;
    return renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide"],
        ...(open ? { filter: { open: openKeys(list, targets) } } : {}),
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );
  };
  const headRow = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  const cells = (tr: string): string[] =>
    [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
  /** The State column: the head row's third cell, which is where spec
   *  143 pinned it and where the action now joins the badge. */
  const state = (html: string) => cells(headRow(html))[1] ?? "";
  /** What the row's one control SAYS. `<button>` for Run, and the
   *  component-built one for Cancel, whose label sits
   *  after a `<span class="lbl">`-free plain text node. */
  const labels = (cell: string) => [...cell.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  const BUILT = ["analyze"];
  const ALL = ["analyze", "implement", "archive"];
  const lead = (extra: Partial<QueueRowView> = {}) =>
    row({ id: "j1", specFolder: "157-one-action", steps: ["analyze"], state: "done", ...extra });

  // --- criteria 1, 2, 3: the button is named for what is ticked -------------

  for (const open of [true, false]) {
    test(`the next unstarted phase names the button (${open ? "open" : "shut"}, criterion 1)`, () => {
      const html = rows([lead()], [target("157-one-action", { done: BUILT })], { open });
      expect(state(html)).toContain(">ready<");
      expect(labels(state(html))).toEqual(["Implement"]);
    });
  }

  test("a fresh spec's pre-ticked phase names the button (criterion 2)", () => {
    const html = rows([]);
    // Spec 176: the badge names the next phase here as it does on a
    // row that has run something, so it agrees with the button beside
    // it rather than saying nothing.
    expect(state(html)).toContain(">ready<");
    expect(labels(state(html))).toEqual(["Analyze"]);
  });

  // Spec 176, criterion 5: the case a hardcoded "not started" got
  // wrong. A spec whose analyze ran long enough ago that its job
  // record has aged out of the queue is `g.lead === undefined` with
  // `analyze` already in `g.done` from git — and the
  // button beside the badge already read "Implement".
  test("a spec with no job left in memory still says what comes next (spec 176)", () => {
    const html = rows([], [target("157-one-action", { done: BUILT })]);
    expect(state(html)).toContain('class="badge b-ready"');
    expect(state(html)).toContain(">ready<");
    expect(state(html)).not.toContain("not started");
    expect(labels(state(html))).toEqual(["Implement"]);
  });

  // Criterion 3 said a spec with nothing ticked draws no button. Since
  // 2026-08-21 a listed spec always has `archive` ticked — the row
  // exists, so the spec is not archived — and the no-button branch is
  // reachable only where the row is busy or conflicted, both of which
  // draw a control of their own. What survives of the criterion is the
  // rule beneath it: the button names what a press would run.
  test("a spec that has run everything is offered Archive (criterion 3)", () => {
    const html = rows([lead()], [target("157-one-action", { done: ALL })]);
    expect(labels(state(html))).toEqual(["Archive"]);
  });

  // The label is the reader's own tick, not the state's suggestion, so
  // a mismatch is visible in the same line rather than after a press.
  test("a phase ticked ahead of the state's suggestion names the button", () => {
    // `done` is empty and a lead job exists, so `preTicked` is the
    // single next phase — the state and the label agree here. The
    // disagreement this spec makes visible is the other direction: a
    // spec whose files say analyze is next but whose archive was held
    // back reads "archive held back · Analyze".
    const html = rows(
      [lead({ steps: ["archive"] })],
      [target("157-one-action", { done: BUILT, archiveHeldBack: { reason: "the tree is dirty" } })],
    );
    expect(state(html)).toContain("archive held back");
    expect(labels(state(html))).toEqual(["Implement"]);
  });

  // --- criteria 4, 5: Cancel names the step it would stop -------------------

  for (const open of [true, false]) {
    test(`a running spec offers Cancel by name (${open ? "open" : "shut"}, criteria 4, 5)`, () => {
      const html = rows(
        [lead({ steps: ["implement"], stepIndex: 0, state: "running" })],
        [target("157-one-action", { done: BUILT })],
        { open },
      );
      expect(labels(state(html))).toEqual(["Cancel"]);
      expect(state(html)).toContain('action="/api/queue/j1/cancel"');
      expect(state(html)).not.toContain(">Resolve<");
      // No Run button. The run FORM may still be there on an open row
      // — it is the carrier the phase boxes name — but nothing submits
      // it while a job is in flight.
      expect(state(html)).not.toMatch(/<button[^>]*form="rowrun/);
    });
  }

  test("a queued implement cancels by the reader's own word", () => {
    const html = rows(
      [lead({ steps: ["analyze", "implement"], stepIndex: 1, state: "queued" })],
      [target("157-one-action", { done: [] })],
    );
    expect(labels(state(html))).toEqual(["Cancel"]);
  });

  // --- criterion 8: a shut row's Run carries its phases as hidden fields ----

  // Every phase the spec has left, in `QUEUE_STEPS` order (spec 200):
  // a shut row's press runs what an open row's pre-ticked boxes would,
  // and the two read the same `preTicked()` set to say so.
  test("a shut row's run form carries the ticked phases as hidden inputs (criterion 8)", () => {
    const html = rows([]);
    const posted = [...state(html).matchAll(/<input type="hidden" name="steps" value="([^"]+)">/g)].map(
      (m) => m[1],
    );
    expect(posted).toEqual(["analyze", "implement", "archive"]);
  });

  // An OPEN row has real checkboxes, and they are the only source of
  // `steps`: a hidden field beside them would post every phase twice
  // and outvote a reader who unticked one (criterion 12).
  test("an open row's run form carries no steps of its own (criterion 12)", () => {
    const html = rows([], [target("157-one-action")], { open: true });
    expect(state(html)).not.toContain('name="steps"');
    expect(html).toContain('<input type="checkbox" name="steps" value="analyze"');
  });

  // --- criterion 14: the phase lines take the left edge ---------------------

  test("no stack cell survives anywhere, open or shut (criterion 14)", () => {
    for (const open of [true, false]) {
      expect(rows([], [target("157-one-action")], { open })).not.toContain("stackcell");
    }
  });

  test("the phase line leads with its own cell, and still fills the table (criterion 14)", () => {
    const html = rows([], [target("157-one-action")], {
      open: true,
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    const subs = [...html.matchAll(/<tr class="subrow[^"]*"[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    for (const sub of subs) {
      expect([sub.slice(0, 60), sub.indexOf('<td class="phasecell">')]).toEqual([
        sub.slice(0, 60),
        sub.indexOf("<td"),
      ]);
      // The same count on EVERY phase line since spec 179 put a picker
      // on each of them: no line borrows a slot from a `rowspan` on
      // the line above it any more.
      expect([sub.slice(0, 60), cells(sub).length]).toEqual([sub.slice(0, 60), 5]);
    }
  });

  // The phase's own state word stays under the State header, where the
  // spec's badge is: the same question at two altitudes, in one column.
  test("the phase's state word stays in the State column", () => {
    const html = rows([lead()], [target("157-one-action", { done: BUILT })], { open: true });
    const analyze = html.match(/<tr class="subrow[^"]*" data-step="analyze">[\s\S]*?<\/tr>/)![0];
    // The third cell: the phase's name, the cell holding its three
    // controls, then the state word. The Progress column stood between
    // them until 2026-08-22, when the pips moved in beside the spec's
    // name and the column went.
    expect(cells(analyze)[2]).toContain('class="badge b-done"');
    expect(cells(analyze)[1]).toContain('data-phase="analyze"');
  });

  // A shut row's action left the last column for the State column in
  // spec 157, and nothing took its place: the column stood blank on
  // every row for as long as the header declared it, and went on
  // 2026-08-23. The row ends on Cost now, whatever the state.
  test("the head row ends on the cost cell whatever the state", () => {
    for (const r of [[], [lead()], [lead({ state: "running" })], [lead({ errorReason: "conflict" })]]) {
      const row = headRow(rows(r as QueueRowView[]));
      expect(cells(row)).toHaveLength(4);
      expect(row).toMatch(/data-col="cost">[\s\S]*<\/td><\/tr>$/);
    }
  });

  // Spec 159 landed with every phase in its git history — analyze,
  // implement AND archive — because the archive step DID
  // run: it made its commit and then declined to move the folder. The
  // row therefore had nothing left to suggest and drew no button at
  // all, beside a badge reading "archive held back". The one thing on
  // that row that needed a press was the one it did not offer.
  test("a held-back archive is offered again, however the history reads", () => {
    const html = rows(
      [],
      [
        target("159-ci", {
          done: ["analyze", "implement", "archive"],
          archiveHeldBack: { reason: "the first real Actions run is unwatched" },
        }),
      ],
    );
    expect(labels(state(html))).toEqual(["Archive"]);
    const posted = [...state(html).matchAll(/<input type="hidden" name="steps" value="([^"]+)">/g)].map(
      (m) => m[1],
    );
    expect(posted).toEqual(["archive"]);
  });

  // ...and so is a spec whose archive left NO held-back note. Spec 161
  // reached exactly that state hours later: the note was cleared by
  // hand, the history still said archive had run, and the row went to
  // "done — nothing waiting on you" about a spec sitting unarchived in
  // the list. A row that exists is a spec that is not archived — the
  // note is a reason, never the evidence.
  test("a listed spec offers Archive even with no held-back note", () => {
    const html = rows(
      [],
      [target("161-cleared", { done: ["analyze", "implement", "archive"] })],
    );
    expect(labels(state(html))).toEqual(["Archive"]);
  });

  // Spec 191: the two halves of that same cell were worked out apart.
  // The button read the rule above; the badge asked `g.done` raw, found
  // every phase in it, and said "done — nothing waiting on you" beside
  // a button reading "Archive". One row, two answers. Both are read
  // here, off ONE render, so they cannot drift again without this
  // failing.
  test("the badge and the button name the same phase once archive has run and declined", () => {
    const html = rows(
      [],
      [target("191-agree", { done: ["analyze", "review-plan", "implement", "archive"] })],
    );
    expect(state(html)).toContain(">ready<");
    expect(labels(state(html))).toEqual(["Archive"]);
  });

  // Spec 161's own scenario, asked of the BADGE this time: the
  // held-back note cleared by hand while the history still lists
  // archive. Clearing the reason archiving did not happen does not
  // make it have happened.
  test("a cleared held-back note leaves the badge saying archive is ready", () => {
    const html = rows(
      [],
      [target("191-cleared", { done: ["analyze", "review-plan", "implement", "archive"] })],
    );
    expect(state(html)).toContain(">ready<");
    expect(labels(state(html))).toEqual(["Archive"]);
    expect(state(html)).not.toContain("nothing waiting on you");
  });

});

// --- spec 161: a row's one action is primary, whichever it is ----------------
//
// Spec 157 built Run as a bare `.btn` on the argument that a column of
// primary buttons says nothing about which row to look at. A row draws
// exactly ONE control now, so there is no column to differentiate and
// nothing for the colour to tell apart — it only has to say the action
// is here. Cancel came along for the same reason plus one more: in dark
// mode `--danger` (#E8836B) and `--accent` (#F0663F) sit close enough in
// hue that an outlined Cancel and a filled button beside it said nothing
// different to the eye (looked at live, 2026-08-21).
describe("spec 161: the row's one action is primary", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, projects: ["aide"] },
      Date.parse("2026-08-21T12:00:00Z"),
    );
  /** Every button on a ROW, as its class attribute. Read off the table
   *  alone since spec 221: the search field above it has a Search button
   *  of its own, and it is not a row's action — the rule under test is
   *  about the one control a row draws. */
  const classes = (html: string): string[] =>
    [...html.slice(html.indexOf("<tbody")).matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g)].map(
      (m) => m[1] ?? "",
    );
  const lead = (extra: Partial<QueueRowView> = {}) =>
    row({ id: "j1", specFolder: "161-one-variant", steps: ["analyze"], state: "done", ...extra });

  test("the Run button is filled, not bare (criterion 5)", () => {
    const html = rows([], [target("161-one-variant")]);
    expect(classes(html)).toEqual(["btn primary"]);
  });

  test("Cancel is filled too — it is the busy row's one action (criterion 6)", () => {
    const html = rows(
      [lead({ steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("161-one-variant", { done: ["analyze"] })],
    );
    expect(classes(html)).toEqual(["btn primary"]);
    expect(html).not.toContain("danger");
  });

  // Resolve was the third variant here until spec 171 retired it. A
  // conflicted row now draws the ordinary Run, and it is filled like
  // every other row's one action.
  test("a conflicted row's Run is filled like any other (criterion 7)", () => {
    const html = rows(
      [lead({ errorReason: "conflict", error: "cannot merge — conflict" })],
      [target("161-one-variant", { done: ["analyze"] })],
    );
    expect(html).not.toContain(">Resolve</button>");
    expect(classes(html)).toEqual(["btn primary"]);
  });
});
