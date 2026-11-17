import { expect, test } from "bun:test";
import {
  activeGroupForSpec,
  executionGroupControls,
  groupBlocksIndividualRun,
  groupMemberSteps,
  groupReservesSpec,
  type ExecutionGroupMemberState,
} from "../../../src/queue/execution-groups/actions.ts";
import type { ExecutionGroup } from "../../../src/queue/execution-groups";

const member = (o: Partial<ExecutionGroupMemberState> = {}): ExecutionGroupMemberState => ({
  implemented: false, archived: false, acceptanceOpen: false, busy: false, ...o,
});
test("group controls keep one cell action and put Edit in the menu (AC-1, AC-2, AC-11)", () => {
  expect(executionGroupControls({ state: "prepared" }, [member()])).toMatchObject({ action: "start", menu: ["edit", "remove"] });
  expect(executionGroupControls({ state: "running" }, [member({ busy: true })])).toMatchObject({ action: "stop", menu: ["edit", "remove"] });
  expect(executionGroupControls({ state: "archiving" }, [member({ busy: true })])).toMatchObject({ action: "stop", menu: ["edit", "remove"] });
});

test("a completed group puts Remove only in the menu (AC-10, AC-11)", () => {
  expect(executionGroupControls({ state: "completed" }, [member({ implemented: true })])).toMatchObject({ action: undefined, menu: ["remove"] });
});

test("a member starts on the steps ticked on its row: Analyze not ticked does not run", () => {
  expect(groupMemberSteps(["implement"], ["create", "analyze"])).toEqual(["implement"]);
  expect(groupMemberSteps(["analyze", "implement", "archive"], ["create", "analyze"])).toEqual(["analyze", "implement"]);
});

test("a member with neither ticked starts on the ones it has not done", () => {
  expect(groupMemberSteps(undefined, ["create"])).toEqual(["analyze", "implement"]);
  expect(groupMemberSteps(undefined, ["create", "analyze"])).toEqual(["implement"]);
  expect(groupMemberSteps(["archive"], ["create", "analyze"])).toEqual(["implement"]);
});

test("unfinished membership lasts until completion or removal (AC-2, AC-3)", () => {
  const group = { project: "aide", members: ["1-first", "2-next"] } as ExecutionGroup;
  for (const state of ["prepared", "queued", "running", "stopped", "waiting-acceptance", "archiving"] as const) {
    expect(activeGroupForSpec([{ ...group, state }], "aide", "2-next")).toBeDefined();
  }
  expect(activeGroupForSpec([{ ...group, state: "completed" }], "aide", "2-next")).toBeUndefined();
  expect(activeGroupForSpec([{ ...group, state: "running", removedAt: "2026-11-15T20:00:00Z" }], "aide", "2-next")).toBeUndefined();
  expect(activeGroupForSpec([{ ...group, state: "running" }], "another", "2-next")).toBeUndefined();
});

test("unfinished groups block individual Run except for a member's own live job (AC-2, AC-3)", () => {
  const group = { project: "aide", members: ["1-first", "2-next"] } as ExecutionGroup;
  const job = { project: "aide", specFolder: "2-next", state: "queued" };
  for (const state of ["prepared", "queued", "running", "stopped", "waiting-acceptance", "archiving"] as const) {
    const executionGroups = { list: () => [{ ...group, state }] };
    expect(groupBlocksIndividualRun({ executionGroups, list: () => [] }, "aide", "2-next")).toBe(true);
    expect(groupBlocksIndividualRun({ executionGroups, list: () => [job] }, "aide", "2-next")).toBe(false);
  }
  expect(groupBlocksIndividualRun({ executionGroups: { list: () => [{ ...group, state: "completed" }] }, list: () => [] }, "aide", "2-next")).toBe(false);
});

test("non-Run actions keep the active-group reservation boundary (AC-2, AC-3)", () => {
  const group = { project: "aide", members: ["1-first", "2-next"] } as ExecutionGroup;
  const job = { project: "aide", specFolder: "2-next", state: "queued" };
  for (const state of ["queued", "running", "archiving"] as const) {
    const executionGroups = { list: () => [{ ...group, state }] };
    expect(groupReservesSpec({ executionGroups, list: () => [] }, "aide", "2-next")).toBe(true);
    expect(groupReservesSpec({ executionGroups, list: () => [job] }, "aide", "2-next")).toBe(false);
    expect(groupReservesSpec({ executionGroups, list: () => [] }, "another", "2-next")).toBe(false);
  }
  for (const state of ["prepared", "stopped", "waiting-acceptance", "completed"] as const)
    expect(groupReservesSpec({ executionGroups: { list: () => [{ ...group, state }] }, list: () => [] }, "aide", "2-next")).toBe(false);
});


test("an idle group offers Remove, but a member still working keeps it unavailable", () => {
  for (const state of ["prepared", "stopped", "waiting-acceptance"] as const) {
    expect(executionGroupControls({ state }, [member()]).menu).toContain("remove");
    expect(executionGroupControls({ state }, [member({ busy: true })]).disabledMenu).toContain("remove");
  }
});


test("Edit and Remove stay visible but disabled while the group has work in flight", () => {
  for (const state of ["queued", "running", "archiving"] as const) {
    const controls = executionGroupControls({ state }, [member()]);
    expect(controls.menu).toEqual(["edit", "remove"]);
    expect(controls.disabledMenu).toEqual(["edit", "remove"]);
  }
});
