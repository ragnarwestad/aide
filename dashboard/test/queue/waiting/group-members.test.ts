import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitingGroups } from "../../../src/queue/waiting/jobs.ts";
import { store, enqueue, makeRunner, resetHarness, cleanupHarness } from "../runner/runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

test("only real current member jobs have queue positions (AC-3)", () => {
  const group = store.executionGroups.create({
    project: "aide", name: "release", members: ["81-queue-and-runner", "91-parallel-spec-runs"], branch: "group/82-first", sharedChoices: false,
  });
  expect(waitingGroups(store).find((g) => g.id === group.id)?.queuedMembers).toEqual([]);

  store.executionGroups.start(group.id);
  expect(waitingGroups(store).find((g) => g.id === group.id)?.queuedMembers).toEqual([]);
  const first = enqueue({ executionGroupId: group.id, steps: ["analyze", "implement"] });
  expect(waitingGroups(store).find((g) => g.id === group.id)?.queuedMembers).toEqual(["81-queue-and-runner"]);
  store.update(first.id, { state: "running" });
  expect(waitingGroups(store).find((g) => g.id === group.id)?.queuedMembers).toEqual([]);
  store.update(first.id, { state: "done" });
  enqueue({ executionGroupId: group.id, specFolder: "91-parallel-spec-runs" });
  expect(waitingGroups(store).find((g) => g.id === group.id)?.queuedMembers).toEqual(["91-parallel-spec-runs"]);
});

test("a group Archive gets its summary position only after the explicit action and acceptance check (AC-3, AC-4)", () => {
  const group = store.executionGroups.create({ project: "aide", name: "release", members: ["81-queue-and-runner"], branch: "group/release" });
  store.executionGroups.waitForAcceptance(group.id);
  expect(store.waiting.snapshot().entries).toEqual([]);
  expect(waitingGroups(store)[0]?.queuePosition).toBeUndefined();
  const archive = enqueue({ executionGroupId: group.id, steps: ["archive"] });
  expect(waitingGroups(store)[0]?.queuePosition).toBeUndefined();
  const owner = store.waiting.open("hold dispatch");
  makeRunner().tick();
  expect(waitingGroups(store)[0]?.queuePosition).toMatchObject({ id: `group:${group.id}:archive`, operation: "archive", n: 1 });
  expect(store.waiting.snapshot().entries[0]?.jobId).toBe(archive.id);
  store.waiting.cancel(owner);
});
