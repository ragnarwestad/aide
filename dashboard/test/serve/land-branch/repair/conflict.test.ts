import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeBranchIntoDefault } from "../../../../src/git/branch-merge/index.ts";
import { createGitRunner } from "../../../../src/git/process/index.ts";
import { conflictRepairSession } from "../../../../src/serve/land-branch/repair/conflict.ts";
import type { Job, QueueDefaults } from "../../../../src/queue/queue.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(body = 'printf "resolved\\n" > rule.txt') {
  const root = mkdtempSync(join(tmpdir(), "conflict-repair-")); dirs.push(root);
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", "-C", root, ...args]);
    if (r.exitCode) throw new Error(r.stderr.toString());
    return r.stdout.toString().trim();
  };
  git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  writeFileSync(join(root, "rule.txt"), "base\n"); writeFileSync(join(root, "other.txt"), "keep\n");
  git("add", "rule.txt", "other.txt"); git("commit", "-qm", "initial");
  const remote = mkdtempSync(join(tmpdir(), "conflict-origin-")); dirs.push(remote);
  Bun.spawnSync(["git", "init", "--bare", "-q", remote]); git("remote", "add", "origin", remote);
  git("switch", "-qc", "feature"); writeFileSync(join(root, "rule.txt"), "feature\n"); git("commit", "-qam", "feature");
  git("push", "-q", "origin", "feature"); const source = git("rev-parse", "HEAD");
  git("switch", "-q", "main"); writeFileSync(join(root, "rule.txt"), "main\n"); git("commit", "-qam", "main");
  git("push", "-q", "origin", "main"); const main = git("rev-parse", "HEAD"); git("switch", "--detach", "-q");
  const merged = Bun.spawnSync(["git", "-C", root, "merge", "--no-edit", "origin/feature"]);
  expect(merged.exitCode).not.toBe(0);
  const binaryDir = mkdtempSync(join(tmpdir(), "conflict-model-")); dirs.push(binaryDir);
  const binary = join(binaryDir, "model"); writeFileSync(binary, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  const defaults = { model: { implement: "test" }, modelChoices: { test: { model: "test" } }, providers: { test: { name: "Test", tool: "claude", binary } }, provider: { implement: "test" }, permissionMode: { default: "bypassPermissions" }, timeoutSec: { default: 5 } } as QueueDefaults;
  const job = { id: "conflict-test", project: "p", specFolder: "land", model: {}, results: [], steps: ["land"] } as unknown as Job;
  return { git, root, source, main, defaults, job, run: (cancelled = () => false) => conflictRepairSession(defaults, job, cancelled)({ work: root, branch: "feature", base: "main", files: ["rule.txt"] }) };
}

test("saves a resolved merge on the source branch while main stays untouched", async () => {
  const f = fixture(); expect(await f.run()).toBe(true);
  expect(f.git("show", "origin/feature:rule.txt")).toBe("resolved");
  expect(f.git("rev-parse", "origin/main")).toBe(f.main);
  expect(f.git("merge-base", "--is-ancestor", f.source, "origin/feature")).toBe("");
});

test.each(['true', 'printf "bad\\n" > other.txt; printf "resolved\\n" > rule.txt', 'printf "new\\n" > extra.txt; printf "resolved\\n" > rule.txt', 'printf "resolved\\n" > rule.txt; exit 1'])("an incomplete, out-of-scope or failed resolution is not pushed: %s", async (body) => {
  const f = fixture(body); expect(await f.run()).toBe(false);
  expect(f.git("rev-parse", "origin/feature")).toBe(f.source);
  expect(f.git("rev-parse", "origin/main")).toBe(f.main);
});

test("Cancel prevents the repair from running or pushing", async () => {
  const f = fixture(); await expect(f.run(() => true)).rejects.toThrow("cancelled");
  expect(f.git("rev-parse", "origin/feature")).toBe(f.source);
});


test("Cancel after the AI finished still prevents committing or pushing its resolution", async () => {
  const f = fixture();
  await expect(f.run(() => readFileSync(join(f.root, "rule.txt"), "utf8") === "resolved\n")).rejects.toThrow("cancelled");
  expect(f.git("rev-parse", "origin/feature")).toBe(f.source);
});

test("an AI commit cannot bypass the wrapper's merge validation", async () => {
  const f = fixture('printf "resolved\\n" > rule.txt; git add rule.txt; git commit -qm "unexpected commit"');
  expect(await f.run()).toBe(false);
  expect(f.git("rev-parse", "origin/feature")).toBe(f.source);
});


test.each([true, false])("a real conflicting merge reaches main only after its rebuilt tests are green: %s", async (green) => {
  const f = fixture();
  f.git("merge", "--abort"); f.git("switch", "-q", "main");
  let tests = 0;
  const result = await mergeBranchIntoDefault(createGitRunner(), f.root, "feature", "main", async () => {}, async (work) => {
    tests++;
    expect(readFileSync(join(work, "rule.txt"), "utf8")).toBe("resolved\n");
    expect(f.git("rev-parse", "origin/main")).toBe(f.main);
    return { ok: green };
  }, undefined, { repairConflict: conflictRepairSession(f.defaults, f.job) });
  expect(result.ok).toBe(green);
  expect(tests).toBe(1);
  if (green) expect(f.git("show", "origin/main:rule.txt")).toBe("resolved");
  else {
    expect(f.git("rev-parse", "origin/main")).toBe(f.main);
    expect(f.git("show", "origin/feature:rule.txt")).toBe("resolved");
  }
});

test("a resolution that keeps main's tree still runs the full gate", async () => {
  const f = fixture('printf "main\\n" > rule.txt');
  f.git("merge", "--abort"); f.git("switch", "-q", "main");
  let tests = 0;
  const result = await mergeBranchIntoDefault(createGitRunner(), f.root, "feature", "main", async () => {}, async () => {
    tests++; return { ok: false };
  }, undefined, { repairConflict: conflictRepairSession(f.defaults, f.job) });
  expect(result.ok).toBe(false);
  expect(tests).toBe(1);
  expect(f.git("rev-parse", "origin/main")).toBe(f.main);
});

test("staged changes outside the conflicts cannot hide behind restored working files", async () => {
  const f = fixture('printf "bad\\n" > other.txt; git add other.txt; printf "keep\\n" > other.txt; printf "resolved\\n" > rule.txt');
  expect(await f.run()).toBe(false);
  expect(f.git("rev-parse", "origin/feature")).toBe(f.source);
});

test("a concurrent source update is preserved and the rejected repair has a recovery ref", async () => {
  const f = fixture();
  const other = mkdtempSync(join(tmpdir(), "conflict-concurrent-")); dirs.push(other);
  expect(Bun.spawnSync(["git", "clone", "-q", "-b", "feature", f.git("remote", "get-url", "origin"), other]).exitCode).toBe(0);
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", "-C", other, ...args]);
    expect(r.exitCode).toBe(0); return r.stdout.toString().trim();
  };
  git("config", "user.name", "Other"); git("config", "user.email", "other@example.com");
  writeFileSync(join(other, "other.txt"), "concurrent\n"); git("commit", "-qam", "concurrent change"); git("push", "-q", "origin", "feature");
  const newer = git("rev-parse", "HEAD");
  expect(await f.run()).toBe(false);
  expect(f.git("ls-remote", "origin", "refs/heads/feature")).toStartWith(newer);
  expect(f.git("rev-parse", "refs/aide/landing-repairs/conflict-test")).not.toBe("");
  expect(f.git("rev-parse", "origin/main")).toBe(f.main);
});
