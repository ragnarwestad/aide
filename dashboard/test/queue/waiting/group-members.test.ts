// A started group's members hold places in the shared queue before their own
// jobs exist; the page projection names them, so the Jobs tab's Queued entry
// can show them.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitingGroups } from "../../../src/queue/waiting/jobs.ts";
import { store, resetHarness, cleanupHarness } from "../runner/runner-fixtures.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

test("a started group names the members the queue holds a place for, and a prepared one names none", () => {
  const group = store.executionGroups.create({
    project: "aide", name: "release", members: ["82-first", "83-second"], branch: "group/82-first", sharedChoices: false,
  });
  expect(waitingGroups(store).find((g) => g.id === group.id)?.queuedMembers).toEqual([]);

  store.executionGroups.start(group.id);
  store.executionGroups.update(group.id, { state: "running", completedMembers: ["82-first"] });
  expect(waitingGroups(store).find((g) => g.id === group.id)?.queuedMembers).toEqual(["83-second"]);
});
