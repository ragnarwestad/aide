// The sentences a used-up usage limit puts on a job: the stopped job
// that starts again by itself, and the jobs held behind it. The sentence
// is built at render time from the job's own record, so the time reads
// in the reader's language and zone.

import { describe, expect, test } from "bun:test";
import { getSpecMessage } from "../../../src/render/ui/job-state/index.ts";
import { getUsageLimitMessage as message } from "../../../src/messages/usage-limit/get.ts";
import { renderJobFollowParts } from "../../../src/render/pages/job-page/index.ts";
import type { QueueRowView } from "../../../src/render/index.ts";
import { row } from "../../render/pages/fixtures.ts";

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
    const text = getUsageLimitMessage(stoppedView(), "en", NOW, TZ)!;
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
    const text = getUsageLimitMessage(view, "en", NOW, TZ)!;
    expect(text).toContain("the usage limit");
    expect(text).not.toContain("five-hour");
  });

  test("with no reset time says the AI did not say, and names the time the board tries again (AC-9)", () => {
    const view = stoppedView({ usageLimitWait: { until: "2026-08-16T02:10:00.000Z", resetKnown: false } });
    const text = getUsageLimitMessage(view, "en", NOW, TZ)!;
    expect(text).toContain("did not say");
    expect(text).toContain("02:10");
  });

  test("a stopped job with no wait gets no sentence from here", () => {
    expect(getUsageLimitMessage(stoppedView({ usageLimitWait: undefined }), "en", NOW, TZ)).toBeUndefined();
  });

  test("the time reads in the reader's language (AC-7)", () => {
    const nb = getUsageLimitMessage(stoppedView({ usageLimitWait: { until: "2026-08-17T05:00:00.000Z", resetKnown: true } }), "nb", NOW, TZ)!;
    const en = getUsageLimitMessage(stoppedView({ usageLimitWait: { until: "2026-08-17T05:00:00.000Z", resetKnown: true } }), "en", NOW, TZ)!;
    expect(nb).not.toBe(en);
    expect(nb).not.toContain("2026-08-17T");
  });
});

describe("a job held behind it", () => {
  test("says it waits for the AI's usage limit and when it starts (AC-8)", () => {
    const text = getUsageLimitMessage(heldView("runner.usageLimitHeld", { provider: "Claude", at: "2026-08-16T05:00:00.000Z" }), "en", NOW, TZ)!;
    expect(text).toContain("Claude");
    expect(text).toContain("05:00");
    expect(text).not.toContain("2026-08-16T");
  });

  test("with no reset time says the AI did not say, and when the board tries again (AC-9)", () => {
    const text = getUsageLimitMessage(heldView("runner.usageLimitHeldNoReset", { provider: "Codex", at: "2026-08-16T02:10:00.000Z" }), "en", NOW, TZ)!;
    expect(text).toContain("Codex");
    expect(text).toContain("did not say");
    expect(text).toContain("02:10");
  });

  test("while the probe runs says when the board tried again (AC-9)", () => {
    const text = getUsageLimitMessage(heldView("runner.usageLimitHeldProbe", { provider: "Claude", at: "2026-08-16T02:10:00.000Z" }), "en", NOW, TZ)!;
    expect(text).toContain("did not say");
    expect(text).toContain("02:10");
  });

  test("a job held for any other reason gets no sentence from here", () => {
    expect(getUsageLimitMessage(heldView("runner.notAnalyzed", {}), "en", NOW, TZ)).toBeUndefined();
  });
});

describe("the sentences ask for no press", () => {
  test("not the stopped job's, nor a held job's (AC-10)", () => {
    const all = [
      getUsageLimitMessage(stoppedView(), "en", NOW, TZ)!,
      getUsageLimitMessage(stoppedView({ usageLimitWait: { until: "2026-08-16T02:10:00.000Z", resetKnown: false } }), "en", NOW, TZ)!,
      getUsageLimitMessage(heldView("runner.usageLimitHeld", { provider: "Claude", at: "2026-08-16T05:00:00.000Z" }), "en", NOW, TZ)!,
      getUsageLimitMessage(heldView("runner.usageLimitHeldNoReset", { provider: "Claude", at: "2026-08-16T05:00:00.000Z" }), "en", NOW, TZ)!,
      getUsageLimitMessage(heldView("runner.usageLimitHeldProbe", { provider: "Claude", at: "2026-08-16T05:00:00.000Z" }), "en", NOW, TZ)!,
    ];
    for (const text of all) expect(text.toLowerCase()).not.toContain("press");
  });
});

