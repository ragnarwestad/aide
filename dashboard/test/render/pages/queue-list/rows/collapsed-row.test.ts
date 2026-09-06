import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import { row } from "../../fixtures.ts";

// --- spec 103: a collapsed row shows status only -----------------------------
//
// Split out of row-status-and-controls.test.ts by theme.
//
// Folding used to remove the four phase LINES and nothing else: the
// collapsed row still carried the phase checkboxes, the model dropdown,
// "more" and the Run button, so a list of collapsed rows was still a
// wall of controls and folding said nothing about what it was FOR.
// A collapsed row now says what the spec IS and what state it is in,
// and offers at most the one thing it needs from the reader right now
// (Approve while a gate waits, Merge while a branch waits). Everything
// else belongs to the expanded row, which is what it always was.
describe("spec 103: a collapsed row shows status only", () => {
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
      Date.parse("2026-08-19T12:00:00Z"),
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
   *  THIRD — since spec 157, open or shut alike. It was the header's
   *  last cell for a shut row and a spanning `stackcell` for an open
   *  one, which is why this used to need the whole row group. */
  const actionCell = (chunk: string) => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[1] ?? "";
  };

  const open = (folder: string) => ({ filter: { open: `aide/${folder}` } });

  // Spec 157 gave the press itself back to the collapsed row — a
  // reader should not have to open a row to start what its state line
  // just named. What folding still takes away is everything that is
  // about CHOOSING: the phase boxes, the model pickers, the other
  // repos. One button, named for what it would run, and nothing else.
  test("a collapsed row carries the press and none of the choosing (criterion 1)", () => {
    const line = head(rows([], [target("103-idle")]), "103-idle");
    expect(line).not.toBe("");
    expect(line).toContain(">Analyze</button>");
    expect(line).not.toContain('type="checkbox"');
    expect(line).not.toContain('name="model"');
    expect(line).not.toContain('name="extraProjects"');
    expect(line).not.toContain('class="more"');
  });

  test("a collapsed row keeps its name, status, pips, started and cost (criterion 1)", () => {
    const line = head(
      rows(
        [row({ id: "j1", specFolder: "103-idle", state: "done", spentUsd: 1.5,
               startedAt: "2026-08-19T09:00:00Z" })],
        [target("103-idle", { title: "Status only", phase: "Phase 3" })],
      ),
      "103-idle",
    );
    // The spec's own title is what the line says now — the folder name
    // is the identifier, and lives in the link's href and its tooltip.
    expect(line).toContain("Status only");
    expect(line).toContain("103-idle");
    expect(line).not.toContain("% done");
    // Spec 132: the badge says the resting state — one word since
    // 2026-08-24; the button beside it is what names the next phase.
    expect(line).toContain('class="badge b-ready"');
    expect(line).toContain(">ready<");
    expect(line).toContain('class="pips"');
    expect(line).toContain("$1.50");
  });

  // Spec 132 took Merge back out of the row: the State column already
  // says "ready to merge the code", and acting means opening the panel,
  // the same as every other action a collapsed row does not draw.
  test("a collapsed row with an unmerged branch offers no Merge at all (spec 132)", () => {
    const cell = actionCell(
      controlsLine(
        rows([row({ id: "j1", specFolder: "103-merge", state: "done" })], [target("103-merge")]),
        "103-merge",
      ),
    );
    // The row still offers its own next phase (spec 157) — what it
    // does not offer, in any state, is a way to land the branch.
    expect(cell).not.toContain("/merge");
    expect(cell).not.toContain("Merge");
  });

  // Spec 103 sent a reader to the open row to cancel; spec 157 brings
  // the press back, because the State cell says "implementing" and the
  // one thing to do about that is stop it.
  test("a running collapsed row cancels the step it names (criterion 4)", () => {
    const cell = actionCell(
      controlsLine(rows([row({ id: "j1", specFolder: "103-busy", state: "running" })], [target("103-busy")]),
           "103-busy"),
    );
    expect(cell).toContain('action="/api/queue/j1/cancel"');
    expect(cell).toContain(">Cancel</button>");
    // And nothing else: one control, never two.
    expect(cell.match(/<button/g)).toHaveLength(1);
  });

  // Spec 105, criterion 1b: the branch a previous job left behind does
  // not make a busy row actionable. Merge while a step is still writing
  // to that very branch is the press the queue refuses — the collapsed
  // row offers it no more than the open one does. Cancel stays where
  // spec 103 put it: one click away, by opening the row.
  test("a busy collapsed row with an unmerged branch offers no Merge either (spec 105)", () => {
    for (const state of ["queued", "running"] as const) {
      const cell = actionCell(
        controlsLine(
          rows([row({ id: "j1", specFolder: "103-busy-branch", state })], [target("103-busy-branch")]),
          "103-busy-branch",
        ),
      );
      expect(cell).not.toContain("mergeform");
      expect(cell).not.toContain("/merge");
      // Cancel and only Cancel, as on the open row.
      expect(cell.match(/<button/g)).toHaveLength(1);
      expect(cell).toContain("/cancel");
    }
  });

  // "Nothing pending" is not the same question since spec 157: a spec
  // with a phase still ahead of it always has a press to offer. And
  // since 2026-08-21 there is always one: a row that exists is a spec
  // that is not archived, so `archive` is what a spec that has run
  // everything else is still waiting for. Criterion 4's empty cell
  // describes a state the list cannot hold — a spec whose archive
  // really finished has no row.
  test("a collapsed row that has run everything still offers Archive (criterion 4)", () => {
    const done = ["analyze", "implement", "archive"];
    const cell = actionCell(controlsLine(rows([], [target("103-idle", { done })]), "103-idle"));
    expect(cell).toContain(">Archive</button>");
    expect(cell).not.toContain('type="checkbox"');
  });

  test("with no open parameter at all, no row draws a phase line (criterion 7)", () => {
    const html = rows(
      [
        row({ id: "j1", specFolder: "103-a", state: "done" }),
        row({ id: "j2", specFolder: "103-b", state: "running" }),
      ],
      [target("103-a"), target("103-b"), target("103-c")],
    );
    // Every row still offers its own one press (spec 157) — what none
    // of them offers is a box to tick or a model to pick.
    expect(html).not.toContain('<tr class="subrow');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('name="model.');
  });

  test("expanding a row reveals every control the page has always had (criterion 5)", () => {
    const html = rows([], [target("103-idle")], {
      ...open("103-idle"),
      projects: ["aide", "paceup"],
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    const line = controlsLine(html, "103-idle");
    expect(line).toContain('<form id="rowrun-aide/103-idle" method="post" action="/api/queue"');
    expect(line).toContain('name="steps" value="analyze"');
    expect(line).toContain(">Analyze</button>");
    // The button is in the header's State cell since spec 157; the
    // boxes are on the phase lines below it.
    expect(actionCell(controlsLine(html, "103-idle"))).toContain(">Analyze</button>");
    expect(
      html.match(/<tr class="subrow[^"]*"[^>]*data-step="analyze">[\s\S]*?<\/tr>/)![0],
    ).toContain('name="steps" value="analyze"');
    // The model went with the rest of them, onto the phase lines it
    // belongs to (spec 123) — still revealed by opening, one per phase.
    expect(html).toContain('name="model.analyze"');
    // Four phase lines, plus the caption line above them.
    expect(html.match(/<tr class="subrow/g)).toHaveLength(5);
  });

  test("an expanded row's forms carry the open key forward (criterion 6)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "103-running", state: "running" })],
      [target("103-running")],
      open("103-running"),
    );
    // The stack, on the line it leads — an open row's buttons are not
    // in the header cell any more (2026-08-19).
    const line = controlsLine(html, "103-running");
    expect(line).toContain('<input type="hidden" name="view.open" value="aide/103-running">');
    // Cancel is on the controls line the open row reveals (spec 109),
    // carrying the same key. It is the whole of that form since spec
    // 149 — Approve stood beside it until then.
    const cancel = line.match(
      /<form method="post" action="\/api\/queue\/j1\/cancel"[^>]*>.*?<\/form>/,
    )![0];
    expect(cancel).toContain('name="view.open" value="aide/103-running"');
  });

  test("no 'more' disclosure survives, open or shut (criterion 10)", () => {
    for (const html of [
      rows([], [target("103-idle")], { projects: ["aide", "paceup"] }),
      rows([], [target("103-idle")], {
        ...open("103-idle"),
        projects: ["aide", "paceup"],
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
      }),
    ]) {
      // Scoped to the list: the "?" popover above it is a `<details>`
      // of its own (spec 113), about how runs work, not about a row.
      const table = html.match(/<table class="list speclist">[\s\S]*<\/table>/)?.[0] ?? "";
      expect(table).not.toBe("");
      expect(table).not.toContain("data-more");
      expect(table).not.toContain('class="more"');
      expect(table).not.toContain("<summary");
    }
  });
});
