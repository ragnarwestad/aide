import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import { row } from "../../fixtures.ts";

// --- spec 109: an expanded row reveals its controls BELOW the header ---------
//
// Split out of row-status-and-controls.test.ts by theme.
//
// Opening a row used to pile the run form, the Approve/Cancel form and
// the Merge button into the header's action cell, on top of whatever
// that cell already offered while shut. (Approve and Merge are gone
// since spec 149; what they did to the layout is why this exists.) The cell has no width of its
// own, so it wrapped — and the header line the reader was scanning
// moved down at the moment they acted on it.
//
// The header is the SAME line now, open or shut: its action cell always
// draws what a collapsed row draws. What opening reveals is a
// full-width row beneath it — the phase boxes, Run, and Cancel — built
// the way the phase lines already are, because a full-width row cannot
// widen a column it is not inside.
describe("spec 109: an expanded row reveals its controls below the header line", () => {
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
        projects: ["aide", "paceup"],
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const open = (folder: string) => ({ filter: { open: `aide/${folder}` } });

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** The line this spec adds: an open row's controls, under the header
   *  rather than inside it — everything an open row offers, since spec
   *  117 folded the rarely-set fields onto it too. */
  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the NAME cell — the head row's
   *  first — since 2026-09-07, when the pips came off the list and the
   *  button took their place at the end of the name box. It sat in the
   *  State cell beside the badge from spec 157 until then, and in the
   *  header's last cell (shut) or a spanning `stackcell` (open) before
   *  that, which is why this used to need the whole row group. */
  const actionCell = (chunk: string) => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    const cells = [...headRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[0] ?? "";
  };

  /** The two things a header row is ALLOWED to differ by, removed before
   *  the two renders are compared:
   *  1. the fold control itself, which exists to say which way it points
   *     (its class, `aria-expanded`, its title and the `?open=` it links to)
   *  2. the hidden `view.open` a form carries so pressing it keeps the
   *     reader's filter — a field with no width, and one a COLLAPSED row
   *     grows too the moment some OTHER row on the page is opened.
   *  What is left is every visible byte of the line, which is what "the
   *  header never changes when a row is expanded" is about. */
  /** ...and the ACTION CELL, the row's LAST: a shut row offers the one
   *  thing the spec waits on there, an open row offers its whole stack
   *  beside the phase lines instead, so that one cell is deliberately
   *  different open and shut. What must still hold is everything a
   *  reader scans — name, pips, state, started, cost — and it is the
   *  rest of the line that says so. */
  const stable = (line: string) =>
    line
      .replace(/<a class="fold[\s\S]*?<\/a>/, "")
      .replace(/<input type="hidden" name="view\.open"[^>]*>/g, "")
      .replace(/<td[^>]*>[\s\S]*?<\/td><\/tr>$/, "");

  const shutAndOpen = (list: QueueRowView[], targets: QueueTarget[], folder: string) => {
    const shut = stable(head(rows(list, targets), folder));
    const opened = stable(head(rows(list, targets, open(folder)), folder));
    expect(shut).not.toBe("");
    expect(opened).not.toBe("");
    return { shut, opened };
  };

  // --- criterion 1: the header line is the same line, open or shut ----------

  test("an idle spec's header row is byte-identical open or shut (criterion 1)", () => {
    const { shut, opened } = shutAndOpen([], [target("109-idle", { title: "Held still" })], "109-idle");
    expect(opened).toBe(shut);
  });

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec's header row is byte-identical open or shut (criterion 1)`, () => {
      const { shut, opened } = shutAndOpen(
        [row({ id: "j1", specFolder: "109-busy", state })],
        [target("109-busy")],
        "109-busy",
      );
      expect(opened).toBe(shut);
    });
  }

  test("a settled spec with an unmerged branch keeps its header line too (criterion 1)", () => {
    const { shut, opened } = shutAndOpen(
      [row({ id: "j1", specFolder: "109-merge", state: "done" })],
      [target("109-merge")],
      "109-merge",
    );
    expect(opened).toBe(shut);
  });

  // --- criterion 2: what opening actually reveals ---------------------------

  test("an opened idle row reveals its phase lines, and the button beside its state (criterion 2)", () => {
    const html = rows([], [target("109-idle")], open("109-idle"));
    const line = controlsLine(html, "109-idle");
    expect(line).toContain('name="steps" value="analyze"');
    // Spec 157: the button and the form it posts are in the header's
    // STATE cell; the boxes it posts are on the phase lines under it.
    const cell = actionCell(controlsLine(html, "109-idle"));
    expect(cell).toContain('<form id="rowrun-aide/109-idle" method="post" action="/api/queue"');
    expect(cell).toContain(">Analyze</button>");
    expect(cell).not.toContain('name="steps"');
    expect(line.replace(head(html, "109-idle"), "")).toContain('name="steps" value="analyze"');
  });

  test("a collapsed row emits no controls line at all (criterion 2)", () => {
    expect(rows([], [target("109-idle")])).not.toContain("data-controls");
  });

  // --- criteria 3-5: which control lands on which line ----------------------

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} spec offers Cancel beside its state (criterion 3)`, () => {
      const html = rows(
        [row({ id: "j1", specFolder: "109-busy", state })],
        [target("109-busy")],
        open("109-busy"),
      );
      const cell = actionCell(controlsLine(html, "109-busy"));
      expect(cell).toContain('action="/api/queue/j1/cancel"');
      // Exactly once on the page: the State cell is the one place a
      // row's action is drawn now (spec 157).
      expect(html.match(/action="\/api\/queue\/j1\/cancel"/g)).toHaveLength(1);
    });
  }

  // --- criterion 6: the order of the lines an open row grows ----------------

  test("the header comes first, then the phase lines, with nothing between (criterion 6)", () => {
    const html = rows([], [target("109-idle")], open("109-idle"));
    const at = (s: string) => html.indexOf(s);
    // Spec 117 folded "more" into the controls line rather than leaving
    // a second line under it; spec 124 folded the controls line itself
    // into the header's own cell. An open row is a header and its
    // phases, and nothing else.
    expect(html).not.toContain("data-more");
    expect(html).not.toContain("data-controls");
    expect(at('data-folder="109-idle"')).toBeLessThan(at('<tr class="subrow'));
  });

  // The line those fields lived on is gone (spec 124), and so is the
  // fixed-width cell that replaced it (spec 157). What still has to
  // hold is the thing the width was FOR: nothing a row happens to
  // offer may shove the table sideways. The State cell's badge and
  // button share the page's own `row` container, which wraps — so a
  // long pairing becomes two lines instead of a wider column.
  test("the pairing they moved into wraps rather than widening the table", async () => {
    const { CSS } = await import("../../../../../src/render/ui/css.ts");
    expect(CSS).not.toContain("data-more");
    expect(CSS).not.toContain("data-controls");
    expect(CSS).not.toContain("stackcell");
    expect(CSS.match(/\n\.row \{[^}]*\}/)![0]).toContain("flex-wrap: wrap");
  });

  // `.row` on its own is block-level `flex`, which would put the
  // rarely-set fields on a line directly UNDER the run form — the
  // two-line shape spec 117 exists to remove, rebuilt in CSS. They
  // have to sit BESIDE it, which is what `inline-flex` buys.
  test("the rarely-set fields sit beside the run form, not under it (spec 117)", async () => {
    const { CSS } = await import("../../../../../src/render/ui/css.ts");
    const rule = CSS.match(/\n\.extra \{[^}]*\}/)![0];
    expect(rule).toContain("display: inline-flex");
    expect(rule).toContain("font-size: var(--fs-s)");
  });
});
