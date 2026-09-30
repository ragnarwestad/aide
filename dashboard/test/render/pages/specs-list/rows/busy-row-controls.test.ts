import { describe, expect, test } from "bun:test";
import {
  renderSpecsRows,
  type SpecsPageOptions,
  type QueueRowView,
  type SpecTarget,
} from "../../../../../src/render";
import { ICON_LOCK } from "../../../../../src/render/ui/components";
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
  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (list: QueueRowView[], targets: SpecTarget[] = [], opts: Partial<SpecsPageOptions> = {}) =>
    renderSpecsRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        modelChoices: [{ name: "sonnet" }],
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

  /** A posting form on the open row, by the verb it posts to. */
  const control = (cell: string, verb: string) =>
    cell.match(new RegExp(`<form [^>]*action="/api/queue/j1/${verb}"[\\s\\S]*?</form>`))?.[0] ?? "";

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec's opened row offers Cancel, and nothing else it can press (criterion 1)`, () => {
      // Since spec 124 the buttons never come and go — a row's stack is
      // the same buttons throughout, and its STATE says which of them
      // will take a click. Since spec 149 Cancel is the only one in it
      // at all: Approve went with the stop between steps, Merge with
      // the hand merge.
      const cell = openControls(spec(state));
      // Cancel is a button naming its dialog, whose OK posts the cancel.
      const cancel = cell.match(/<button [^>]*data-ask="cancelask-j1"[^>]*>/)?.[0] ?? "";
      expect(cancel).not.toBe("");
      expect(cancel).not.toContain("disabled");
      expect(control(cell, "cancel")).not.toBe("");
      expect(control(cell, "approve")).toBe("");
      expect(control(cell, "merge")).toBe("");
    });
  }

  // --- criterion 2: every phase box locks, with the reason on it -------------

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec locks every phase box, not the ones its job named (criterion 2)`, () => {
      const line = openControls(spec(state));
      const verb = state === "running" ? "running" : "queued";
      for (const step of ["analyze", "implement", "archive"]) {
        expect(box(line, step)).toContain("disabled");
        // Spec 454: the reason is not the box's own `title`.
        expect(box(line, step)).not.toContain(`title="Implement is ${verb}"`);
      }
    });
  }

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
    renderSpecsRows(
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
    const html = renderSpecsRows(
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
