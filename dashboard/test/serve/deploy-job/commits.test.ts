// What a deploy took in: the commits between the one the previous deploy
// reached and the one its fetch reached, each with its address on the forge.

import { describe, expect, test } from "bun:test";
import type { Job } from "../../../src/queue/queue.ts";
import { deployCommits, pendingCommits, webAddress } from "../../../src/serve/deploy-job/commits.ts";

let n = 0;
const deploy = (o: Partial<Job> & { deploy?: Job["deploy"] }): Job =>
  ({
    id: `d${++n}`, project: "aide", specFolder: "deploy", steps: ["deploy"], stepIndex: 0, state: "done",
    timeoutSec: {}, permissionMode: {}, model: {}, results: [], spentUsd: 0, createdAt: "2026-11-12T10:00:00Z", ...o,
  }) as Job;

/** A git that answers `log` with two commits and `remote get-url` with a GitHub address, counting each `log`. */
function fakeGit() {
  const asked: string[][] = [];
  const git = (_root: string, args: string[]) => {
    asked.push(args);
    if (args[0] === "log") return { code: 0, stdout: "bbbbbbb2\tSecond change\naaaaaaa1\tFirst change\n" };
    if (args[0] === "remote") return { code: 0, stdout: "git@github.com:me/aide.git\n" };
    return { code: 1, stdout: "" };
  };
  return { git, logs: () => asked.filter((a) => a[0] === "log") };
}

describe("the commits a deploy took in", () => {
  test("are, for a project's first deploy, the commits from the one its checkout stood at to the one its fetch reached, newest first, each with its address", () => {
    const { git, logs } = fakeGit();
    const job = deploy({ deploy: { root: "/r1", from: "f0", commit: "c1" } });
    expect(deployCommits(job, [job], git)).toEqual([
      { sha: "bbbbbbb2", subject: "Second change", url: "https://github.com/me/aide/commit/bbbbbbb2" },
      { sha: "aaaaaaa1", subject: "First change", url: "https://github.com/me/aide/commit/aaaaaaa1" },
    ]);
    expect(logs()).toEqual([["log", "--format=%H%x09%s", "f0..c1"]]);
  });

  test("are read from git once: a deploy's commits never change", () => {
    const { git, logs } = fakeGit();
    const job = deploy({ deploy: { root: "/r2", from: "f0", commit: "c2" } });
    deployCommits(job, [job], git);
    deployCommits(job, [job], git);
    expect(logs()).toHaveLength(1);
  });

  test("start at the commit the previous done deploy reached, also when the checkout was brought up to date before the deploy's own fetch", () => {
    const { git, logs } = fakeGit();
    const before = deploy({ createdAt: "2026-11-11T10:00:00Z", deploy: { root: "/r5", from: "prev", commit: "prev" } });
    const job = deploy({ createdAt: "2026-11-12T10:00:00Z", deploy: { root: "/r5", from: "c5", commit: "c5" } });
    expect(deployCommits(job, [before, job], git)).toHaveLength(2);
    expect(logs()).toEqual([["log", "--format=%H%x09%s", "prev..c5"]]);
  });

  test("start at the commit the newest earlier done deploy reached, passing over a failed one", () => {
    const { git, logs } = fakeGit();
    const older = deploy({ createdAt: "2026-11-10T10:00:00Z", deploy: { root: "/r3", commit: "old" } });
    const before = deploy({ createdAt: "2026-11-11T10:00:00Z", deploy: { root: "/r3", commit: "prev" } });
    const failed = deploy({ createdAt: "2026-11-11T12:00:00Z", state: "failed", deploy: { root: "/r3", commit: "bad" } });
    const job = deploy({ createdAt: "2026-11-12T10:00:00Z", deploy: { root: "/r3", commit: "c3" } });
    deployCommits(job, [older, before, failed, job], git);
    expect(logs()).toEqual([["log", "--format=%H%x09%s", "prev..c3"]]);
  });

  test("are none when the fetch reached the commit that already ran, and unknown when it reached none", () => {
    const { git } = fakeGit();
    expect(deployCommits(deploy({ deploy: { root: "/r4", from: "same", commit: "same" } }), [], git)).toEqual([]);
    expect(deployCommits(deploy({ deploy: { root: "/r4" } }), [], git)).toBeUndefined();
  });
});

describe("a repository's address on the web", () => {
  test("is read from an ssh or https GitHub remote, and from nothing else", () => {
    expect(webAddress("git@github.com:me/aide.git")).toBe("https://github.com/me/aide");
    expect(webAddress("https://github.com/me/aide.git")).toBe("https://github.com/me/aide");
    expect(webAddress("https://github.com/me/aide")).toBe("https://github.com/me/aide");
    expect(webAddress("/srv/git/aide.git")).toBeUndefined();
  });
});

describe("the commits a Deploy would take in", () => {
  test("run from the commit being served to origin's default branch as last fetched, never from the checkout's own position", async () => {
    const { git, logs } = fakeGit();
    const run = async (root: string, args: string[]) => git(root, args);
    expect((await pendingCommits("/r9", "s0", "main", run))?.map((c) => c.subject)).toEqual(["Second change", "First change"]);
    expect(logs()).toEqual([["log", "--format=%H%x09%s", "s0..refs/remotes/origin/main"]]);
  });

  test("are not known when git cannot answer", async () => {
    const run = async () => ({ code: 128, stdout: "" });
    expect(await pendingCommits("/r10", "s0", "main", run)).toBeUndefined();
  });
});
