import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView, type SpecsPageOptions } from "../../../../../src/render";
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
      return { logs: [{ by: "ai" as const, lines: [] }], running: false };
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]![1]).toBe("analyze");
    expect(seen[0]![0]).toEqual(["job-queued", "job-new", "job-old"]);
  });
});
