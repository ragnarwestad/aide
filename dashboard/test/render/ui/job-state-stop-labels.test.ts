// What the page says a job's state is: one word, and nothing after it.
// Why a job stopped — red tests, a provider's limit, the step's own time
// limit — is the error sentence's to tell, on the row's message line and
// in the popover beside the chip. It is never written after the word.

import { describe, expect, test } from "bun:test";
import { endingWord, stateWord, wordPhase } from "../../../src/render/ui/job-state";
import { STEP_ENDINGS } from "../../../src/step-endings.ts";
import { LANGUAGES } from "../../../src/i18n";
import type { QueueRowView } from "../../../src/render";

// A run stopped early: a usage limit leaves it waiting, any other stop fails it.
const stopped = (stopReason: string, timeoutSec = 2700): QueueRowView =>
  ({ state: stopReason === "provider-limit" ? "waiting" : "failed", stopReason, timeoutSec }) as unknown as QueueRowView;

describe("a state is one word, in the reader's own language", () => {
  // A word said differently per language, not the queue's own
  // English enum value read back verbatim.
  test("every state is translated, not the raw English enum value", () => {
    expect(stateWord({ state: "queued" } as QueueRowView, "nb")).toBe("i kø");
    expect(stateWord({ state: "running" } as QueueRowView, "nb")).toBe("kjører");
    expect(stateWord({ state: "done" } as QueueRowView, "nb")).toBe("ferdig");
    expect(stateWord({ state: "failed" } as QueueRowView, "nb")).toBe("feilet");
    expect(stateWord({ state: "cancelled" } as QueueRowView, "nb")).toBe("avbrutt");
    expect(stateWord(stopped("timeout"), "nb")).toBe("feilet");
    expect(stateWord({ state: "waiting" } as QueueRowView, "nb")).toBe("venter");

    expect(stateWord({ state: "queued" } as QueueRowView, "en")).toBe("queued");
    expect(stateWord({ state: "running" } as QueueRowView, "en")).toBe("running");
    expect(stateWord({ state: "done" } as QueueRowView, "en")).toBe("done");
    expect(stateWord({ state: "failed" } as QueueRowView, "en")).toBe("failed");
    expect(stateWord({ state: "cancelled" } as QueueRowView, "en")).toBe("cancelled");
    expect(stateWord({ state: "waiting" } as QueueRowView, "en")).toBe("waiting");
  });

  // The three stops that used to word themselves — "stopped — 45 min",
  // "stopped — provider limit", "stopped — tests red" — read the same
  // now, whichever reason they carry.
  test("no stop kind writes its reason after the word", () => {
    for (const reason of ["timeout", "tests-red"]) {
      expect(stateWord(stopped(reason), "en")).toBe("failed");
      expect(stateWord(stopped(reason), "nb")).toBe("feilet");
    }
    expect(stateWord(stopped("provider-limit"), "en")).toBe("waiting");
    expect(stateWord(stopped("provider-limit"), "nb")).toBe("venter");
    // A ten-second limit, the round's own boards: it said "0 min".
    expect(stateWord(stopped("timeout", 10), "en")).toBe("failed");
  });
});

describe("nothing on the page writes the state as more than that word", () => {
  test("a phase line's badge is the word", () => {
    for (const reason of ["timeout", "tests-red"]) {
      const attempt = { ...stopped(reason), errorReason: reason } as unknown as QueueRowView;
      expect(wordPhase(false, undefined, attempt, {}, "en").badge?.label).toBe("Failed");
    }
    expect(wordPhase(false, undefined, stopped("provider-limit"), {}, "en").badge?.label).toBe("Waiting");
    // Archive's commit is on its branch, so the history
    // says the phase ran — but the merge was refused on red tests. The
    // line reads the attempt's own state, not Done.
    const red = { state: "failed", stopReason: "tests-red", errorReason: "tests-red" } as unknown as QueueRowView;
    const w = wordPhase(true, undefined, red, {}, "en");
    expect(w.badge?.label).toBe("Failed");
    expect(w.pip).not.toBe("past");
  });

  test("a cancelled re-run still leaves the earlier run's Done", () => {
    const cancelled = { state: "cancelled" } as unknown as QueueRowView;
    expect(wordPhase(true, undefined, cancelled, {}, "en").badge?.label).toBe("Done");
  });

  test("the qualifier beside it names the state, not the reason", () => {
    expect(wordPhase(true, undefined, stopped("timeout"), {}, "en").qualifier).toBe("last re-run failed");
    expect(wordPhase(true, undefined, { state: "cancelled" } as unknown as QueueRowView, {}, "nb").qualifier).toBe(
      "siste ny kjøring avbrutt",
    );
  });
});

// How a step ended, in one word for a table cell: the steps table's Outcome
// and Ended as columns.
describe("endingWord()", () => {
  test("every step ending has a word of its own in every language, with merge wording for already-landed", () => {
    for (const { name } of STEP_ENDINGS) {
      expect(endingWord("en", name)).toBe(name === "already-landed" ? "already merged" : name);
      for (const lang of LANGUAGES.filter((l) => l !== "en")) {
        const word = endingWord(lang, name);
        expect({ name, lang, translated: word !== name && word.trim() !== "" }).toEqual({ name, lang, translated: true });
      }
    }
  });

  test("a reason that is not a step ending is shown as it is (AC-2)", () => {
    expect(endingWord("nb", "noe-helt-nytt")).toBe("noe-helt-nytt");
  });
});

test("a phase waiting to retry takes precedence over an older completion", () => {
  const job = { ...stopped("provider-limit"), steps: ["analyze", "implement"], stepIndex: 0,
    usageLimitWait: { until: "2099-01-01T12:00:00Z", resetKnown: true } };
  expect(wordPhase(true, undefined, job, { step: "analyze" }).pip).toBe("waiting");
  expect(wordPhase(true, undefined, job, { step: "implement" }).pip).toBe("past");
});
