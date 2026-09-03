// Spec 359: a push that only needed a pull is retried, not reported.
//
// `mergeBranchIntoDefault` step 6's push used to be reported as a
// failure on the FIRST rejection, even when the only thing wrong was
// that origin's copy of the base branch had moved since step 3's own
// pull (another landing, or a run's own push, in the gap between the
// two). `pushWithRetry` asks origin directly whether it can even be
// reached before deciding what a failed push means: unreachable is
// retried blind (REQ-2); reachable-but-rejected means the base moved,
// which `pull --rebase` can settle on its own (REQ-1) — unless the
// rebase itself conflicts, which stays a person's call (REQ-3).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeBranchIntoDefault } from "../../src/git/branch-merge.ts";
import { fakeGit, CLEAN_MASTER, type GitCall } from "../helpers/fake-git.ts";

const BRANCH = "aide/89-merge-from-the-dashboard";
const ROOT = "/repos/aide";
const noWait = async (_ms: number): Promise<void> => {};

const argv = (calls: GitCall[]): string[] => calls.map((c) => c.args.join(" "));
const ran = (calls: GitCall[], prefix: string): boolean => argv(calls).some((a) => a.startsWith(prefix));

/** The table every test below starts from: a clean checkout that
 *  reaches step 6 and attempts the push — steps 1-5 all succeed so the
 *  push itself, and what happens after it fails, is the only thing
 *  under test. */
const REACHES_STEP_6 = {
  ...CLEAN_MASTER,
  "ls-remote --exit-code": { code: 0, stdout: "deadbeef\trefs/heads/aide/89-merge-from-the-dashboard\n" },
  "rev-parse --abbrev-ref @{u}": { code: 0, stdout: "origin/master\n" },
  "pull -q --ff-only": { code: 0 },
  "merge -q --ff-only": { code: 0 },
  switch: { code: 0 },
  fetch: { code: 0 },
};

