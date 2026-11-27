import { describe, expect, test } from "bun:test";
import { t } from "../../../../../src/i18n";
import { renderSpecsRows, type SpecsPageOptions, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import { row, specTarget, openRowsAt } from "../../fixtures.ts";

// Split out of row-status-and-controls.test.ts by theme: the rest of
// "a spec's row runs its own phases" that is not about ticking/locking
// a box (that half is phase-box-locking.test.ts) — the gate control,
// the model dropdown, folding, the row's own summary, and the two
// specs about a busy job and the State line.
describe("a spec's row runs its own phases", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "94-row-runs-it", steps: [step], stepIndex: 0, state: "done", ...extra });

  const target = specTarget;

  const rows = openRowsAt("2026-08-18T12:00:00Z");

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>\\s*<tr class="specstate".*?</tr>`))?.[0] ?? "";

  // The row carries no title, phase or percentage: the percentage counted the checkbox rows
  // the implement step ticks, so it read 0 with analyze finished and
  // 90-something the moment implement ended, never
  // anything between — while the pips already say how far the spec has
  // got and the State column says what is happening now.
  // What is left of the spec's own files on this line is what it
  // depends on, and THAT still has to come from this row's own target,
  // which is what this test was written for and still proves. The
  // percentage's absence is proved end to end from a real 4-status.md
  // by queue-routes.test.ts, "a spec's progress stays off its row".
  test("a row's summary comes from its OWN target", () => {
    const html = rows(
      [job("j1", "analyze")],
      [
        target("94-other", {
          title: "Another spec",
          phase: "Phase 1: RED",
          dependsOn: ["12-other-dep"],
        }),
        target("94-row-runs-it", {
          title: "Row runs it",
          phase: "Phase 2: GREEN",
          dependsOn: ["165-own-dep"],
        }),
      ],
    );
    const line = head(html, "94-row-runs-it");
    expect(line).toContain("Depends on: aide:165");
    expect(line).not.toContain("Depends on: aide:12");
    // No percentage on the row at all any more — neither this spec's
    // nor another's.
    expect(line).not.toContain("% done");
    // The row's name is its OWN spec's title — the point of this test:
    // the other spec's title, and both specs' phases, stay off it.
    expect(line).toContain("Row runs it");
    expect(line).not.toContain("Another spec");
    expect(line).not.toContain("Phase 2: GREEN");
    expect(line).not.toContain("Phase 1: RED");
  });
});

// --- The first line says what is happening, or what is next --------
//
// The badge names active work, automatic waiting, or the resting state.
// Automatic waiting uses Queued, with a position when one is known.

describe("the State line says what is happening, or what is next", () => {
  const target = specTarget;
  const rows = (list: QueueRowView[], targets: SpecTarget[] = [], opts: Partial<SpecsPageOptions> = {}) =>
    renderSpecsRows(
      list,
      { runnerAvailable: true, targets, ...opts },
      Date.parse("2026-08-20T12:00:00Z"),
    );
  const chip = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = head.match(/<td[^>]*data-col="state"[\s\S]*?<\/td>/)?.[0] ?? "";
    return state.match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
  };
  const chipTitle = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = head.match(/<td[^>]*data-col="state"[\s\S]*?<\/td>/)?.[0] ?? "";
    return state.match(/<span class="badge b-[a-z]+" title="([^"]*)"/)?.[1] ?? "";
  };

  test("a queued job without a position uses the shared Queued label (AC-3, AC-7)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "132-a", steps: ["implement"], stepIndex: 0, state: "queued" })],
      [target("132-a")],
    );
    expect(chip(html)).toBe(t("en", "list.state.queued"));
  });

  // A row that carries its place in the queue says so in the
  // State column. "Queued", not the step's own verb: "Implementing 7/11"
  // read as a step under way for a job still waiting its turn — the pips
  // already say which phase it waits for. No hover text: it said nothing
  // the word and the number do not, and a phone has no hover.
  test("a queued job shows its queue position", () => {
    const html = rows(
      [
        row({
          id: "j1",
          specFolder: "132-a",
          steps: ["implement"],
          stepIndex: 0,
          state: "queued",
          queuePosition: { n: 7, total: 11 },
        }),
      ],
      [target("132-a")],
    );
    expect(chip(html)).toBe("Queued 7/11");
    expect(chipTitle(html)).toBeFalsy();
  });
});
