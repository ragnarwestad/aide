// The sentences a used-up usage limit puts on a job: the stopped job
// that starts again by itself, and the jobs held behind it. The sentence
// is built at render time from the job's own record, so the time reads
// in the reader's language and zone.

import { describe, expect, test } from "bun:test";
import { specNotice } from "../../../../src/render/ui/job-state";
import { usageLimitText } from "../../../../src/render/ui/job-state/provider-limit.ts";
import { runOnAccountButtons } from "../../../../src/render/ui/job-state/run-on-account.ts";
import { renderJobFollowParts } from "../../../../src/render/pages/job-page";
import type { QueueRowView } from "../../../../src/render";
import { row } from "../../pages/fixtures.ts";

const NOW = Date.parse("2026-08-16T01:15:00Z");
const TZ = "UTC";

const stoppedView = (over: Partial<QueueRowView> = {}): QueueRowView =>
  row({
    steps: ["implement"],
    state: "stopped",
    stopReason: "provider-limit",
    model: "opus",
    error: "the run's own error text",
    usageLimitWait: { until: "2026-08-16T05:00:00.000Z", resetKnown: true },
    results: [{
      step: "implement", ok: false, costUsd: 0, costMeasured: true, terminalReason: "provider-limit",
      providerLimit: { tool: "claude", window: "five_hour", resetsAt: "2026-08-16T05:00:00.000Z" },
    }],
    ...over,
  });

const heldView = (key: string, values: Record<string, string>): QueueRowView =>
  row({
    steps: ["implement"], state: "queued", errorReason: "held-back",
    error: { key: key as never, values },
  });

describe("the stopped job", () => {
  test("names the AI, the window, the step and the time it starts (AC-7)", () => {
    const text = usageLimitText(stoppedView(), "en", NOW, TZ)!;
    expect(text).toContain("Claude");
    expect(text).toContain("the five-hour limit");
    expect(text).toContain("Implement");
    expect(text).toContain("05:00");
  });

  test("says the usage limit when the AI named no window (AC-7)", () => {
    const view = stoppedView({
      results: [{
        step: "implement", ok: false, costUsd: 0, costMeasured: true, terminalReason: "provider-limit",
        providerLimit: { tool: "claude", window: "provider" },
      }],
    });
    const text = usageLimitText(view, "en", NOW, TZ)!;
    expect(text).toContain("the usage limit");
    expect(text).not.toContain("five-hour");
  });

  test("with no reset time says the AI did not say, and names the time the board tries again (AC-9)", () => {
    const view = stoppedView({ usageLimitWait: { until: "2026-08-16T02:10:00.000Z", resetKnown: false } });
    const text = usageLimitText(view, "en", NOW, TZ)!;
    expect(text).toContain("did not say");
    expect(text).toContain("02:10");
  });

  test("a stopped job with no wait gets no sentence from here", () => {
    expect(usageLimitText(stoppedView({ usageLimitWait: undefined }), "en", NOW, TZ)).toBeUndefined();
  });

  test("the time reads in the reader's language (AC-7)", () => {
    const nb = usageLimitText(stoppedView({ usageLimitWait: { until: "2026-08-17T05:00:00.000Z", resetKnown: true } }), "nb", NOW, TZ)!;
    const en = usageLimitText(stoppedView({ usageLimitWait: { until: "2026-08-17T05:00:00.000Z", resetKnown: true } }), "en", NOW, TZ)!;
    expect(nb).not.toBe(en);
    expect(nb).not.toContain("2026-08-17T");
  });
});

describe("a job held behind it", () => {
  test("says it waits for the AI's usage limit and when it starts (AC-8)", () => {
    const text = usageLimitText(heldView("runner.usageLimitHeld", { tool: "claude", at: "2026-08-16T05:00:00.000Z" }), "en", NOW, TZ)!;
    expect(text).toContain("Claude");
    expect(text).toContain("05:00");
    expect(text).not.toContain("2026-08-16T");
  });

  test("with no reset time says the AI did not say, and when the board tries again (AC-9)", () => {
    const text = usageLimitText(heldView("runner.usageLimitHeldNoReset", { tool: "codex", at: "2026-08-16T02:10:00.000Z" }), "en", NOW, TZ)!;
    expect(text).toContain("Codex");
    expect(text).toContain("did not say");
    expect(text).toContain("02:10");
  });

  test("while the probe runs says when the board tried again (AC-9)", () => {
    const text = usageLimitText(heldView("runner.usageLimitHeldProbe", { tool: "claude", at: "2026-08-16T02:10:00.000Z" }), "en", NOW, TZ)!;
    expect(text).toContain("did not say");
    expect(text).toContain("02:10");
  });

  test("a job held for any other reason gets no sentence from here", () => {
    expect(usageLimitText(heldView("runner.notAnalyzed", {}), "en", NOW, TZ)).toBeUndefined();
  });
});

