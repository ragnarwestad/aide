// The text part of the queue-state boundary: a `.writeUnchecked(` call
// and a job literal are found, and another model's `state` is not.

import { describe, expect, test } from "bun:test";
import { queueStateWrites } from "./state-writes.ts";

const kinds = (source: string) => queueStateWrites(source).map((w) => w.kind);

describe("queueStateWrites finds the writes to a job", () => {
  test("a call to writeUnchecked on any receiver (AC-1, AC-4)", () => {
    expect(kinds(`x.writeUnchecked(id, {});`)).toEqual(["write-unchecked"]);
    expect(kinds(`ctx.queue\n  .writeUnchecked(id, { state: "done" });`)).toEqual(["write-unchecked"]);
  });

  test("writeUnchecked reached by a computed key or taken off the store (AC-1, AC-4)", () => {
    expect(kinds(`queue["writeUnchecked"](id, { state: "done" });`)).toEqual(["write-unchecked"]);
    expect(kinds(`const { writeUnchecked } = queue;`)).toEqual(["write-unchecked"]);
  });

  test("a state copied onto an object with Object.assign (AC-1, AC-4)", () => {
    expect(kinds(`Object.assign(job, { state: "done" });`)).toEqual(["assigned-state"]);
    expect(kinds(`Object.assign(job, patch, {\n  error,\n  state,\n});`)).toEqual(["assigned-state"]);
  });

  test("a literal carrying a job's own stepIndex and permissionMode beside its state (AC-1, AC-4)", () => {
    expect(kinds(`const job = { id, steps, stepIndex: 0, state: "queued", permissionMode };`)).toEqual(["job-literal"]);
    expect(kinds(`return {\n  id,\n  state,\n  stepIndex: 0,\n  permissionMode: {},\n};`)).toEqual(["job-literal"]);
  });

  test("reports the line each write starts on (AC-1)", () => {
    const writes = queueStateWrites(`// one\nconst a = 1;\nq.writeUnchecked(id, {});\nconst j = { stepIndex: 0, permissionMode, state: "queued" };`);
    expect(writes).toEqual([{ kind: "write-unchecked", line: 3 }, { kind: "job-literal", line: 4 }]);
  });
});

describe("queueStateWrites leaves other models alone", () => {
  test("a state on an object without stepIndex (AC-2, AC-4)", () => {
    expect(kinds(`const entry = { branch, port: 1, state: "running" };`)).toEqual([]);
    expect(kinds(`const sort = { state: "asc" };`)).toEqual([]);
    expect(kinds(`groups.update(id, { state: "running", currentMember });`)).toEqual([]);
  });

  test("a queue row, which shares a job's stepIndex and state but has no permissionMode (AC-2, AC-4)", () => {
    expect(kinds(`return { id, steps, stepIndex: job.stepIndex, state: job.state, spentUsd, timeoutSec };`)).toEqual([]);
  });

  test("a state that sits in a nested object, not beside stepIndex (AC-2, AC-4)", () => {
    expect(kinds(`const job = { stepIndex: 0, permissionMode, landing: { state: "x" } };`)).toEqual([]);
    expect(kinds(`const outer = { state: "x", inner: { stepIndex: 0, permissionMode } };`)).toEqual([]);
  });

  test("a comment or a string that spells the call or the keys (AC-2, AC-4)", () => {
    expect(kinds(`// x.writeUnchecked(id, {})\n/* { stepIndex: 0, permissionMode, state: "queued" } */`)).toEqual([]);
    expect(kinds(`const s = "x.writeUnchecked(id, {})";\nconst t = '{ stepIndex: 0, permissionMode, state: 1 }';\nconst u = \`.writeUnchecked(\`;`)).toEqual([]);
  });

  test("a method of another name that ends the same way (AC-2)", () => {
    expect(kinds(`x.rewriteUnchecked(id, {}); x.writeUncheckedLater(id, {});`)).toEqual([]);
  });

  test("an Object.assign whose state sits in a nested object, or that copies no state (AC-2, AC-4)", () => {
    expect(kinds(`Object.assign(view, { landing: { state: "x" } });`)).toEqual([]);
    expect(kinds(`Object.assign(failed, { ok: false, error });`)).toEqual([]);
  });
});