describe("where the sentence is drawn", () => {
  test.each([true, false])("an automatic usage-limit restart is informational (reset known: %s)", (resetKnown) => {
    const notice = getSpecMessage(stoppedView({
      usageLimitWait: { until: new Date(Date.now() + 3_600_000).toISOString(), resetKnown },
    }));
    expect(notice?.variant).toBe("info");
  });

  test("the row's notice shows the stopped job's sentence in place of the run's own error", () => {
    const view = stoppedView({ usageLimitWait: { until: new Date(Date.now() + 3_600_000).toISOString(), resetKnown: true } });
    const notice = getSpecMessage(view);
    expect(notice?.text).toContain(getUsageLimitMessage(view, "en", Date.now())!);
    expect(notice?.text).not.toContain("the run's own error text");
  });

  test("a held job's row reads as information, not as a warning", () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const notice = getSpecMessage(heldView("runner.usageLimitHeld", { provider: "Claude", at }));
    expect(notice?.variant).toBe("info");
    expect(notice?.text).toContain(getUsageLimitMessage(heldView("runner.usageLimitHeld", { provider: "Claude", at }), "en", Date.now())!);
  });

  test("the job page's banner shows the same sentence, for a stopped job and for a held one", () => {
    const stopped = stoppedView();
    const held = heldView("runner.usageLimitHeld", { provider: "Claude", at: "2026-08-16T05:00:00.000Z" });
    for (const view of [stopped, held]) {
      const html = renderJobFollowParts({ ...view, results: view.results ?? [] } as never, { now: NOW, lang: "en" });
      const unescaped = html.replace(/&#39;|&#x27;/g, "'");
      expect(unescaped).toContain(getUsageLimitMessage(view, "en", NOW)!.replace(/^./, (c) => c.toUpperCase()));
    }
  });
});

describe("a step that ran on a provider of its own", () => {
  const onCapra = (over: Partial<QueueRowView> = {}): QueueRowView =>
    stoppedView({
      provider: "Claude-Capra",
      results: [{
        step: "implement", ok: false, costUsd: 0, costMeasured: true, terminalReason: "provider-limit",
        provider: { key: "capra", name: "Claude-Capra" },
        providerLimit: { tool: "claude", window: "five_hour", resetsAt: "2026-08-16T05:00:00.000Z" },
      }],
      ...over,
    });

  test("the stopped sentence names the provider and the model in the tool's place, and when it starts again (AC-11)", () => {
    const text = getUsageLimitMessage(onCapra(), "en", NOW, TZ)!;
    expect(text).toContain("Claude-Capra (opus)");
    expect(text).toContain("05:00");
    expect(text).not.toContain("Claude (opus)");
  });

  test("the held sentence names the provider the hold is for (AC-13)", () => {
    const held = heldView("runner.usageLimitHeld", { provider: "Claude-Capra", at: "2026-08-16T05:00:00.000Z" });
    expect(getUsageLimitMessage(held, "en", NOW, TZ)).toContain("Claude-Capra's usage limit");
  });

  test("a limit with no reset time names the provider and the hour the board tries again (AC-11)", () => {
    const view = onCapra({ usageLimitWait: { until: "2026-08-16T02:10:00.000Z", resetKnown: false } });
    const text = getUsageLimitMessage(view, "en", NOW, TZ)!;
    expect(text).toContain("Claude-Capra");
    expect(text).toContain("02:10");
  });

  test("the row's notice carries the sentence and no part of its own that offers a button (AC-11)", () => {
    const view = onCapra({ usageLimitWait: { until: new Date(Date.now() + 3_600_000).toISOString(), resetKnown: true } });
    const parts = getSpecMessage(view)?.parts ?? [];
    expect(parts.some((p) => "kind" in p && p.kind !== undefined)).toBe(false);
    expect(getSpecMessage(view)?.text).toContain("Claude-Capra (opus)");
  });
});

function getUsageLimitMessage(...args: Parameters<typeof message>): string | undefined {
  return message(...args)?.text;
}

test("automatic usage-limit waiting carries its catalogue message and offers no manual action", () => {
  const result = message(stoppedView(), "en", NOW, TZ);
  expect(result?.variant).toBe("info");
  expect(result?.sentence).toMatchObject({ key: "runner.usageLimitRestarts" });
  expect(result?.log).toBeUndefined();
  expect(result?.dismiss).toBeUndefined();
});