describe("pushWithRetry: REQ-1, a push rejected because the remote moved", () => {
  // Settled by dropping the local merge and making it again onto the
  // base that moved — never by `pull --rebase`: a rebase of a landing's
  // merge commits failed before it started once (364, 2026-09-03) and
  // left the checkout ahead of origin, refusing every later landing.
  test("is retried by merging again onto the moved base, and the retry succeeds", async () => {
    const git = fakeGit({
      ...REACHES_STEP_6,
      "ls-remote origin": { code: 0 },
      reset: { code: 0 },
      push: [{ code: 1, stderr: "! [rejected] master -> master (fetch first)" }, { code: 0 }],
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    const sequence = argv(git.calls).filter(
      (a) => a === "push -q origin master" || a.startsWith("reset") || a.startsWith("merge -q") || a.startsWith("pull -q --rebase"),
    );
    expect(sequence).toEqual([
      `merge -q --ff-only refs/remotes/origin/${BRANCH}`,
      "push -q origin master",
      "reset -q --hard origin/master",
      `merge -q --ff-only refs/remotes/origin/${BRANCH}`,
      "push -q origin master",
    ]);
  });

  test("the tests run again on the second merge — they run on what main is about to become", async () => {
    const git = fakeGit({
      ...REACHES_STEP_6,
      "ls-remote origin": { code: 0 },
      checkout: { code: 0 },
      reset: { code: 0 },
      push: [{ code: 1, stderr: "! [rejected]" }, { code: 0 }],
    });
    let gates = 0;
    const gate = async () => {
      gates += 1;
      return { ok: true };
    };
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait, gate);
    expect(result.ok).toBe(true);
    expect(gates).toBe(2);
  });

  test("a base that moves twice refuses, with the checkout left level with origin — never ahead", async () => {
    const git = fakeGit({
      ...REACHES_STEP_6,
      "ls-remote origin": { code: 0 },
      reset: { code: 0 },
      push: { code: 1, stderr: "! [rejected] master -> master (fetch first)" },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("moved on origin under this landing twice");
    expect(result.error).toContain("run the step again");
    expect(result.reason).toBeUndefined();
    const seq = argv(git.calls);
    expect(seq.filter((a) => a === "push -q origin master")).toHaveLength(2);
    expect(seq.filter((a) => a === "reset -q --hard origin/master")).toHaveLength(2);
    expect(seq[seq.length - 1]).toBe("reset -q --hard origin/master");
  });
});

describe("pushWithRetry: REQ-2, a push that cannot reach origin at all", () => {
  test("is retried, waited, up to the bound, then refused if it never recovers", async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => {
      waits.push(ms);
    };
    const git = fakeGit({
      ...REACHES_STEP_6,
      "ls-remote origin": { code: 1 },
      push: { code: 1, stderr: "fatal: unable to access 'origin' — Could not resolve host" },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", wait);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(ROOT);
    expect(result.error).toContain(BRANCH);
    expect(waits).toEqual([1000, 2000]);
  });

  test("REQ-4: a later attempt that reaches origin succeeds, leaving no error", async () => {
    const git = fakeGit({
      ...REACHES_STEP_6,
      "ls-remote origin": { code: 1 },
      push: [
        { code: 1, stderr: "fatal: unable to access 'origin'" },
        { code: 1, stderr: "fatal: unable to access 'origin'" },
        { code: 0 },
      ],
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe("pushWithRetry: REQ-3/REQ-5, a second merge that hits a real conflict", () => {
  const CONFLICTING = {
    ...REACHES_STEP_6,
    "ls-remote origin": { code: 0 },
    reset: { code: 0 },
    // The first merge fast-forwards; onto the moved base neither the
    // fast-forward nor the real merge goes through.
    "merge -q --ff-only": [{ code: 0 }, { code: 1 }],
    "merge -q --no-edit": { code: 1, stderr: "CONFLICT (content): Merge conflict" },
    "merge --abort": { code: 0 },
    push: { code: 1, stderr: "! [rejected] master -> master (fetch first)" },
  };

  test("aborts the merge and refuses as a conflict, with one push attempted", async () => {
    const git = fakeGit(CONFLICTING);
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("conflict");
    expect(ran(git.calls, "merge --abort")).toBe(true);
    expect(ran(git.calls, "pull -q --rebase")).toBe(false);
    expect(argv(git.calls).filter((a) => a.startsWith("push"))).toHaveLength(1);
  });

  test("REQ-7: never auto-resolved — no -X or --force ever reaches the branch", async () => {
    const git = fakeGit(CONFLICTING);
    await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait);
    expect(argv(git.calls).some((a) => a.includes("-X") || a.includes("--force"))).toBe(false);
  });
});

// REQ-5's "same bound": `aide-run-spec`'s `PUSH_RETRY_WAITS` (bash) and
// this file's `PUSH_RETRY_WAITS_MS` (TypeScript) are two literals
// expressing the same rule with nothing else pinning them together —
// read as TEXT, the same idea `parsing-schedule-and-errors.test.ts`
// already uses for `errorReason`, since neither side has a runtime
// value the other could import.
describe("the bash and TypeScript retry bounds agree", () => {
  test("PUSH_RETRY_WAITS (bash) matches PUSH_RETRY_WAITS_MS (TypeScript)", () => {
    const bashSrc = readFileSync(join(import.meta.dir, "..", "..", "..", "core", "scripts", "aide-run-spec"), "utf-8");
    const bashMatch = bashSrc.match(/^PUSH_RETRY_WAITS=\(([^)]*)\)/m);
    expect(bashMatch).not.toBeNull();
    const bashWaitsMs = bashMatch![1]!.trim().split(/\s+/).map((n) => Number(n) * 1000);

    const tsSrc = readFileSync(join(import.meta.dir, "..", "..", "src", "git", "branch-merge.ts"), "utf-8");
    const tsMatch = tsSrc.match(/const PUSH_RETRY_WAITS_MS = \[([^\]]*)\];/);
    expect(tsMatch).not.toBeNull();
    const tsWaitsMs = tsMatch![1]!.split(",").map((n) => Number(n.trim()));

    expect(tsWaitsMs).toEqual(bashWaitsMs);
  });
});


describe("a dirty test-run.json in the checkout never blocks the fast-forward", () => {
  test("it is discarded before the pull, and nothing else is", async () => {
    // A gate's record left dirty in the dashboard's own specs checkout
    // failed 356's landing with "cannot fast-forward main" (2026-09-03);
    // the file is a record, not work, and is thrown away first.
    const git = fakeGit({
      ...REACHES_STEP_6,
      "ls-remote origin": { code: 0 },
      checkout: { code: 0 },
      push: { code: 0 },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait);
    expect(result.ok).toBe(true);
    const seq = argv(git.calls);
    const discard = seq.indexOf("checkout -q -- :(top,glob)**/test-run.json");
    const pull = seq.indexOf("pull -q --ff-only origin master");
    expect(discard).toBeGreaterThan(-1);
    expect(pull).toBeGreaterThan(discard);
    expect(seq.filter((a) => a.startsWith("checkout"))).toEqual(["checkout -q -- :(top,glob)**/test-run.json"]);
  });
});


describe("the landing's test gate: the suite runs once on the merge, before the push", () => {
  test("red drops the local merge, pushes nothing, and says so", async () => {
    const git = fakeGit({ ...REACHES_STEP_6, "ls-remote origin": { code: 0 }, checkout: { code: 0 }, reset: { code: 0 }, push: { code: 0 } });
    const gate = async () => ({ ok: false, error: "the project's tests are red on the merge", detail: "FAILED test_x" });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait, gate);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("tests-red");
    expect(result.error).toContain("tests are red");
    expect(result.detail).toBe("FAILED test_x");
    const seq = argv(git.calls);
    expect(seq).toContain("reset -q --hard origin/master");
    expect(ran(git.calls, "push -q origin master")).toBe(false);
  });

  test("green pushes, and the gate ran after the merge and before the push", async () => {
    const git = fakeGit({ ...REACHES_STEP_6, "ls-remote origin": { code: 0 }, checkout: { code: 0 }, push: { code: 0 } });
    const order: string[] = [];
    const gate = async () => {
      order.push(`gate after ${argv(git.calls).filter((a) => a.startsWith("merge")).length} merges`);
      return { ok: true };
    };
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait, gate);
    expect(result.ok).toBe(true);
    expect(order).toEqual(["gate after 1 merges"]);
    const seq = argv(git.calls);
    expect(seq.indexOf("push -q origin master")).toBeGreaterThan(seq.indexOf("merge -q --ff-only refs/remotes/origin/aide/89-merge-from-the-dashboard"));
    expect(ran(git.calls, "reset -q --hard")).toBe(false);
  });

  test("without a gate nothing changes: merge, then push", async () => {
    const git = fakeGit({ ...REACHES_STEP_6, "ls-remote origin": { code: 0 }, checkout: { code: 0 }, push: { code: 0 } });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "master", noWait);
    expect(result.ok).toBe(true);
    expect(ran(git.calls, "push -q origin master")).toBe(true);
  });
});
