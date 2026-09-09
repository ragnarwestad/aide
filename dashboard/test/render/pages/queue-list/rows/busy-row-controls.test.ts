import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import { ICON_LOCK } from "../../../../../src/render/ui/components.ts";
import { row, openKeys } from "../../fixtures.ts";

// --- spec 105: while a spec is busy, its row offers Cancel and nothing else ---
//
// Split out of row-status-and-controls.test.ts by theme.
//
// The row's controls used to be governed step by step: spec 101
// disabled the boxes the in-flight job named, and everything else on
// the row stayed live. Seen on 2026-08-19 on spec 103 — `implement`
// running, its spinner up, and the other three phase boxes still
// tickable, "more" still setting a model for a job that could not be
// started, and a second Run one press away. The queue refuses that
// press ("already running on this spec"), so the row was promising
// what the page could not keep.
//
// ONE rule, read off the SPEC's state: while any job is in flight —
// queued, running, or parked at a gate — the row offers exactly what
// that state allows. Every test here is about an OPENED row, because
// a collapsed one has no phase box, no model and no Run to lock in the
// first place (its narrower promise is in the spec 103 block, in
// collapsed-row.test.ts).
describe("spec 105: a busy row offers only what its state allows", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: QueueTarget[] = [], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        projects: ["aide", "paceup"],
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  /** The line an open row reveals under its header: since spec 109 the
   *  phase boxes, Run and Cancel are here, never in the header's cell —
   *  and since spec 117 the model and "also touches" too. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the State cell — the head row's
   *  THIRD — since spec 157, open or shut alike. It was the header's
   *  last cell for a shut row and a spanning `stackcell` for an open
   *  one, which is why this used to need the whole row group. */
  const actionCell = (chunk: string) => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[1] ?? "";
  };
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";
  /** The Run button itself, with whatever attributes it carries. */
  const runBtn = (line: string) => line.match(/<button [^>]*>(?:<[^>]*>)*Run(?: again)?<\/button>/)?.[0] ?? "";

  const spec = (state: QueueRowView["state"], folder = "105-busy") =>
    row({ id: "j1", specFolder: folder, steps: ["implement"], stepIndex: 0, state });

  /** The same open row's controls line — where every lockable control
   *  on it lives (spec 109). */
  const openControls = (r: QueueRowView, folder = "105-busy") =>
    controlsLine(rows([r], [target(folder)]), folder);

  // --- criterion 1: running or queued, Cancel and only Cancel ---------------

  /** One button of the action stack, from its own form. */
  const control = (cell: string, verb: string) =>
    cell.match(new RegExp(`<form method="post" action="/api/queue/j1/${verb}"[\\s\\S]*?</form>`))?.[0] ?? "";

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec's opened row offers Cancel, and nothing else it can press (criterion 1)`, () => {
      // Since spec 124 the buttons never come and go — a row's stack is
      // the same buttons throughout, and its STATE says which of them
      // will take a click. Since spec 149 Cancel is the only one in it
      // at all: Approve went with the stop between steps, Merge with
      // the hand merge.
      const cell = actionCell(openControls(spec(state)));
      expect(control(cell, "cancel")).not.toContain("disabled");
      expect(control(cell, "approve")).toBe("");
      expect(control(cell, "merge")).toBe("");
    });
  }

  // --- criterion 2: every phase box locks, with the reason on it -------------

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec locks every phase box, not the ones its job named (criterion 2)`, () => {
      const line = openControls(spec(state));
      for (const step of ["analyze", "implement", "archive"]) {
        expect(box(line, step)).toContain("disabled");
        expect(box(line, step)).toContain(`title="implement is ${state === "running" ? "running" : "queued"}"`);
      }
    });
  }

  test("the step being worked reads as ticked; the rest keep their own look (criterion 2)", () => {
    const line = openControls(spec("running"));
    // Since spec 168 the box says only that the job named the step.
    // What says the step is being worked RIGHT NOW is the pip on the
    // row above, which is visible whether the row is open or shut.
    expect(box(line, "implement")).toContain('class="phase checked"');
    expect(box(line, "implement")).not.toContain('class="spin"');
    // Not part of this job, so unticked — inert, but not padlocked
    // (spec 145): the padlock is for a control with nothing else on it
    // to say why it will not take a click.
    expect(box(line, "analyze")).toContain('class="phase default"');
    expect(box(line, "analyze")).not.toContain(ICON_LOCK);
  });

  test("a queued job spins nothing — its own step still reads as ticked (criterion 2)", () => {
    const line = openControls(spec("queued"));
    // The job named `implement` and nothing else. Queued is not yet
    // running, so no box spins — but the tick that was made before Run
    // was pressed is still what the row says (spec 145).
    expect(box(line, "implement")).toContain('class="phase checked"');
    for (const step of ["analyze", "archive"]) {
      expect(box(line, step)).toContain('class="phase default"');
    }
    for (const step of ["analyze", "implement", "archive"]) {
      expect(box(line, step)).not.toContain('class="phase off"');
      expect(box(line, step)).not.toContain(ICON_LOCK);
    }
  });

  /** Spec 145's own case, and spec 142's measurement: all three steps
   *  ticked and started as one job, with two of them not reached yet.
   *  The two said nothing about belonging to the running job — they
   *  were drawn exactly like a step the job never named. */
  test("a step queued behind the running one stays ticked, without the padlock (criterion 2)", () => {
    const line = openControls(
      row({
        id: "j1",
        specFolder: "105-busy",
        steps: ["analyze", "implement", "archive"],
        stepIndex: 0,
        state: "running",
      }),
    );
    // The one being worked, in the same job — since spec 168 it is
    // drawn like the two behind it, and the pip carries the motion.
    expect(box(line, "analyze")).toContain('class="phase checked"');
    expect(box(line, "analyze")).not.toContain('class="spin"');
    for (const step of ["implement", "archive"]) {
      const b = box(line, step);
      expect(b).toContain(`value="${step}" checked`);
      expect(b).toContain("disabled");
      expect(b).toContain('class="phase checked"');
      expect(b).not.toContain('class="phase off"');
      expect(b).not.toContain(ICON_LOCK);
    }
  });

  // --- criterion 3: Run, the model and the "more" fields lock too ------------

  // Run used to stand here greyed out, with the reason in its title —
  // the shape spec 124 needed so a column of buttons could not change
  // width from row to row. Spec 157 draws ONE control per row, and
  // while a job is in flight that control is Cancel: an inert Run
  // beside a live Cancel is exactly the second control this removes.
  test("no Run is drawn at all while the spec is busy (criterion 3)", () => {
    const line = openControls(spec("running"));
    expect(runBtn(line)).toBe("");
    expect(line).not.toMatch(/<button[^>]*form="rowrun/);
    // The old title told the reader to do the exact thing this rule
    // removes; it must not survive anywhere on the row.
    expect(line).not.toContain("tick a phase it does not hold");
    // What the row offers instead names the step it would stop.
    expect(line).toContain(">Cancel</button>");
  });

  test("the model select locks (criterion 3)", () => {
    const html = rows([spec("running")], [target("105-busy")]);
    // The model select is on the phase lines since spec 123; the rule
    // it obeys is this one, unchanged.
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).toContain("disabled");
  });

  // There is no disclosure left to carry the reason on a summary, so
  // each of them says it itself — which is where the promise always
  // actually lived.
  test("each locked field carries the same reason (criterion 3)", () => {
    const html = rows([spec("running")], [target("105-busy")]);
    const line = controlsLine(html, "105-busy");
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).toContain(
      'title="implement is running"',
    );
    expect(box(line, "analyze")).toContain('title="implement is running"');
  });

  // --- criterion 4: a gate offers Approve and Cancel, and locks the rest -----

  // --- criterion 5: a settled spec is the ordinary row it always was ---------

  for (const state of ["done", "failed", "stopped", "cancelled", "interrupted"] as const) {
    test(`a ${state} spec's row is fully interactive again (criterion 5)`, () => {
      const html = rows([spec(state)], [target("105-busy")]);
      const line = controlsLine(html, "105-busy");
      for (const step of ["analyze", "implement", "archive"]) {
        expect(box(line, step)).not.toContain("disabled");
      }
      expect(runBtn(line)).not.toContain("disabled");
      expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).not.toContain("disabled");
    });
  }

  test("a spec with no job at all is untouched by the rule (criterion 5)", () => {
    const html = rows([], [target("105-never-run")]);
    const line = controlsLine(html, "105-never-run");
    for (const step of ["analyze", "implement", "archive"]) {
      expect(box(line, step)).not.toContain("disabled");
    }
    expect(runBtn(line)).not.toContain("disabled");
    expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).not.toContain("disabled");
  });

});

