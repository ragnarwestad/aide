// Split out of phase-rules.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView } from "../../../../../src/render";
import { row, specTarget, openRowsAt } from "../../fixtures.ts";

describe("create is the first phase line", () => {
  const target = specTarget;
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
  const rows = openRowsAt("2026-08-19T12:00:00Z");
  const head = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** Everything one row draws: its header line and, when it is open,
   *  the phase lines under it — where the boxes live. */
  const runLine = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  const order = (html: string) => [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
  /** The pips came off the specs list on 2026-09-07; each phase's own
   *  state is read on its LINE here, and the pips are tested where they
   *  still are, on the spec page's Overview. */

  // --- Five lines, create first ---------------------------------

  test("a spec with no job at all leads with create", () => {
    const html = rows([], [target("116-hand-made", { done: ["create", "analyze"] })]);
    expect(order(html)).toEqual(["create", "analyze", "implement", "archive"]);
  });

  // --- No create job means an inert line, not a missing one -----

  test("an unlanded create job's line reads the job's own state", () => {
    // No target: the folder is what the job is still making, so the
    // files cannot say create has happened.
    const html = rows([createJob("116-landing", { state: "running" })], []);
    expect(order(html)).toEqual(["create", "analyze", "implement", "archive"]);
    const line = subRow(html, "create");
    expect(line).toContain("Running");
    expect(line).not.toContain("b-done");
  });

  test("an unlanded create row locks every AI and model picker (AC-1)", () => {
    const choices = {
      modelChoices: [{ name: "sonnet" }, { name: "codex-fast", tool: "codex" as const }],
      providerChoices: [
        { key: "Claude", name: "Claude", tool: "claude" as const },
        { key: "Codex", name: "Codex", tool: "codex" as const },
      ],
    };
    for (const state of ["queued", "running", "done"] as const) {
      const html = rows(
        [createJob("new-1234abcd", {
          state,
          landing: state === "done",
          editableSteps: ["analyze", "implement", "archive"],
        })],
        [],
        choices,
      );
      const selects = runLine(html).match(/<select[\s\S]*?<\/select>/g) ?? [];
      expect(selects.length).toBeGreaterThan(0);
      expect([state, ...selects.map((select) => select.match(/^<select[^>]*>/)?.[0])])
        .toEqual([state, ...selects.map(() => expect.stringContaining(" disabled"))]);
    }
  });

  test("a landed create row offers pickers allowed by ordinary phase rules (AC-2)", () => {
    const html = rows(
      [createJob("116-landed")],
      [target("116-landed", { done: ["create"] })],
      {
        modelChoices: [{ name: "sonnet" }, { name: "codex-fast", tool: "codex" }],
        providerChoices: [{ key: "Claude", name: "Claude", tool: "claude" }],
      },
    );
    const analyze = subRow(html, "analyze");
    expect(analyze.match(/<select[\s\S]*?<\/select>/g)?.every((select) => !/^<select[^>]* disabled/.test(select))).toBe(true);
  });

  // --- A fifth pip, past because the spec exists ----------------
  //
  // Create once had no pip: the glance was about
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

  // Read on the PHASE LINE since 2026-09-07: the pips came off the specs
  // list, and the rule they showed — a spec that exists was created — is
  // the phase line's own word. The pips still draw it from the same
  // data on the spec page's Overview.
  test("create reads done once the spec exists, with or without a create commit", () => {
    const withJob = rows(
      [createJob("116-landed")],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    // The hand-written spec is the case `done` cannot answer: no create
    // commit, so `wordPhase`'s ordinary rule would call it "todo".
    const handMade = rows([], [target("116-hand-made", { done: ["analyze"] })]);
    // The line's own box is what says it: ticked and disabled, with the
    // reason on it. A hand-written spec has no create commit and no job,
    // so its badge stays "not run yet" — the folder existing is the
    // answer, and that is what the box carries.
    for (const html of [withJob, handMade]) {
      expect(subRow(html, "create")).toContain('checked disabled');
      expect(subRow(html, "create")).toContain("already done, and not a step you can run");
    }
  });

  test("create reads running while a create job is in flight", () => {
    const html = rows(
      [createJob("116-landing", { state: "running" })],
      [target("116-landing")],
    );
    expect(subRow(html, "create")).toContain("b-running");
  });

  // --- History, not a control -----------------------------------

  test("create is never a run-form checkbox", () => {
    const html = rows(
      [createJob("116-landed")],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    const line = runLine(html);
    const boxes = [...line.matchAll(/<input type="checkbox" name="steps" value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    // `analyze` has run and may be run again; `create` never is.
    expect(boxes).toEqual(["analyze", "implement", "archive"]);
  });

  // --- The status sentence and the button do not move -----------

  test("neither the next-phase sentence nor the Run button notices create", () => {
    // The same spec twice, differing only in whether create is done. A
    // finished job, so the sentence is the one that names the phase the
    // spec is ready for — "ready for create" is what a widened
    // `RUN_STEPS` would produce here, and must not.
    const analyzed = row({ id: "a1", specFolder: "116-status", steps: ["analyze"], state: "done" });
    const withCreate = rows([analyzed], [target("116-status", { done: ["create", "analyze"] })]);
    const withoutCreate = rows([analyzed], [target("116-status", { done: ["analyze"] })]);
    // The sentence is the badge itself once the job is at
    // rest.
    const said = (html: string) =>
      head(html)
        .match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
    expect(said(withCreate)).toBe(said(withoutCreate));
    expect(said(withCreate)).toBe("Analyzed");
    // The button is named for the phase a press would run,
    // and `create` is not one of them whether it is done or not.
    expect(runLine(withCreate)).toContain(">Implement</button>");
    expect(runLine(withoutCreate)).toContain(">Implement</button>");
    // And with everything built it names archive — never "create", and
    // never the again-variant that went 2026-08-19.
    const allBuilt = rows([analyzed], [target("116-status", { done: ["analyze", "implement"] })]);
    expect(runLine(allBuilt)).not.toContain("Run again");
    expect(runLine(allBuilt)).toContain(">Archive</button>");
  });

  // --- Once, at the front, never twice --------------------------

  test("a create job appears once, never also appended after archive", () => {
    const html = rows(
      [createJob("116-landed"), row({ id: "a1", specFolder: "116-landed", steps: ["analyze"], state: "done" })],
      [target("116-landed", { done: ["create", "analyze"] })],
    );
    expect(order(html)).toEqual(["create", "analyze", "implement", "archive"]);
    expect(html.match(/data-step="create"/g)).toHaveLength(1);
  });
});

// --- A landed step reads busy until its branch actually lands -------
//
// `Runner.complete()` writes `state: "done"` and `landing: true` in the
// same update — the merge into the default branch has not happened yet.
// A row that reads `state` alone sees "done" the instant the step
// finishes, well before the merge settles, and offers "ready" with a
// Run/Analyze button for a spec whose files do not exist yet.
describe("a step still landing reads busy, not ready", () => {
  const target = specTarget;
  // Open: these read the row's one control, which rides the caption
  // line the fold opens (2026-09-08). The head line they also read is
  // drawn the same way either way.
  const rows = openRowsAt("2026-08-26T12:00:00Z");
  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>\\s*<tr class="specstate".*?</tr>`))?.[0] ?? "";
  /** The row's own controls line: the run form and
   *  Cancel are a `<tr>` under the header, not a cell inside it. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: at the end of the caption line's
   *  captions, just before its State cell, which only an OPEN row draws. */
  const actionCell = (chunk: string) => {
    return (chunk.match(/<span class="actionslot">([\s\S]*?)<\/span><\/span><\/td>/)?.[1] ?? "");
  };

  // A create job whose result has just arrived
  // (`state: "done"`) but whose `landBranch()` merge has not yet
  // resolved (`landing: true`) — the row must read busy, the same as a
  // genuinely running job, and must not offer Analyze.
  //
  // It offered Cancel here until the whole `create` phase stopped
  // offering one: the rule is the phase, merge included, so that a
  // reader never has to work out which half of a create they are
  // looking at before deciding whether a press is safe.
  test("a job done but still landing reads busy and offers no press at all", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "254-landing", steps: ["create"], stepIndex: 0, state: "done", landing: true })],
      [target("254-landing")],
    );
    const line = head(html, "254-landing");
    expect(line).toContain('class="badge b-running"');
    // The step's own gerund: from outside, a spec whose create branch is
    // being merged is still creating. The merge is not a stage of its
    // own to a reader, and naming it as one asked them to act on a
    // division they have no move in.
    expect(line).toContain("Creating");
    expect(line).not.toContain('class="badge b-ready"');
    const cell = actionCell(controlsLine(html, "254-landing"));
    expect(cell).not.toContain(">Analyze</button>");
    expect(cell).not.toContain(">Cancel</button>");
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
    expect(line).toContain("Analyzing");
    expect(line).not.toContain("Implementing");
  });

  test("a finished Create shows Created when its merge settles", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "254-landed", steps: ["create"], stepIndex: 0, state: "done", landing: false })],
      [target("254-landed")],
    );
    const line = head(html, "254-landed");
    expect(line).toContain(">Created<");
    expect(line).not.toContain('class="badge b-running"');
    const cell = actionCell(controlsLine(html, "254-landed"));
    expect(cell).toContain(">Analyze</button>");
    expect(cell).not.toContain(">Cancel</button>");
  });
});

// --- The row's notice names the failure that actually happened ----
//
// The incident: an `archive` job downgraded to `state:
// "failed"` with `errorReason: "unlanded"` — the spec WAS archived, but
// its work never landed (2-analysis.md's `merge.ts` finding). Two
// separate gaps let a reader miss it, one per test below:
// `word-phase.ts`'s generic `last re-run ${stateLabel}` sentence never
// said "unlanded" was different from any other failure, and
// `phaseDisagreement`'s "earliest phase with any qualifier" rule
// (`notice-row.ts`) could let an earlier, unrelated phase's own softer
// qualifier hide archive's real one.
describe("an unlanded archive failure names itself, not an unrelated phase", () => {
  const target = specTarget;
  const rows = openRowsAt("2026-08-30T12:00:00Z");
  const panel = (html: string) => html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  const BUILT = ["create", "analyze", "implement", "archive"];

  // Archive's own `unlanded` failure is what the panel names —
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
      "Archive merge failed: the spec was archived, but its branch is still open\nSolution: Press Archive again",
    );
    expect(panel(html)).not.toContain("implement: last re-run failed");
    expect(panel(html)).not.toContain('"implement: last re-run failed"');
  });

  // Even when implement's own phase ALSO carries a softer
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
      "Archive merge failed: the spec was archived, but its branch is still open\nSolution: Press Archive again",
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
  // The compact header pips came off the list on 2026-09-07, so every
  // assertion here reads the phase LINE's own badge — which only exists
  // once the row is OPEN, hence `openRows` below.
  const openRows = (list: QueueRowView[], done: string[] = []) =>
    renderSpecsRows(
      list,
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "375-landing-pips", done }],
        filter: { open: "aide/375-landing-pips" },
      },
      Date.parse("2026-09-03T14:20:00Z"),
    );
  /** A phase LINE's own badge text — not the row's, and not just its
   *  pip. A "live" variant's badge carries a leading dot
   *  span (`components.ts`'s `badge()`); stripped first the same way
   *  `phase-row-rendering.test.ts`'s own helper does. */
  const badgeLabel = (html: string, step: string): string =>
    (
      html
        .match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">[\\s\\S]*?</tr>`))?.[0] ?? ""
    ).match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";

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
    const html = openRows([chained]);
    expect(badgeLabel(html, "analyze")).not.toBe("running");
    expect(badgeLabel(html, "implement")).not.toBe("running");
  });

  test("the finished steps read done once the spec's own file names them", () => {
    const html = openRows([chained], ["create", "analyze", "implement"]);
    expect(badgeLabel(html, "analyze")).toBe("Done");
    expect(badgeLabel(html, "implement")).toBe("Done");
  });

  test("the step being landed still reads running", () => {
    const html = openRows([chained]);
    expect(badgeLabel(html, "archive")).toBe("Running");
  });

  // The rule holds for every step that lands its own
  // work, not only archive.
  test("a non-archive landing step reads Running too", () => {
    const analyzing = row({
      id: "j375b",
      specFolder: "375-landing-pips",
      steps: ["analyze"],
      stepIndex: 0,
      state: "done",
      landing: true,
      results: [{ step: "analyze", ok: true, costUsd: 1 }],
    });
    const html = openRows([analyzing]);
    expect(badgeLabel(html, "analyze")).toBe("Running");
  });
});
