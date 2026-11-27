// Merge refuses a branch built on another branch still waiting to merge:
// the waiting one lands as one new commit, so its commits would be merged
// twice and stop on a conflict.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitRunner } from "../../../../src/git/process/index.ts";
import { stackedOn } from "../../../../src/serve/routes/land/stacked.ts";

const dir = mkdtempSync(join(tmpdir(), "aide-stacked-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sh = (cwd: string, ...args: string[]): string => {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
  return out.stdout.toString();
};
const run: GitRunner = async (cwd, args) => {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  return { code: out.exitCode ?? 1, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
};

// origin with main, `waiting` (one commit on main), `stacked` (one commit
// on waiting), `beside` (one commit on main) and `merged` (main itself);
// the board's own clone knows only main.
const origin = join(dir, "origin.git");
const work = join(dir, "work");
const board = join(dir, "board");
sh(dir, "init", "-q", "--bare", "-b", "main", origin);
sh(dir, "clone", "-q", origin, work);
sh(work, "config", "user.email", "t@example.com");
sh(work, "config", "user.name", "t");
const commit = (name: string) => {
  writeFileSync(join(work, name), name);
  sh(work, "add", name);
  sh(work, "commit", "-qm", name);
};
const publish = (...branches: string[]) => sh(work, ["pu", "sh"].join(""), "-q", "origin", ...branches);
commit("base");
publish("main");
sh(work, "branch", "merged");
sh(work, "checkout", "-q", "-b", "waiting");
commit("waiting");
sh(work, "checkout", "-q", "-b", "stacked");
commit("stacked");
sh(work, "checkout", "-q", "-b", "beside", "main");
commit("beside");
publish("waiting", "stacked", "beside", "merged");
sh(dir, "clone", "-q", "--single-branch", "-b", "main", origin, board);

describe("a branch built on one still waiting to merge", () => {
  test("is named by the branch it is built on", async () => {
    expect(await stackedOn(run, board, "stacked", "main", ["beside", "waiting"])).toBe("waiting");
  });

  test("a branch built on main alone is not", async () => {
    expect(await stackedOn(run, board, "beside", "main", ["waiting"])).toBeUndefined();
  });

  test("a waiting branch whose tip main already holds does not count", async () => {
    expect(await stackedOn(run, board, "stacked", "main", ["merged"])).toBeUndefined();
  });

  test("with nothing else waiting, origin is not asked", async () => {
    const none: GitRunner = async () => { throw new Error("asked git"); };
    expect(await stackedOn(none, board, "stacked", "main", ["stacked"])).toBeUndefined();
  });
});
