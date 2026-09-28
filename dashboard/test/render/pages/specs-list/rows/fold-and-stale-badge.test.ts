import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import { row, openKeys } from "../../fixtures.ts";

// Split out of grouping.test.ts by theme.

// Spec 97: the row says when the plan describes an older problem than
// the description does. Nothing is blocked — a person who knows the
// edit was cosmetic can still start `implement`; the page just stops
// pretending the plan is current.
describe("the description-changed badge (criteria 1, 3)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "97-stale", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // The badge sits on the analyze PHASE LINE, which a collapsed row
  // does not draw at all — so every example here opens its spec.
  const rows = (list: QueueRowView[], targets: SpecTarget[]) =>
    renderSpecsRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-18T12:00:00Z"),
    );

  /** The line the phase boxes are on, under the header (spec 109). */
  const runLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  // The path every example in the ticket takes: 93, 94 and 96 had all
  // actually run an analyze, so a badge wired only into `emptyGroup`
  // would never fire for any of them.
  test("a spec with job history carries it on the analyze line (criterion 1)", () => {
    const html = rows([job("j1", "analyze")], [target("97-stale", { analyzeStale: true })]);
    expect(subRow(html, "analyze")).toContain("Description changed since");
    for (const phase of ["implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("Description changed since");
    }
  });

  test("a spec nothing has run carries it too (criterion 1)", () => {
    const html = rows([], [target("97-never-run", { analyzeStale: true })]);
    expect(subRow(html, "analyze")).toContain("Description changed since");
  });

  test("a spec whose description has not moved carries nothing (criterion 4)", () => {
    const html = rows([job("j1", "analyze")], [target("97-stale")]);
    expect(html).not.toContain("Description changed since");
  });

  // `done` is what the server has already stripped `analyze`
  // out of; the row's job is to pre-tick the first phase
  // that is left, which is analyze — not implement.
  test("analyze is pre-ticked again, not implement (criterion 3)", () => {
    const html = rows(
      [job("j1", "analyze"), job("j2", "implement")],
      [target("97-stale", { analyzeStale: true, done: ["implement"] })],
    );
    const line = runLine(html, "97-stale");
    expect(line).toMatch(/value="analyze" checked/);
    // `implement` has run: its box can be ticked for another run, but a
    // press does not run it again unless the reader ticks it.
    expect(line).toMatch(/name="steps" value="implement"/);
    expect(line).not.toMatch(/value="implement" checked/);
    // `analyze` and `archive` are what is left to run, so both are
    // pre-ticked (spec 200); `create`'s box carries no field name.
    expect([...line.matchAll(/name="steps" value="[^"]*" checked/g)]).toHaveLength(2);
  });
});