// Every other step can be cancelled and run again from the spec it
// already made. `create` is what MAKES that spec: a press there throws
// away the title and the description with nothing left on the board to
// run again from, and the row that is left offers Analyze for a spec
// that does not exist. So the row draws no Cancel while create runs —
// the step's own timeout is what ends one that hangs.
describe("a running create offers no Cancel", () => {
  const creating = (state: QueueRowView["state"]): string =>
    renderQueueRows(
      [
        row({
          id: "c1",
          specFolder: "new-abcd1234",
          steps: ["create", "analyze", "implement", "archive"],
          stepIndex: 0,
          state,
        }),
      ],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "new-abcd1234" }],
        filter: { open: "aide/new-abcd1234" },
      },
    );

  for (const state of ["queued", "running"] as const) {
    test(`${state}: no cancel form and no Cancel button`, () => {
      const html = creating(state);
      expect(html).not.toContain("/api/queue/c1/cancel");
      expect(html).not.toContain(">Cancel</button>");
    });
  }

  test("a later step of the same job still offers it", () => {
    const html = renderQueueRows(
      [
        row({
          id: "c2",
          specFolder: "9-made",
          steps: ["create", "analyze", "implement", "archive"],
          stepIndex: 1,
          state: "running",
        }),
      ],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "9-made" }],
        filter: { open: "aide/9-made" },
      },
    );
    expect(html).toContain("/api/queue/c2/cancel");
  });
});

