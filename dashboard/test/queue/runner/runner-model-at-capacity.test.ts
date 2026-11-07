// A step the provider had no room for stops, not fails, and the row says which
// model was full in the board's own words.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { QueueStore } from "../../../src/queue/queue.ts";
import { DEFAULTS, dir, store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "./runner-fixtures.ts";
import { renderSentence } from "../../../src/i18n/message.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

describe("a step stopped because the model is at capacity", () => {
  const atCapacity = () => {
    const job = enqueue({ steps: ["analyze"] });
    const runner = makeRunner({
      readResult: () => ({ ...okResult(0.1), ok: false, terminalReason: "model-at-capacity" }),
    });
    runner.tick();
    runner.poll();
    return store.get(job.id);
  };

  test("ends stopped with the reason, not failed", () => {
    const after = atCapacity();
    expect(after?.state).toBe("stopped");
    expect(after?.stopReason).toBe("model-at-capacity");
  });

  test("names the model, says it is at capacity right now, and says to press the button or choose another model", () => {
    const text = renderSentence("en", atCapacity()?.error as Parameters<typeof renderSentence>[1]) ?? "";
    expect(text).toContain("sonnet");
    expect(text).toContain("at capacity right now");
    expect(text).toContain("Solution: Press Analyze again");
  });
});

describe("a board whose defaults name no model", () => {
  test("names the model the result's modelId gives (AC-2)", () => {
    const bare = new QueueStore({
      mirrorPath: join(dir, "bare-queue.json"),
      defaults: { ...DEFAULTS, model: {} },
      resolve: () => ({ specFolders: ["81-queue-and-runner"] }),
    });
    const r = bare.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] });
    if (!r.ok) throw new Error(r.error);
    const runner = makeRunner({
      store: bare,
      readResult: () => ({ ...okResult(0.1), ok: false, terminalReason: "model-at-capacity", modelId: "claude-sonnet-5" }),
    });
    runner.tick();
    runner.poll();
    const text = renderSentence("en", bare.get(r.job.id)?.error as Parameters<typeof renderSentence>[1]) ?? "";
    expect(text).toContain("claude-sonnet-5");
    expect(text).toContain("at capacity right now");
  });
});
