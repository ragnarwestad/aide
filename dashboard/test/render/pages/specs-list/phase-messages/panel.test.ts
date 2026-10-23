import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView, type SpecsPageOptions } from "../../../../../src/render";
import type { JobStep } from "../../../../../src/render/pages/specs-list/phase-messages";
import { row } from "../../fixtures.ts";

// --- spec 500: what an unfolded phase draws ------------------------------

const FOLDER = "500-phase-messages";
const KEY = `aide/${FOLDER}`;
const finished = (id: string, step: string, at: string): QueueRowView =>
  row({
    id,
    specFolder: FOLDER,
    steps: [step],
    stepIndex: 0,
    state: "done",
    startedAt: at,
    results: [{ step, ok: true, costUsd: 1, terminalReason: "completed", at }],
  });

const render = (list: QueueRowView[], phaseMessages: SpecsPageOptions["phaseMessages"], step = "analyze", targets = [{ project: "aide", specFolder: FOLDER }]) =>
  renderSpecsRows(
    list,
    { runnerAvailable: true, targets, filter: { open: KEY, phases: `${KEY}:${step}` }, phaseMessages },
    Date.parse("2026-09-19T12:00:00Z"),
  );

describe("the message row", () => {
  test("the lookup gets the attempts' ids newest first and the step (AC-2)", () => {
    const seen: [string[], string][] = [];
    const older = finished("job-old", "analyze", "2026-09-19T09:00:00Z");
    const newer = finished("job-new", "analyze", "2026-09-19T10:00:00Z");
    const queued = row({ id: "job-queued", specFolder: FOLDER, steps: ["analyze"], stepIndex: 0, state: "queued", createdAt: "2026-09-19T11:00:00Z" });
    render([older, newer, queued], (ids, step) => {
      seen.push([ids, step]);
      return { logs: [{ by: "ai" as const, lines: [] }], steps: [], running: false };
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]![1]).toBe("analyze");
    expect(seen[0]![0]).toEqual(["job-queued", "job-new", "job-old"]);
  });
});

// The steps the attempt's log marked are listed above its Log, each with its time and tokens
// and unfolding to its own part of the Log.
describe("the steps above the Log", () => {
  const steps: JobStep[] = [
    { key: "Step 1 of 2", label: "Read the list", state: "done", seconds: 7, tokens: 12_345, logs: [{ by: "ai", lines: ["READ-LINE"] }] },
    { key: "Step 2 of 2", label: "Write the report", state: "running", since: "2026-09-19T11:59:30.000Z" },
  ];
  const draw = (extra: string[] = []) =>
    renderSpecsRows(
      [finished("job", "analyze", "2026-09-19T10:00:00Z"), finished("job-i", "implement", "2026-09-19T10:30:00Z")],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: FOLDER }],
        filter: { open: KEY, phases: [`${KEY}:analyze`, ...extra].join(",") },
        phaseMessages: () => ({ logs: [{ by: "ai", lines: ["THE-LOG-LINE"] }], steps, running: true }),
      },
      Date.parse("2026-09-19T12:00:00Z"),
    );

  test("each marked step is listed before the Log, with its tokens, and a running one counts from its start (AC-2, AC-3)", () => {
    const html = draw();
    expect(html).toContain("Read the list");
    expect(html).toContain("Write the report");
    expect(html.indexOf("Write the report")).toBeLessThan(html.indexOf("THE-LOG-LINE"));
    expect(html).toContain("12.3k");
    expect(html).toContain('data-elapsed="2026-09-19T11:59:30.000Z"');
  });

  test("a step unfolds to its own part of the Log by its key in the address, and shut it does not (AC-2)", () => {
    expect(draw([`${KEY}:analyze.0`])).toContain("READ-LINE");
    expect(draw()).not.toContain("READ-LINE");
  });

  test("only open phase-step logs carry their shared indent marker (AC-1, AC-2, AC-3)", () => {
    const html = draw([`${KEY}:analyze.0`, `${KEY}:implement`, `${KEY}:implement.0`]);
    const logs = html.match(/<tr class="phasemsgs"[^>]*>/g) ?? [];
    const stepLogs = logs.filter((tag) => tag.includes('data-msgs="Step 1 of 2"'));
    expect(stepLogs).toHaveLength(2);
    for (const tag of stepLogs) expect(tag).toContain('data-phasesteplog="1"');
    const phaseLogs = logs.filter((tag) => !stepLogs.includes(tag));
    expect(phaseLogs).toHaveLength(2);
    for (const tag of phaseLogs) expect(tag).not.toContain("data-phasesteplog");
    expect(html).toContain("12.3k");
    expect(html).toContain('data-elapsed="2026-09-19T11:59:30.000Z"');
  });

  test("every step line under an unfolded phase is marked as standing under a phase, whichever the phase (AC-1, AC-2)", () => {
    const html = renderSpecsRows(
      [finished("job-a", "analyze", "2026-09-19T10:00:00Z"), finished("job-i", "implement", "2026-09-19T10:30:00Z")],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: FOLDER }],
        filter: { open: KEY, phases: `${KEY}:analyze,${KEY}:implement` },
        phaseMessages: () => ({ logs: [{ by: "ai", lines: ["THE-LOG-LINE"] }], steps, running: true }),
      },
      Date.parse("2026-09-19T12:00:00Z"),
    );
    const stepLines = html.match(/<tr class="subrow"[^>]*data-jobstep="1"[^>]*>/g) ?? [];
    expect(stepLines).toHaveLength(4);
    for (const tr of stepLines) expect(tr).toContain('data-phasestep="1"');
  });
});
