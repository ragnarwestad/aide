// A stopped job says WHY on the row, and that half was English on a
// Norwegian page: `stateLabel` held the five texts as string literals
// while everything else on the row went through the translations.

import { describe, expect, test } from "bun:test";
import { stateLabel, wordPhase } from "../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../src/render";

const stopped = (stopReason: string, timeoutSec = 2700): QueueRowView =>
  ({ state: "stopped", stopReason, timeoutSec }) as unknown as QueueRowView;

describe("why a job stopped, in the reader's own language", () => {
  test("each reason has its own words in both languages", () => {
    expect(stateLabel(stopped("provider-limit"), "en")).toBe("stopped — provider limit");
    expect(stateLabel(stopped("provider-limit"), "nb")).toBe("stoppet — grense hos leverandøren");
    expect(stateLabel(stopped("tests-red"), "nb")).toBe("stoppet — røde tester");
  });

  // The one with a number in it: the minutes are the job's own timeout,
  // filled into whichever language's sentence.
  test("a timeout carries its minutes into either sentence", () => {
    expect(stateLabel(stopped("timeout", 2700), "en")).toBe("stopped — 45 min");
    expect(stateLabel(stopped("timeout", 2700), "nb")).toBe("stoppet — 45 min");
  });

  // Every other state has its own catalogue entry, in both languages
  // (spec 482) — it is a word said differently per language, not the
  // queue's own English enum value read back verbatim.
  test("every other state is translated, not the raw English enum value", () => {
    expect(stateLabel({ state: "queued" } as QueueRowView, "nb")).toBe("i kø");
    expect(stateLabel({ state: "running" } as QueueRowView, "nb")).toBe("kjører");
    expect(stateLabel({ state: "done" } as QueueRowView, "nb")).toBe("ferdig");
    expect(stateLabel({ state: "failed" } as QueueRowView, "nb")).toBe("feilet");
    expect(stateLabel({ state: "cancelled" } as QueueRowView, "nb")).toBe("avbrutt");
    expect(stateLabel({ state: "interrupted" } as QueueRowView, "nb")).toBe("avbrutt");

    expect(stateLabel({ state: "queued" } as QueueRowView, "en")).toBe("queued");
    expect(stateLabel({ state: "running" } as QueueRowView, "en")).toBe("running");
    expect(stateLabel({ state: "done" } as QueueRowView, "en")).toBe("done");
    expect(stateLabel({ state: "failed" } as QueueRowView, "en")).toBe("failed");
    expect(stateLabel({ state: "cancelled" } as QueueRowView, "en")).toBe("cancelled");
    expect(stateLabel({ state: "interrupted" } as QueueRowView, "en")).toBe("interrupted");
  });

  test("English is what a caller that names no language gets", () => {
    expect(stateLabel(stopped("tests-red"))).toBe("stopped — tests red");
  });
});

// AC-2: the state named INSIDE "last re-run {state}" is translated too,
// not only the sentence around it.
describe('the state inside "last re-run {state}" (AC-2)', () => {
  test("a cancelled re-run reads Norwegian end to end", () => {
    const attempt = { state: "cancelled" } as unknown as QueueRowView;
    const w = wordPhase(true, undefined, attempt, {}, "nb");
    expect(w.qualifier).toBe("siste ny kjøring avbrutt");
    expect(w.qualifier).not.toContain("cancelled");
  });

  test("English is unchanged", () => {
    const attempt = { state: "cancelled" } as unknown as QueueRowView;
    const w = wordPhase(true, undefined, attempt, {}, "en");
    expect(w.qualifier).toBe("last re-run cancelled");
  });
});

// 498 (2026-09-19): archive's own commit is on its branch, so the
// history says the phase ran — but the merge was refused on red tests
// and nothing reached main. "Done" beside the row's "stopped" said two
// things at once.
describe("a phase whose merge was refused", () => {
  test("reads the attempt's own state, not Done", () => {
    const refused = { state: "stopped", stopReason: "tests-red", errorReason: "tests-red" } as unknown as QueueRowView;
    const w = wordPhase(true, undefined, refused, {}, "en");
    expect(w.badge?.label).not.toBe("Done");
    expect(w.badge?.label).toBe("Stopped — tests red");
    expect(w.pip).not.toBe("past");
  });

  test("a cancelled re-run still leaves the earlier run's Done", () => {
    const cancelled = { state: "cancelled" } as unknown as QueueRowView;
    expect(wordPhase(true, undefined, cancelled, {}, "en").badge?.label).toBe("Done");
  });
});