describe("the sentences ask for no press", () => {
  test("not the stopped job's, nor a held job's (AC-10)", () => {
    const all = [
      usageLimitText(stoppedView(), "en", NOW, TZ)!,
      usageLimitText(stoppedView({ usageLimitWait: { until: "2026-08-16T02:10:00.000Z", resetKnown: false } }), "en", NOW, TZ)!,
      usageLimitText(heldView("runner.usageLimitHeld", { tool: "claude", at: "2026-08-16T05:00:00.000Z" }), "en", NOW, TZ)!,
      usageLimitText(heldView("runner.usageLimitHeldNoReset", { tool: "claude", at: "2026-08-16T05:00:00.000Z" }), "en", NOW, TZ)!,
      usageLimitText(heldView("runner.usageLimitHeldProbe", { tool: "claude", at: "2026-08-16T05:00:00.000Z" }), "en", NOW, TZ)!,
    ];
    for (const text of all) expect(text.toLowerCase()).not.toContain("press");
  });
});

describe("where the sentence is drawn", () => {
  test("the row's notice shows the stopped job's sentence in place of the run's own error", () => {
    const view = stoppedView({ usageLimitWait: { until: new Date(Date.now() + 3_600_000).toISOString(), resetKnown: true } });
    const notice = specNotice(view);
    expect(notice?.text).toContain(usageLimitText(view, "en", Date.now())!);
    expect(notice?.text).not.toContain("the run's own error text");
  });

  test("a held job's row reads as information, not as a warning", () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const notice = specNotice(heldView("runner.usageLimitHeld", { tool: "claude", at }));
    expect(notice?.variant).toBe("info");
    expect(notice?.text).toContain(usageLimitText(heldView("runner.usageLimitHeld", { tool: "claude", at }), "en", Date.now())!);
  });

  test("the job page's banner shows the same sentence, for a stopped job and for a held one", () => {
    const stopped = stoppedView();
    const held = heldView("runner.usageLimitHeld", { tool: "claude", at: "2026-08-16T05:00:00.000Z" });
    for (const view of [stopped, held]) {
      const html = renderJobFollowParts({ ...view, results: view.results ?? [] } as never, { now: NOW, lang: "en" });
      const unescaped = html.replace(/&#39;|&#x27;/g, "'");
      expect(unescaped).toContain(usageLimitText(view, "en", NOW)!.replace(/^./, (c) => c.toUpperCase()));
    }
  });
});

describe("a step that ran on another Claude account", () => {
  const onWork = (over: Partial<QueueRowView> = {}): QueueRowView =>
    stoppedView({ claudeAccount: "Work", runOnAccounts: ["Default", "Spare"], ...over });

  test("the stopped sentence names the account after the model (AC-8)", () => {
    expect(usageLimitText(onWork(), "en", NOW, TZ)).toContain("Claude (opus) on Work");
  });

  test("the held sentence names the account the hold is for (AC-8)", () => {
    const held = heldView("runner.usageLimitHeld", { tool: "claude", at: "2026-08-16T05:00:00.000Z", account: "Work" });
    expect(usageLimitText(held, "en", NOW, TZ)).toContain("Claude on Work");
  });

  test("the default account is not named (AC-8)", () => {
    expect(usageLimitText(stoppedView(), "en", NOW, TZ)).not.toContain(" on ");
    const held = heldView("runner.usageLimitHeld", { tool: "claude", at: "2026-08-16T05:00:00.000Z" });
    expect(usageLimitText(held, "en", NOW, TZ)).not.toContain("Claude on");
  });

  test("the row's notice marks the usage-limit sentence as the one the buttons follow (AC-2)", () => {
    const view = onWork({ usageLimitWait: { until: new Date(Date.now() + 3_600_000).toISOString(), resetKnown: true } });
    const parts = specNotice(view)?.parts ?? [];
    expect(parts.find((p) => p.kind === "run-on-account")?.text).toContain("Claude (opus) on Work");
  });

  test("one button per account to move to, each posting its name to the job's run-on route (AC-2)", () => {
    const html = runOnAccountButtons(onWork(), "en");
    expect(html).toContain("Run on Default");
    expect(html).toContain("Run on Spare");
    expect(html).toContain(`/api/queue/${onWork().id}/run-on`);
    expect(html).toContain("Spare");
  });

  test("a row with no other account to move to has no buttons and no such part (AC-9)", () => {
    const view = onWork({ runOnAccounts: [], usageLimitWait: { until: new Date(Date.now() + 3_600_000).toISOString(), resetKnown: true } });
    expect(runOnAccountButtons(view, "en")).toBe("");
    expect((specNotice(view)?.parts ?? []).some((p) => p.kind === "run-on-account")).toBe(false);
  });

  test("a job that is running on Work says so on the row's notice (AC-8)", () => {
    const running = row({ steps: ["implement"], state: "running", claudeAccount: "Work" });
    expect(specNotice(running)?.text).toContain("Implement runs on Claude on Work");
    const done = row({ steps: ["implement"], state: "done", claudeAccount: "Work" });
    expect(specNotice(done)?.text).toContain("Implement ran on Claude on Work");
  });

  test("a job on the default account says nothing of the kind (AC-8)", () => {
    expect(specNotice(row({ steps: ["implement"], state: "running" }))).toBeUndefined();
  });
});
