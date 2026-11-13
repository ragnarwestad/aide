import { expect, test } from "bun:test";
import type { ExecutionGroup } from "../../../../src/queue/execution-groups";
import { executionGroupWaits, type GroupWaitMember } from "../../../../src/render/pages/jobs-page/execution-group-waiting.ts";

const waiting = { state: "waiting-acceptance" } as const satisfies Pick<ExecutionGroup, "state">;
const member = (specFolder: string, o: Partial<GroupWaitMember> = {}): GroupWaitMember => ({
  specFolder, implemented: true, archived: false, acceptanceOpen: false, busy: false, ...o,
});

test("a group whose card offers Archive is ready (AC-1)", () => {
  expect(executionGroupWaits(waiting, [member("1-first"), member("2-second")])).toEqual([{ kind: "ready" }]);
});

test("a group waits on exactly the members with acceptance rows left (AC-2)", () => {
  const members = [member("1-first", { acceptanceOpen: true }), member("2-second"), member("3-third", { acceptanceOpen: true })];
  expect(executionGroupWaits(waiting, members)).toEqual([{ kind: "acceptance", members: ["1-first", "3-third"] }]);
});

test("a group waits on the member that is still busy (AC-3)", () => {
  const members = [member("1-first"), member("2-second", { busy: true })];
  expect(executionGroupWaits(waiting, members)).toEqual([{ kind: "busy", members: ["2-second"] }]);
});

test("a busy member and an unticked member are both waited on, busy first (AC-2, AC-3)", () => {
  const members = [member("1-first", { acceptanceOpen: true }), member("2-second", { busy: true })];
  expect(executionGroupWaits(waiting, members)).toEqual([
    { kind: "busy", members: ["2-second"] },
    { kind: "acceptance", members: ["1-first"] },
  ]);
});

test("a group in any other state waits on nothing (AC-1, AC-2, AC-3)", () => {
  const states = ["prepared", "queued", "running", "stopped", "archiving", "completed"] as const;
  for (const state of states) {
    expect(executionGroupWaits({ state }, [member("1-first", { busy: true, acceptanceOpen: true })])).toEqual([]);
    expect(executionGroupWaits({ state }, [member("1-first")])).toEqual([]);
  }
});

test("a group whose card offers Start is waiting to run, not for Archive (AC-1, AC-2, AC-3)", () => {
  const members = [member("1-first", { acceptanceOpen: true }), member("2-second", { implemented: false, busy: true })];
  expect(executionGroupWaits(waiting, members)).toEqual([]);
});

test("a group with no card action at all waits on nothing (AC-1, AC-2, AC-3)", () => {
  expect(executionGroupWaits(waiting, [])).toEqual([]);
  expect(executionGroupWaits(waiting, [member("1-first", { archived: true }), member("2-second", { archived: true })])).toEqual([]);
});
