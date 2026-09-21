import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../../../src/serve/serve-helpers/parse-args.ts";

// A round's board runs with its own queue and no push paths of its own;
// defaulted under ~/.aide/dashboard, it read prod's subscriptions and
// sent its test project's failures to the phone (2026-09-19).
describe("push and failed-create files default beside the queue mirror", () => {
  test("a board with a queue of its own keeps them beside it", () => {
    const opts = parseArgs(["--queue-mirror", "/tmp/round-work/queue.json"]);
    expect(opts.pushSubscriptionsPath).toBe("/tmp/round-work/push-subscriptions.json");
    expect(opts.pushKeyPath).toBe("/tmp/round-work/push-key.json");
    expect(opts.failedCreatesPath).toBe("/tmp/round-work/failed-creates.json");
  });

  test("a board with a queue of its own keeps its pending choices beside it", () => {
    const opts = parseArgs(["--queue-mirror", "/tmp/round-work/queue.json"]);
    expect(opts.pendingModelsPath).toBe("/tmp/round-work/pending-models.json");
    expect(opts.pendingStepsPath).toBe("/tmp/round-work/pending-steps.json");
  });

  test("the served board keeps them where they are", () => {
    const opts = parseArgs([]);
    const dir = join(homedir(), ".aide", "dashboard");
    expect(opts.pushSubscriptionsPath).toBe(join(dir, "push-subscriptions.json"));
    expect(opts.pushKeyPath).toBe(join(dir, "push-key.json"));
    expect(opts.failedCreatesPath).toBe(join(dir, "failed-creates.json"));
    expect(opts.pendingModelsPath).toBe(join(dir, "pending-models.json"));
    expect(opts.pendingStepsPath).toBe(join(dir, "pending-steps.json"));
  });
});
