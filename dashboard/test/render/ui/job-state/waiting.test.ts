import { expect, test } from "bun:test";
import { waitingFor, firstWaiting } from "../../../../src/render/ui/job-state/waiting.ts";
import type { QueueRowView } from "../../../../src/render/ui/job-state/types.ts";
const row = (patch: Partial<QueueRowView>) => ({ id: "a", project: "p", specFolder: "s", steps: ["analyze", "implement"], stepIndex: 1, state: "queued", spentUsd: 0, timeoutSec: 10, createdAt: "now", ...patch } as QueueRowView);
test("a pending merge belongs to its completed phase while active work has no waiting fact", () => {
  const waiting = row({ queuePosition: { id: "merge", n: 2, total: 4, operation: "analyze", reason: "repository busy" } });
  expect(waitingFor(waiting, "analyze")).toEqual(waiting.queuePosition);
  expect(waitingFor(waiting, "implement")).toBeUndefined();
  expect(waitingFor(row({ state: "running" }))).toBeUndefined();
  expect(firstWaiting([row({ queuePosition: { n: 3, total: 4 } }), waiting])).toEqual(waiting.queuePosition);
});
