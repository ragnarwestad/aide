import { describe, expect, test } from "bun:test";
import {
  renderSpecsRows,
  type QueueRowView,
  type SpecTarget,
  type SpecsFilter,
  type SpecsPageOptions,
} from "../../../../../src/render";
import { row } from "../../fixtures.ts";

// --- spec 500: a › on every phase that has run, and the address it keeps --

const FOLDER = "500-phase-messages";
const KEY = `aide/${FOLDER}`;
const done = (step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
  row({
    id: `job-${step}`,
    specFolder: FOLDER,
    steps: [step],
    stepIndex: 0,
    state: "done",
    results: [{ step, ok: true, costUsd: 1, terminalReason: "completed", at: "2026-09-19T10:00:00Z" }],
    ...extra,
  });

const target = (extra: Partial<SpecTarget> = {}): SpecTarget => ({ project: "aide", specFolder: FOLDER, ...extra });

const render = (list: QueueRowView[], filter: SpecsFilter = {}, targets = [target()], extra: Partial<SpecsPageOptions> = {}) =>
  renderSpecsRows(
    list,
    { runnerAvailable: true, targets, filter: { open: KEY, ...filter }, ...extra },
    Date.parse("2026-09-19T12:00:00Z"),
  );

const line = (html: string, step: string) =>
  html.match(new RegExp(`<tr class="subrow" data-step="${step}">[\\s\\S]*?</tr>`))?.[0] ?? "";
const firstCell = (html: string, step: string) => line(html, step).match(/<td class="phasecell" colspan="2">[\s\S]*?<\/td>/)?.[0] ?? "";
const foldLink = (cell: string) => cell.match(/<a class="fold[^"]*"[^>]*>/)?.[0] ?? "";

describe("the › on a phase line", () => {
  const list = [done("analyze")];

  test("shut: a link that adds the phase's key and keeps every other key of the view (AC-1)", () => {
    const html = render(list, { state: "all", project: "aide", sort: "cost", dir: "asc", checks: "aide/x", q: "phase" });
    const link = foldLink(firstCell(html, "analyze"));
    expect(link).toContain('aria-expanded="false"');
    expect(link).toContain(`phases=${encodeURIComponent(`${KEY}:analyze`)}`);
    for (const kept of ["state=all", "project=aide", "sort=cost", "dir=asc", "open=", "checks=", "q=phase"]) {
      expect(link).toContain(kept);
    }
  });

  test("open: aria-expanded true, an href that removes only its own key, one message row after the line (AC-1)", () => {
    const other = `${KEY}:implement`;
    const html = render(list, { phases: `${KEY}:analyze,${other}` }, [target()], { phaseMessages: () => ({ messages: ["hi"], running: false }) });
    const link = foldLink(firstCell(html, "analyze"));
    expect(link).toContain('aria-expanded="true"');
    expect(link).toContain(`phases=${encodeURIComponent(other)}`);
    expect(link).not.toContain(encodeURIComponent(`${KEY}:analyze`));
    expect(html.match(/<tr class="phasemsgs"/g)).toHaveLength(1);
    expect(html.indexOf('<tr class="phasemsgs"')).toBeGreaterThan(html.indexOf('data-step="analyze"'));
    expect(html.indexOf('<tr class="phasemsgs"')).toBeLessThan(html.indexOf('data-step="implement"'));
  });

  test("it is a plain link the script intercepts, so it works with the script off (AC-1)", () => {
    const link = foldLink(firstCell(render(list), "analyze"));
    expect(link).toMatch(/^<a /);
    expect(link).toContain("data-nav");
    expect(link).toMatch(/href="\/\?/);
  });

  test("a running phase, a failed one, a done one no job remembers and create each have one (AC-1)", () => {
    const running = row({ id: "job-run", specFolder: FOLDER, steps: ["implement"], stepIndex: 0, state: "running" });
    const failed = row({
      id: "job-fail",
      specFolder: FOLDER,
      steps: ["analyze"],
      stepIndex: 0,
      state: "failed",
      results: [{ step: "analyze", ok: false, costUsd: 0, terminalReason: "error", at: "2026-09-19T11:00:00Z" }],
    });
    const html = render([running, failed]);
    for (const step of ["create", "analyze", "implement"]) {
      expect([step, foldLink(firstCell(html, step)).includes("aria-expanded")]).toEqual([step, true]);
    }
    const forgotten = render([], {}, [target({ done: ["create", "analyze"] })]);
    for (const step of ["create", "analyze"]) {
      expect([step, foldLink(firstCell(forgotten, step)).includes("aria-expanded")]).toEqual([step, true]);
    }
  });

  test("no › on a phase nothing has touched or one only queued, and no row for such a key (AC-6)", () => {
    const queued = row({ id: "job-q", specFolder: FOLDER, steps: ["analyze", "implement"], stepIndex: 0, state: "queued" });
    const html = render([queued], { phases: `${KEY}:analyze,${KEY}:implement,${KEY}:nonsense` }, [target()], {
      phaseMessages: () => ({ messages: ["never"], running: false }),
    });
    expect(foldLink(firstCell(html, "analyze"))).toBe("");
    expect(foldLink(firstCell(html, "implement"))).toBe("");
    expect(html).not.toContain("phasemsgs");
    const untouched = render([], { phases: `${KEY}:analyze` });
    expect(untouched).not.toContain("phasemsgs");
  });
});
