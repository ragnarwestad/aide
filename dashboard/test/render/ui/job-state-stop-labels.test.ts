// What the page says a job's state is: one word, and nothing after it.
// Why a job stopped — red tests, a provider's limit, the step's own time
// limit — is the error sentence's to tell, on the row's message line and
// in the popover beside the chip. It is never written after the word.

import { describe, expect, test } from "bun:test";
import { stateChip, stateWord, wordPhase } from "../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../src/render";

const stopped = (stopReason: string, timeoutSec = 2700): QueueRowView =>
  ({ state: "stopped", stopReason, timeoutSec }) as unknown as QueueRowView;

describe("a state is one word, in the reader's own language", () => {
  // Spec 482: a word said differently per language, not the queue's own
  // English enum value read back verbatim.
  test("every state is translated, not the raw English enum value", () => {
    expect(stateWord({ state: "queued" } as QueueRowView, "nb")).toBe("i kø");
    expect(stateWord({ state: "running" } as QueueRowView, "nb")).toBe("kjører");
    expect(stateWord({ state: "done" } as QueueRowView, "nb")).toBe("ferdig");
    expect(stateWord({ state: "failed" } as QueueRowView, "nb")).toBe("feilet");
    expect(stateWord({ state: "cancelled" } as QueueRowView, "nb")).toBe("avbrutt");
    expect(stateWord({ state: "interrupted" } as QueueRowView, "nb")).toBe("avbrutt");
    expect(stateWord(stopped("timeout"), "nb")).toBe("stoppet");

    expect(stateWord({ state: "queued" } as QueueRowView, "en")).toBe("queued");
    expect(stateWord({ state: "running" } as QueueRowView, "en")).toBe("running");
    expect(stateWord({ state: "done" } as QueueRowView, "en")).toBe("done");
    expect(stateWord({ state: "failed" } as QueueRowView, "en")).toBe("failed");
    expect(stateWord({ state: "cancelled" } as QueueRowView, "en")).toBe("cancelled");
    expect(stateWord({ state: "interrupted" } as QueueRowView, "en")).toBe("interrupted");
  });

  // The three stops that used to word themselves — "stopped — 45 min",
  // "stopped — provider limit", "stopped — tests red" — read the same
  // now, whichever reason they carry.
  test("no stop kind writes its reason after the word", () => {
    for (const reason of ["timeout", "provider-limit", "tests-red"]) {
      expect(stateWord(stopped(reason), "en")).toBe("stopped");
      expect(stateWord(stopped(reason), "nb")).toBe("stoppet");
    }
    // A ten-second limit, the round's own boards: it said "0 min".
    expect(stateWord(stopped("timeout", 10), "en")).toBe("stopped");
  });
});

describe("nothing on the page writes the state as more than that word", () => {
  test("a phase line's badge is the word", () => {
    for (const reason of ["timeout", "provider-limit", "tests-red"]) {
      const attempt = { state: "stopped", stopReason: reason, errorReason: reason } as unknown as QueueRowView;
      expect(wordPhase(false, undefined, attempt, {}, "en").badge?.label).toBe("Stopped");
    }
    // 498 (2026-09-19): archive's commit is on its branch, so the history
    // says the phase ran — but the merge was refused on red tests. The
    // line reads the attempt's own state, not Done.
    const red = { state: "stopped", stopReason: "tests-red", errorReason: "tests-red" } as unknown as QueueRowView;
    const w = wordPhase(true, undefined, red, {}, "en");
    expect(w.badge?.label).toBe("Stopped");
    expect(w.pip).not.toBe("past");
  });

  test("a cancelled re-run still leaves the earlier run's Done", () => {
    const cancelled = { state: "cancelled" } as unknown as QueueRowView;
    expect(wordPhase(true, undefined, cancelled, {}, "en").badge?.label).toBe("Done");
  });

  test("the qualifier beside it names the state, not the reason", () => {
    const attempt = { state: "stopped", stopReason: "provider-limit" } as unknown as QueueRowView;
    expect(wordPhase(true, undefined, attempt, {}, "en").qualifier).toBe("last re-run stopped");
    expect(wordPhase(true, undefined, { state: "cancelled" } as unknown as QueueRowView, {}, "nb").qualifier).toBe(
      "siste ny kjøring avbrutt",
    );
  });

  test("the job page's chip is the word, with the step's own sentence in the popover", () => {
    const html = stateChip(
      { state: "stopped", stopReason: "timeout", timeoutSec: 5400, error: "the step ran past its limit" } as unknown as QueueRowView,
      "en",
    );
    expect(html).toContain(">Stopped<");
    expect(html).not.toContain("90 min");
    expect(html).toContain("the step ran past its limit");
  });
});
