// Spec 453: the `create` step stops picking a number at all and creates
// its folder under the literal provisional key; the number is picked
// exactly once, at the one point where two landings for the same specs
// repo are already serialized by construction — inside `mergeAndGate()`,
// under `mergeLock`. `finalizeCreate` is the hook that runs there, and
// this proves the three things that matter about it: it runs before the
// push and its folder name survives onto the result; a refusal behaves
// like a merge conflict (dropped, nothing pushed); and it is recomputed
// on every retry attempt, never reusing a count taken before `base`
// moved (the exact race the queue's old `runner.createRunning` hold used
// to prevent by serializing whole create SESSIONS instead).

import { describe, expect, test } from "bun:test";
import { mergeBranchIntoDefault } from "../../../src/git/branch-merge.ts";
import type { CreateFinalizer } from "../../../src/git/create-finalizer.ts";
import { fakeGit, CLEAN_MASTER, type GitCall } from "../../helpers/fake-git.ts";
import { renderSentence } from "../../../src/i18n/message.ts";

function sentence(s: unknown): string {
  return renderSentence("en", s as Parameters<typeof renderSentence>[1]) ?? "";
}

const BRANCH = "aide/new-abcd1234";
const ROOT = "/repos/aide-specs";
const noWait = async (_ms: number): Promise<void> => {};

const argv = (calls: GitCall[]): string[] => calls.map((c) => c.args.join(" "));

const REACHES_MERGE = {
  ...CLEAN_MASTER,
  "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
  pull: { code: 0 },
  "merge -q --ff-only origin/": { code: 0 },
  "merge -q --ff-only": { code: 0 },
  push: { code: 0 },
  switch: { code: 0 },
  fetch: { code: 0 },
};

describe("mergeBranchIntoDefault: finalizeCreate", () => {
  test("runs after the merge and before the push, and its folder survives onto the result", async () => {
    const git = fakeGit({ ...REACHES_MERGE, reset: { code: 0 } });
    let calledWithWork = "";
    const finalizeCreate: CreateFinalizer = async (work) => {
      calledWithWork = work;
      return { ok: true, specFolder: "01-a-brand-new-spec" };
    };
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait, undefined, finalizeCreate);
    expect(result.ok).toBe(true);
    expect(result.assignedSpecFolder).toBe("01-a-brand-new-spec");
    // `work`, not `ROOT`: the finalize step runs in the merge worktree,
    // the same argument a test gate receives.
    expect(calledWithWork).not.toBe(ROOT);
    expect(calledWithWork.length).toBeGreaterThan(0);
    // Before the push: the rename lands in the same commit being pushed.
    const pushIdx = argv(git.calls).indexOf("push -q origin HEAD:refs/heads/master");
    expect(pushIdx).toBeGreaterThan(-1);
  });

  test("a refusal is dropped like a conflict — reset to base, nothing pushed", async () => {
    const git = fakeGit({ ...REACHES_MERGE, reset: { code: 0 } });
    const finalizeCreate: CreateFinalizer = async () => ({
      ok: false,
      error: { key: "landing.createAssignNumberFailed" },
      detail: "no such spec folder",
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait, undefined, finalizeCreate);
    expect(result.ok).toBe(false);
    expect(sentence(result.error)).toContain("assign");
    expect(result.detail).toContain("no such spec folder");
    expect(argv(git.calls)).toContain("reset -q --hard origin/master");
    expect(argv(git.calls).some((a) => a.startsWith("push"))).toBe(false);
  });

  // The exact race spec 453 exists to fix: a folder count taken on a
  // dropped attempt must never survive onto the attempt that actually
  // lands. Modeled the same way branch-merge-push-retry.test.ts proves
  // the test gate re-runs on a base-moved retry: the push is rejected
  // once, and the counting stub's SECOND answer is the one that must
  // win.
  test("recomputes on every retry — a base-moved retry's own folder wins, never the first attempt's", async () => {
    const git = fakeGit({
      ...REACHES_MERGE,
      "ls-remote origin": { code: 0 },
      reset: { code: 0 },
      push: [{ code: 1, stderr: "! [rejected] master -> master (fetch first)" }, { code: 0 }],
    });
    let calls = 0;
    const finalizeCreate: CreateFinalizer = async () => {
      calls += 1;
      return { ok: true, specFolder: calls === 1 ? "01-a-brand-new-spec" : "02-a-brand-new-spec" };
    };
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait, undefined, finalizeCreate);
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(result.assignedSpecFolder).toBe("02-a-brand-new-spec");
  });
});

describe("mergeBranchIntoDefault: the moment before the checkout moves", () => {
  // The shared checkout's fast-forward is what makes a landed folder
  // visible — the page's watcher rescans on it. Whatever has to be true
  // BEFORE a reader can see the folder (the job's new key, the cached
  // open-branch set) is the caller's to settle in this hook, which fires
  // after the merge reached origin and before that fast-forward.
  test("the hook fires after the push and before the checkout's own fast-forward, with the assigned folder", async () => {
    const git = fakeGit({ ...REACHES_MERGE, reset: { code: 0 } });
    const finalizeCreate: CreateFinalizer = async () => ({ ok: true, specFolder: "01-a-brand-new-spec" });
    let firedAt = -1;
    let assigned: string | undefined;
    const hooks = {
      // noinspection JSUnusedGlobalSymbols -- the code under test calls it
      beforeCheckoutMoves: (info: { assignedSpecFolder?: string }) => {
        firedAt = git.calls.length;
        assigned = info.assignedSpecFolder;
      },
    };
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait, undefined, finalizeCreate, hooks);
    expect(result.ok).toBe(true);
    expect(assigned).toBe("01-a-brand-new-spec");
    const pushIdx = argv(git.calls).indexOf("push -q origin HEAD:refs/heads/master");
    const ffIdx = git.calls.findIndex((c) => c.dir === ROOT && c.args.join(" ") === "merge -q --ff-only origin/master");
    expect(pushIdx).toBeGreaterThan(-1);
    expect(ffIdx).toBeGreaterThan(pushIdx);
    expect(firedAt).toBeGreaterThan(pushIdx);
    expect(firedAt).toBeLessThanOrEqual(ffIdx);
  });
});
