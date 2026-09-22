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
const panel = (html: string) => html.match(/<tr class="phasemsgs"[\s\S]*?<\/tr>/)?.[0] ?? "";

describe("the message row", () => {
  test("the lookup gets the attempts' ids newest first and the step (AC-2)", () => {
    const seen: [string[], string][] = [];
    const older = finished("job-old", "analyze", "2026-09-19T09:00:00Z");
    const newer = finished("job-new", "analyze", "2026-09-19T10:00:00Z");
    const queued = row({ id: "job-queued", specFolder: FOLDER, steps: ["analyze"], stepIndex: 0, state: "queued", createdAt: "2026-09-19T11:00:00Z" });
    render([older, newer, queued], (ids, step) => {
      seen.push([ids, step]);
      return { messages: [], running: false };
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]![1]).toBe("analyze");
    expect(seen[0]![0]).toEqual(["job-queued", "job-new", "job-old"]);
  });

  test("the messages are printed as given, escaped once and neither raw nor twice (AC-2)", () => {
    const html = panel(render([finished("j", "analyze", "2026-09-19T09:00:00Z")], () => ({
      messages: ["&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;"],
      running: false,
    })));
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;");
    expect(html).not.toContain("&amp;lt;");
    expect(html).not.toContain("<b>x");
  });

  test("the messages come in the order given, one per item (AC-2)", () => {
    const html = panel(render([finished("j", "analyze", "2026-09-19T09:00:00Z")], () => ({ messages: ["first", "second"], running: false })));
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  });

  test("a step on the Logs tab gets a link to it (AC-5)", () => {
    const html = panel(render([finished("j", "analyze", "2026-09-19T09:00:00Z")], () => ({ messages: ["hi"], step: "2", running: false })));
    expect(html).toContain(`href="/specs/aide/${FOLDER}?tab=steps&amp;step=2"`);
  });

  test("a phase whose job is forgotten says so and links to the tab without a step (AC-5)", () => {
    const html = panel(render([], () => undefined, "analyze", [{ project: "aide", specFolder: FOLDER, done: ["analyze"] } as never]));
    expect(html).toContain("No messages are kept for this phase.");
    expect(html).toContain(`href="/specs/aide/${FOLDER}?tab=steps"`);
    expect(html).not.toContain("step=");
  });

  test("a running phase with no message yet says so and links to the live step (AC-3)", () => {
    const running = row({ id: "job-r", specFolder: FOLDER, steps: ["analyze"], stepIndex: 0, state: "running" });
    const html = panel(render([running], () => ({ messages: [], step: "live", running: true })));
    expect(html).toContain("Nothing has been captured from this step yet.");
    expect(html).toContain("step=live");
  });

  test("a message row keeps to its box: it wraps and never widens the page (AC-1)", () => {
    // Class exists in the stylesheet with wrapping text; the browser case in
    // test/e2e/phone-phase-line.test.ts checks it at a phone's width.
    // Seven since the chevron took a column of its own (2026-09-22).
    expect(panel(render([finished("j", "analyze", "2026-09-19T09:00:00Z")], () => ({ messages: ["x"], running: false })))).toContain('colspan="7"');
  });
});