// --- spec 423: a confirmation asks before Cancel takes effect --------------
//
// Cancel used to reach the server on one click. This covers the dialog
// `actionForm()` now draws beside that click, and REQ-3's own rule: the
// step it names is `landingStep(r)` only while `r.landing` is set,
// `currentStep(r)` otherwise — never `landingStep(r)` unconditionally,
// which names the step that already finished on a row merely queued for
// its next one (Plan review, 3-solution.md).
describe("spec 423: a confirmation asks before Cancel takes effect", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: QueueTarget[] = [], opts: Partial<QueuePageOptions> = {}) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  // The actionslot — the row's own control and its dialog — sits in the
  // CAPTION line's third cell (phasecell, modelcell, state), not in the
  // header row (`data-caption="1"`, matching expanded-row-controls.test.ts's
  // own extraction).
  const actionCell = (chunk: string) => {
    const caption = chunk.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = [...caption.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[2] ?? "";
  };
  const cellFor = (r: QueueRowView, folder = "423-busy", opts: Partial<QueuePageOptions> = {}) =>
    actionCell(controlsLine(rows([r], [target(folder)], opts), folder));

  test("a running row's dialog names the step and offers OK and Cancel (criteria 2, 3)", () => {
    const cell = cellFor(row({ id: "j1", specFolder: "423-busy", steps: ["implement"], stepIndex: 0, state: "running" }));
    expect(cell).toContain('<dialog class="confirmdialog">');
    expect(cell).toContain("<h2>Cancel implement?</h2>");
    expect(cell).toContain('<p class="muted">');
    // Both the outer form and the dialog's own confirm form post to the
    // same route, by design (2-analysis.md, expanded-row-controls.test.ts).
    expect(cell.match(/action="\/api\/queue\/j1\/cancel"/g)).toHaveLength(2);
    expect(cell).toContain(">OK</button>");
    // The dismiss button reuses the row's own label, and structurally
    // cannot post: `method="dialog"`, no `action` at all.
    expect(cell).toMatch(/<form method="dialog"><button class="btn" type="submit">Cancel<\/button><\/form>/);
  });

  test("the dismiss button carries no action — it cannot reach the server (criterion 1)", () => {
    const cell = cellFor(row({ id: "j1", specFolder: "423-busy", steps: ["implement"], stepIndex: 0, state: "running" }));
    const dismiss = cell.match(/<form method="dialog">[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(dismiss).not.toContain("action=");
  });

  test("a landing row names the step whose merge is running, not the one queued next (criterion 6a)", () => {
    const cell = cellFor(
      row({
        id: "j1",
        specFolder: "423-landing",
        steps: ["analyze", "implement", "archive"],
        stepIndex: 1,
        state: "queued",
        landing: true,
      }),
      "423-landing",
    );
    expect(cell).toContain("<h2>Cancel analyze?</h2>");
  });

  test("a spec merely queued for its next step names THAT step, not the one already landed (criterion 6b)", () => {
    const cell = cellFor(
      row({
        id: "j1",
        specFolder: "423-queued",
        steps: ["analyze", "implement", "archive"],
        stepIndex: 1,
        state: "queued",
        landing: false,
      }),
      "423-queued",
    );
    expect(cell).toContain("<h2>Cancel implement?</h2>");
  });

  test("in Norwegian, the dialog's title and both buttons are the Norwegian text (criterion 7)", () => {
    const cell = cellFor(
      row({ id: "j1", specFolder: "423-nb", steps: ["implement"], stepIndex: 0, state: "running" }),
      "423-nb",
      { lang: "nb" },
    );
    expect(cell).toContain("<h2>Avbryt implementering?</h2>");
    expect(cell).toContain(">OK</button>");
    expect(cell).toMatch(/<form method="dialog"><button class="btn" type="submit">Avbryt<\/button><\/form>/);
  });

  test("a running create still draws no dialog and no cancelform class (criterion 9)", () => {
    const html = renderQueueRows(
      [row({ id: "c1", specFolder: "423-create", steps: ["create"], stepIndex: 0, state: "running" })],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "423-create" }],
        filter: { open: "aide/423-create" },
      },
    );
    expect(html).not.toContain("confirmdialog");
    expect(html).not.toContain("cancelform");
  });
});
