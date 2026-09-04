// Split out of phase-rules.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";
import {
  row,
  openKeys,
} from "../fixtures.ts";

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
    // The Time cell is the exception to the emptiness: every phase says
    // how long it took, and a phase nobody ran took `0s`. A blank there
    // asks whether the line is broken.
    expect(line).toContain(
      '<td><span class="badge b-done">done</span></td>' +
        '<td data-col="created"></td><td data-col="started"><span class="muted small">0s</span></td>' +
        '<td class="num" data-col="cost"></td>',
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
    // The landing is what the row says, not the step's own gerund: a
    // step that reported success is not still running, and the merge is
    // the thing everything else in the queue is waiting for.
    expect(line).toContain("landing create");
    expect(line).not.toContain('class="badge b-ready"');
    const cell = actionCell(controlsLine(html, "254-landing"));
    expect(cell).toContain(">Cancel</button>");
    expect(cell).not.toContain(">Analyze</button>");
  });

  // The shape that used to hide the landing completely: the job has
  // already stepped on to its NEXT step while the last one's branch is
  // still merging, so `state` reads `queued` and the row drew
  // "implementing 2/2" over a spec whose ANALYZE was landing — the one
  // reason nothing in the queue could start (2026-09-04). The step named
  // is the landing's own, the one just finished.
  test("a job queued on its next step while the last one lands says so", () => {
    const html = rows(
      [row({
        id: "j1", specFolder: "254-landing", steps: ["analyze", "implement"], stepIndex: 1,
        state: "queued", landing: true,
      })],
      [target("254-landing")],
    );
    const line = head(html, "254-landing");
    expect(line).toContain('class="badge b-running"');
    expect(line).toContain("landing analyze");
    expect(line).not.toContain("implementing");
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

// --- spec 280: the row's notice names the failure that actually happened ----
//
// Spec 278's own incident: an `archive` job downgraded to `state:
// "failed"` with `errorReason: "unlanded"` — the spec WAS archived, but
// its work never landed (2-analysis.md's `merge.ts` finding). Two
// separate gaps let a reader miss it, one per test below:
// `word-phase.ts`'s generic `last re-run ${stateLabel}` sentence never
// said "unlanded" was different from any other failure (AC6), and
// `phaseDisagreement`'s "earliest phase with any qualifier" rule
// (`notice-row.ts`) could let an earlier, unrelated phase's own softer
// qualifier hide archive's real one (AC7).
describe("spec 280: an unlanded archive failure names itself, not an unrelated phase", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-30T12:00:00Z"),
    );
  const panel = (html: string) => html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  const BUILT = ["create", "analyze", "implement", "archive"];

  // AC6: archive's own `unlanded` failure is what the panel names —
  // never the bare, generic "last re-run failed" attributed to
  // `implement`, which has no qualifier of its own here at all.
  test("an unlanded archive failure is named, not implement's unrelated success", () => {
    const html = rows(
      [
        row({
          id: "impl",
          specFolder: "278-repro",
          steps: ["implement"],
          state: "done",
        }),
        row({
          id: "arch",
          specFolder: "278-repro",
          steps: ["archive"],
          state: "failed",
          errorReason: "unlanded",
        }),
      ],
      [target("278-repro", { done: BUILT })],
    );
    expect(panel(html)).toContain(
      "archive: archived, but landing it failed — its branch is still open. — Re-run archive.",
    );
    expect(panel(html)).not.toContain("implement: last re-run failed");
    expect(panel(html)).not.toContain('"implement: last re-run failed"');
  });

  // AC7: even when implement's own phase ALSO carries a softer
  // qualifier of its own (a re-run that merely disagrees, never
  // reaching `state: "failed"`) at the same moment, archive's specific
  // `unlanded` failure still wins — a real failure outranks an earlier
  // phase's unrelated note, regardless of workflow order.
  test("archive's real failure still wins over implement's own softer note", () => {
    const html = rows(
      [
        row({
          id: "impl",
          specFolder: "278-repro2",
          steps: ["implement"],
          state: "cancelled",
        }),
        row({
          id: "arch",
          specFolder: "278-repro2",
          steps: ["archive"],
          state: "failed",
          errorReason: "unlanded",
        }),
      ],
      [target("278-repro2", { done: BUILT })],
    );
    expect(panel(html)).toContain(
      "archive: archived, but landing it failed — its branch is still open. — Re-run archive.",
    );
    expect(panel(html)).not.toContain("implement:");
  });
});

// --- a landing lights only the step it is landing ----------------------------
//
// `attemptFor` builds one view of the job per step by spreading the job,
// so `landing` used to reach every step's view — including steps that
// already finished. `inFlight` is true for anything carrying that flag,
// so a three-step job waiting for its merge drew all three pips as
// running at once: the row said three phases were live when none was.
describe("a landing marks only the step being landed, not every finished step", () => {
  const rows = (list: QueueRowView[], done: string[] = []) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "375-landing-pips", done }],
      },
      Date.parse("2026-09-03T14:20:00Z"),
    );
  const pipKind = (html: string, label: string) =>
    html.match(new RegExp(`<span class="pip ([a-z]+)" title="${label}"`))?.[1] ?? "";

  const chained = row({
    id: "j375",
    specFolder: "375-landing-pips",
    steps: ["analyze", "implement", "archive"],
    stepIndex: 2,
    state: "done",
    landing: true,
    results: [
      { step: "analyze", ok: true, costUsd: 1 },
      { step: "implement", ok: true, costUsd: 1 },
      { step: "archive", ok: true, costUsd: 1 },
    ],
  });

  test("the finished steps do not read running while the last one lands", () => {
    const html = rows([chained]);
    expect(pipKind(html, "analyze")).not.toBe("now");
    expect(pipKind(html, "implement")).not.toBe("now");
  });

  test("the finished steps read past once the spec's own file names them", () => {
    const html = rows([chained], ["create", "analyze", "implement"]);
    expect(pipKind(html, "analyze")).toBe("past");
    expect(pipKind(html, "implement")).toBe("past");
  });

  test("the step being landed still reads running", () => {
    const html = rows([chained]);
    expect(pipKind(html, "archive")).toBe("now");
  });
});
