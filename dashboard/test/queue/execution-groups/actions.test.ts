import { expect, test } from "bun:test";
import { executionGroupControls, type ExecutionGroupMemberState } from "../../../src/queue/execution-groups/actions.ts";

const member = (o: Partial<ExecutionGroupMemberState> = {}): ExecutionGroupMemberState => ({
  implemented: false, archived: false, acceptanceOpen: false, busy: false, ...o,
});
test("group controls keep one cell action and put Edit in the menu (AC-1, AC-2, AC-11)", () => {
  expect(executionGroupControls({ state: "prepared" }, [member()])).toEqual({ action: "start", menu: ["edit"] });
  expect(executionGroupControls({ state: "running" }, [member({ busy: true })])).toEqual({ action: "stop", menu: ["edit"] });
  expect(executionGroupControls({ state: "archiving" }, [member({ busy: true })])).toEqual({ action: "stop", menu: [] });
});

test("a completed group puts Remove only in the menu (AC-10, AC-11)", () => {
  expect(executionGroupControls({ state: "completed" }, [member({ implemented: true })])).toEqual({ action: undefined, menu: ["remove"] });
});
