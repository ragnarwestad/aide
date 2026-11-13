import { expect, test } from "bun:test";
import { executionGroupAddRefusal, type ExecutionGroupMemberState } from "../../../src/queue/execution-groups/actions.ts";

const member = (o: Partial<ExecutionGroupMemberState> = {}): ExecutionGroupMemberState => ({
  implemented: false, archived: false, acceptanceOpen: false, busy: false, ...o,
});
const implemented = member({ implemented: true });
const archived = member({ implemented: true, archived: true });

test("a group with a member that has not finished Implement can take a spec, in any state but archiving or completed (AC-1)", () => {
  for (const state of ["prepared", "queued", "running", "stopped", "waiting-acceptance"] as const) {
    expect(executionGroupAddRefusal({ state }, [implemented, member()])).toBeUndefined();
  }
});

test("a group whose every member has finished Implement takes no spec, waiting or stopped (AC-6)", () => {
  expect(executionGroupAddRefusal({ state: "waiting-acceptance" }, [implemented, implemented])).toBe("implemented");
  expect(executionGroupAddRefusal({ state: "stopped" }, [archived, implemented])).toBe("implemented");
  expect(executionGroupAddRefusal({ state: "stopped" }, [])).toBe("implemented");
});

test("an archiving or completed group takes no spec, whatever its members (AC-6)", () => {
  expect(executionGroupAddRefusal({ state: "archiving" }, [implemented, member()])).toBe("archiving");
  expect(executionGroupAddRefusal({ state: "completed" }, [implemented, member()])).toBe("completed");
});
