// The switched-off hold, wired: a tick holds a queued step whose provider is
// switched off and starts it once the provider is on again. The rule itself
// is proven in `test/queue/runner/switched-off/switched-off.test.ts`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tickRunner, type ScheduleContext } from "../../../../src/serve/schedules";
import { cleanupHarness, enqueue, makeRunner, resetHarness, spawns, store } from "../../../queue/runner/runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const ctx = (runner: ReturnType<typeof makeRunner>): ScheduleContext =>
  ({ queue: store, projectRoot: undefined, readRunner: () => runner, checkoutEnsurer: { fresh: async () => undefined } }) as unknown as ScheduleContext;

describe("tickRunner with a switched-off provider", () => {
  test("holds the step with the sentence, and starts it once the provider is switched on", async () => {
    store.defaults.providers = { capra: { name: "Claude Capra", tool: "claude", enabled: false } };
    store.defaults.provider = { analyze: "capra" };
    const queued = enqueue({ steps: ["analyze"] });
    const runner = makeRunner({ maxConcurrent: 3 });
    await tickRunner(ctx(runner));
    expect(store.get(queued.id)?.state).toBe("queued");
    expect((store.get(queued.id)?.error as { key: string }).key).toBe("runner.providerSwitchedOff");
    expect(spawns).toHaveLength(0);

    store.defaults.providers = { capra: { name: "Claude Capra", tool: "claude" } };
    await tickRunner(ctx(runner));
    expect(store.get(queued.id)?.state).toBe("running");
  });
});
