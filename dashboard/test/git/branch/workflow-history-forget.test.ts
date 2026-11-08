// A step that just ended, or a landing that just moved the folder,
// makes every cached history answer for that spec stale: the next read
// asks git again inside the TTL, while `peekHistory` keeps answering
// from the old entry until then (the same shape BranchFileStepsChecker
// already has).
import { describe, expect, test } from "bun:test";

import { WorkflowHistoryChecker } from "../../../src/git/workflow-history.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

describe("WorkflowHistoryChecker.forget", () => {
  test("the next read inside the TTL asks git again, for every reopen mark", async () => {
    const git = fakeGit({ log: { code: 0, stdout: "" } });
    const checker = new WorkflowHistoryChecker({ run: git.run });
    await checker.read("/specs", "81-queue-and-runner");
    await checker.read("/specs", "81-queue-and-runner", "abc123");
    await checker.read("/specs", "81-queue-and-runner");
    expect(git.calls.length).toBe(2);
    checker.forget("/specs", "81-queue-and-runner");
    await checker.read("/specs", "81-queue-and-runner");
    await checker.read("/specs", "81-queue-and-runner", "abc123");
    expect(git.calls.length).toBe(4);
  });

  test("another spec's answer is left alone", async () => {
    const git = fakeGit({ log: { code: 0, stdout: "" } });
    const checker = new WorkflowHistoryChecker({ run: git.run });
    await checker.read("/specs", "82-another");
    checker.forget("/specs", "81-queue-and-runner");
    await checker.read("/specs", "82-another");
    expect(git.calls.length).toBe(1);
  });

  test("peekHistory keeps answering from the marked entry until it is replaced", async () => {
    const git = fakeGit({ log: { code: 0, stdout: "" } });
    const checker = new WorkflowHistoryChecker({ run: git.run });
    await checker.read("/specs", "81-queue-and-runner");
    checker.forget("/specs", "81-queue-and-runner");
    expect(checker.peekHistory("/specs", "81-queue-and-runner").history).not.toBeNull();
  });
});
