import { expect, test } from "bun:test";
import { mergeBranchIntoDefault } from "../../../src/git/branch-merge/index.ts";
import { fakeGit, CLEAN_MASTER } from "../../helpers/fake-git.ts";

function fixture() {
  return fakeGit({
    "rev-parse HEAD^{tree}": [{ code: 0, stdout: "broken" }, { code: 0, stdout: "fixed" }],
    "diff --quiet": { code: 1 },
    "ls-remote --exit-code": { code: 0, stdout: "abc refs/heads/feature" },
    "worktree add": { code: 0 }, "worktree remove": { code: 0 }, "worktree prune": { code: 0 },
    "merge -q --ff-only": { code: 0 }, fetch: { code: 0 }, reset: { code: 0 },
    push: { code: 0 }, ...CLEAN_MASTER,
  });
}

test("a repaired source is fetched and merged again before the only main push", async () => {
  const git = fixture(); let gates = 0;
  const result = await mergeBranchIntoDefault(git.run, "/repo", "feature", "master", async () => {}, async () => {
    gates++;
    return gates === 1 ? { ok: false, repaired: true } : { ok: true };
  });
  expect(result.ok).toBe(true);
  expect(gates).toBe(2);
  const commands = git.calls.map((call) => call.args.join(" "));
  expect(commands.filter((cmd) => cmd === "push -q origin HEAD:refs/heads/master")).toHaveLength(1);
  expect(commands.filter((cmd) => cmd === "reset -q --hard origin/master")).toHaveLength(1);
  expect(commands.filter((cmd) => cmd === "fetch --quiet origin master feature").length).toBeGreaterThanOrEqual(3);
});

test("a red rebuilt result never pushes main or deletes the source", async () => {
  const git = fixture(); let gates = 0;
  const result = await mergeBranchIntoDefault(git.run, "/repo", "feature", "master", async () => {}, async () => {
    gates++;
    return gates === 1 ? { ok: false, repaired: true } : { ok: false };
  });
  expect(result.ok).toBe(false);
  expect(gates).toBe(2);
  expect(git.calls.filter((call) => call.args[0] === "push")).toHaveLength(0);
});
