import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { testRepairSession } from "../../../../src/serve/land-branch/repair/session.ts";
import type { Job, QueueDefaults } from "../../../../src/queue/queue.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(body = "printf fixed > rule.txt", filesCommand = "true") {
  const dir = mkdtempSync(join(tmpdir(), "landing-repair-")); dirs.push(dir);
  const root = join(dir, "code"); mkdirSync(root);
  const git = (...args: string[]) => {
    const p = Bun.spawnSync(["git", "-C", root, ...args]);
    if (p.exitCode) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
  };
  git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  mkdirSync(join(root, ".aide"));
  writeFileSync(join(root, ".aide/project.yaml"), `AIDE_TEST_CMD: false\nAIDE_TEST_FILES_CMD: ${filesCommand}\n`);
  writeFileSync(join(root, "rule.txt"), "base"); git("add", ".aide/project.yaml", "rule.txt"); git("commit", "-qm", "initial");
  const main = git("rev-parse", "HEAD");
  Bun.spawnSync(["git", "init", "--bare", "-q", join(dir, "remote")]);
  git("remote", "add", "origin", join(dir, "remote")); git("push", "-q", "origin", "main");
  git("switch", "-qc", "feature"); writeFileSync(join(root, "rule.txt"), "broken"); git("commit", "-qam", "change"); git("push", "-q", "origin", "feature");
  const source = git("rev-parse", "HEAD");
  git("switch", "--detach", "-q");
  const binary = join(dir, "model"); writeFileSync(binary, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  const defaults = { model: { implement: "test" }, modelChoices: { test: { model: "test" } }, providers: { test: { name: "Test", tool: "claude", binary } }, provider: { implement: "test" }, permissionMode: { default: "bypassPermissions" }, timeoutSec: { default: 10 } } as QueueDefaults;
  const job = { id: "repair-test", project: "p", specFolder: "s", model: {}, results: [], steps: ["land"] } as unknown as Job;
  const request = { root, job, branch: "feature", verdict: { ok: false, failedTests: [{ name: "rule", file: "rule.test.ts", error: "broken" }] } };
  return { git, main, source, run: () => testRepairSession(defaults, job, resolve("../core/scripts"))(request) };
}

test("a verified repair advances the source branch and leaves main untouched", async () => {
  const f = fixture(`printf fixed > rule.txt
echo '{"type":"item.completed","item":{"type":"error","message":"Ignoring unknown setting"}}'
echo '{"type":"turn.completed"}'`); expect(await f.run()).toBe(true);
  expect(f.git("show", "origin/feature:rule.txt")).toBe("fixed");
  expect(f.git("rev-parse", "origin/main")).toBe(f.main);
});

test("red isolated tests leave the source branch untouched", async () => {
  const f = fixture(undefined, "false"); expect(await f.run()).toBe(false);
  expect(f.git("rev-parse", "origin/feature")).toBe(f.source);
});

test("a model failure cannot save or land a partial repair", async () => {
  const f = fixture("printf fixed > rule.txt; exit 1"); expect(await f.run()).toBe(false);
  expect(f.git("rev-parse", "origin/feature")).toBe(f.source);
});
