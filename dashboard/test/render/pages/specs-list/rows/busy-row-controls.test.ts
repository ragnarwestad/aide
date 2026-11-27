import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type SpecsPageOptions, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import { row, openKeys } from "../../fixtures.ts";

// --- While a spec is busy, its row offers Cancel and nothing else ---
//
// Split out of row-status-and-controls.test.ts by theme.
//
// The row's controls used to be governed step by step: only
// the boxes the in-flight job named were disabled, and everything else on
// the row stayed live. Seen in practice — `implement`
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
// first place (its narrower promise is in
// collapsed-row.test.ts).
describe("a busy row offers only what its state allows", () => {
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

  /** The line an open row reveals under its header: the
   *  phase boxes, Run and Cancel are here, never in the header's cell —
   *  and the model and "also touches" too. */
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
   *  on it lives. */
  const openControls = (r: QueueRowView, folder = "105-busy") =>
    controlsLine(rows([r], [target(folder)]), folder);

  // --- Run, the model and the "more" fields lock too ------------

  test("a step waiting on its usage limit offers Cancel, and no Run", () => {
    const line = openControls({ ...spec("waiting"), stopReason: "provider-limit", usageLimitWait: { until: "2099-01-01T00:00:00Z", resetKnown: true } });
    expect(line).toContain("/api/queue/j1/cancel");
    expect(runBtn(line)).toBe("");
  });

  test("grouped queued and running jobs keep their ordinary busy controls (AC-4)", () => {
    for (const state of ["queued", "running"] as const) {
      const job = spec(state);
      const line = controlsLine(rows([job], [target("105-busy")], {
        executionGroups: [{
          id: "group-1", project: "aide", name: "Release", members: ["105-busy", "106-next"],
          branch: "group/release", state: "stopped", completedMembers: [], jobs: [],
        }],
      }), "105-busy");
      expect(line).toContain(">Cancel</button>");
      expect(runBtn(line)).toBe("");
      for (const step of ["analyze", "implement", "archive"])
        expect(box(line, step)).toContain("disabled");
    }
  });

  // --- A gate offers Approve and Cancel, and locks the rest -----

  // --- A settled spec is the ordinary row it always was ---------

  for (const state of ["done", "failed", "waiting", "cancelled"] as const) {
    test(`a ${state} spec's row is fully interactive again`, () => {
      const html = rows([spec(state)], [target("105-busy")]);
      const line = controlsLine(html, "105-busy");
      for (const step of ["analyze", "implement", "archive"]) {
        expect(box(line, step)).not.toContain("disabled");
      }
      expect(runBtn(line)).not.toContain("disabled");
      expect(html.match(/<select name="model\.analyze"[^>]*>/)![0]).not.toContain("disabled");
    });
  }

  test("a spec with no job at all is untouched by the rule", () => {
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
