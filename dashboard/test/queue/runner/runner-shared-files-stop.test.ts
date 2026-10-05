// An analyze the runner stopped because another open spec changes the same
// files ends stopped, not failed, with a sentence naming each spec and the
// files it shares, and the step result keeps the list.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";
import { renderSentence, type Sentence } from "../../../src/i18n/message.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

// The script's own sentence names no spec: what names them is the list in the result.
const SCRIPT_SENTENCE = "Analyze stopped: other open specs change the same files.";

const SHARED = [
  { spec: "603-b", files: ["x.ts", "y.ts"] },
  { spec: "604-c", files: ["z.ts"] },
];

const stopped = (sharedFiles?: unknown) => {
  const job = enqueue({ steps: ["analyze"] });
  const runner = makeRunner({
    readResult: () => ({
      ...okResult(0.1),
      ok: false,
      terminalReason: "shared-files",
      error: SCRIPT_SENTENCE,
      ...(sharedFiles !== undefined ? { sharedFiles } : {}),
    }),
  });
  runner.tick();
  runner.poll();
  return store.get(job.id);
};

describe("an analyze stopped on files another open spec changes", () => {
  test("is stopped, not failed, with the shared-files reason (AC-2)", () => {
    const after = stopped(SHARED);
    expect(after?.state).toBe("stopped");
    expect(after?.stopReason).toBe("shared-files");
  });

  test("its sentence names each spec and each file it shares (AC-3)", () => {
    const after = stopped(SHARED);
    const en = renderSentence("en", after?.error as Sentence) ?? "";
    for (const text of ["603-b", "x.ts", "y.ts", "604-c", "z.ts"]) expect(en).toContain(text);
  });

  test("the step result keeps the specs and their files (AC-3)", () => {
    const after = stopped(SHARED);
    expect(after?.results.at(-1)?.sharedFiles).toEqual(SHARED);
  });

  test("keeps the runner's own sentence when the result lists no specs (AC-3)", () => {
    const after = stopped();
    expect(after?.state).toBe("stopped");
    expect(after?.error).toBe(SCRIPT_SENTENCE);
    expect(after?.results.at(-1)?.sharedFiles).toBeUndefined();
  });
});
