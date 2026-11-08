import { describe, expect, test } from "bun:test";
import { phasesFor, renderSpecsRows, type QueueRowView, type SpecsPageOptions, type StepResultView } from "../../../../../src/render";
import { sideRunOf, sideState } from "../../../../../src/render/pages/specs-list/phase-messages/side-lines.ts";
import { row } from "../../fixtures.ts";

const FOLDER = "500-side-lines";
const KEY = `aide/${FOLDER}`;
const NOW = Date.parse("2026-09-19T12:00:00Z");

const implemented = (result: Partial<StepResultView>, id = "job"): QueueRowView =>
  row({
    id, specFolder: FOLDER, steps: ["implement"], stepIndex: 0, state: "done", startedAt: "2026-09-19T10:00:00Z",
    results: [{ step: "implement", ok: true, costUsd: 0.35, tokens: 24160, ...result }],
  });
const REVIEW = { outcome: "completed", tool: "claude", durationSec: 41, costUsd: 0.05, tokens: 4930 };
const VERIFY = { outcome: "completed", tool: "codex", durationSec: 22, tokens: 9562 };

const implementPhase = (jobs: QueueRowView[]) => phasesFor(jobs, undefined).find((p) => p.step === "implement")!;

describe("what a side line takes from the newest implement attempt", () => {
  test("the review's figures and a done state (AC-1)", () => {
    const run = sideRunOf(implementPhase([implemented({ review: REVIEW, verify: VERIFY })]), "review");
    expect(run).toEqual(REVIEW);
    expect(sideState(run!)).toBe("done");
  });

  test("the verification's own figures (AC-2)", () => {
    const run = sideRunOf(implementPhase([implemented({ review: REVIEW, verify: VERIFY })]), "verify");
    expect(run).toEqual(VERIFY);
  });

  test("a session that did not complete reads as failed (AC-1)", () => {
    expect(sideState({ outcome: "cli-error" })).toBe("failed");
    expect(sideState({ outcome: "timeout" })).toBe("failed");
  });

  test("nothing when the step ran without the session, or has no result yet (AC-6)", () => {
    expect(sideRunOf(implementPhase([implemented({})]), "review")).toBeUndefined();
    expect(sideRunOf(implementPhase([implemented({ review: REVIEW })]), "verify")).toBeUndefined();
    const running = row({ id: "r", specFolder: FOLDER, steps: ["implement"], stepIndex: 0, state: "running" });
    expect(sideRunOf(implementPhase([running]), "review")).toBeUndefined();
  });

  test("the newest attempt speaks, not an older one (AC-1)", () => {
    const older = implemented({ review: REVIEW }, "old");
    const newer = { ...implemented({}, "new"), startedAt: "2026-09-19T11:00:00Z" };
    expect(sideRunOf(implementPhase([older, newer]), "review")).toBeUndefined();
  });
});

describe("the fold on a side line", () => {
  const draw = (jobs: QueueRowView[], phases: string[], sideMessages: SpecsPageOptions["sideMessages"]) =>
    renderSpecsRows(
      jobs,
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: FOLDER }],
        modelChoices: [{ name: "Claude", tool: "claude" as const }],
        filter: { open: KEY, phases: phases.join(",") },
        sideMessages,
      },
      NOW,
    );
  const sideLine = (html: string, part: string) =>
    html.match(new RegExp(`<tr class="subrow" data-side="${part}">[\\s\\S]*?</tr>`))?.[0] ?? "";
  const own = (text: string): SpecsPageOptions["sideMessages"] => () => ({ logs: [{ by: "ai", lines: [text] }], steps: [], running: false });

  test("folded out, the line shows what sideMessages returned for its own session (AC-3)", () => {
    const seen: string[] = [];
    const html = draw([implemented({ review: REVIEW, verify: VERIFY })], [`${KEY}:implement.review`], (_ids, part) => {
      seen.push(part);
      return { logs: [{ by: "ai", lines: ["REVIEW-OWN-LINE"] }], steps: [], running: false };
    });
    expect(html).toContain("REVIEW-OWN-LINE");
    expect(seen).toEqual(["review"]);
  });

  test("folded in, the line links to the key that folds it out and shows no log (AC-3)", () => {
    const html = draw([implemented({ review: REVIEW })], [], own("REVIEW-OWN-LINE"));
    expect(html).not.toContain("REVIEW-OWN-LINE");
    expect(decodeURIComponent(sideLine(html, "review"))).toContain(`${KEY}:implement.review`);
  });

  test("a session that did not run offers no fold, even with its key in the address (AC-6)", () => {
    const html = draw([implemented({})], [`${KEY}:implement.review`], own("REVIEW-OWN-LINE"));
    expect(html).not.toContain("REVIEW-OWN-LINE");
    expect(decodeURIComponent(sideLine(html, "review"))).not.toContain("implement.review");
    expect(sideLine(html, "review")).toContain('name="model.review"');
  });
});
