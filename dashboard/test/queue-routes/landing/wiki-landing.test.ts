import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { AUTH, createOwnDirs, gitFor, repos, serverWith, resultDir, settle, repoOf, result } from "./every-step-lands-fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const { own, cleanup: cleanupOwnDirs } = createOwnDirs();
const WIKI_BRANCH = "aide/wiki-aide";

afterEach(() => {
  harness.cleanup();
  cleanupOwnDirs();
});

async function wikiBuild(base: string, dir: string, over: Record<string, unknown>) {
  const made = (await (
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: "wiki-aide", steps: ["wiki"] }),
    })
  ).json()) as { job: { id: string } };
  writeFileSync(join(resultDir(dir), `${made.job.id}.json`), JSON.stringify(result({ branch: WIKI_BRANCH, ...over })));
  return settle(base, made.job.id, (j) => j.state !== "queued" && j.state !== "running" && !j.landing);
}

const mergesOfWiki = (calls: { dir: string; args: string[] }[], root: string) =>
  calls.filter(
    (c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${WIKI_BRANCH}`) && repoOf(c.dir) === root,
  );

describe("a finished wiki build lands its own work (AC-1)", () => {
  test("its branch is merged in the specs repository and the project's code is not (AC-1)", async () => {
    const dir = own("aide-wiki-lands-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(harness, dir, paths, git);

    const landed = await wikiBuild(base, dir, {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(mergesOfWiki(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(mergesOfWiki(git.calls, paths.project)).toEqual([]);
    expect(git.calls.some((c) => repoOf(c.dir) === paths.specs && c.args[0] === "push")).toBe(true);
    expect(landed.branchUrls).toEqual([]);
  });

  test("with the specs tracked in the project only the wiki folder is copied and the branch is deleted (AC-1)", async () => {
    const dir = own("aide-wiki-lands-inside-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(harness, dir, paths, git);

    const landed = await wikiBuild(base, dir, {
      branchUrls: [{ root: paths.project, url: "https://example.test/aide" }],
    });

    expect(landed.error).toBeFalsy();
    expect(git.calls.some((c) => c.args[0] === "diff" && c.args.includes("specs/wiki"))).toBe(true);
    expect(git.calls.some((c) => c.args[0] === "diff" && c.args.includes("specs/wiki-aide"))).toBe(false);
    expect(git.calls.some((c) => c.args[0] === "merge" && c.args.includes(`refs/remotes/origin/${WIKI_BRANCH}`))).toBe(false);
    expect(git.calls.some((c) => c.args.join(" ") === `push -q origin --delete ${WIKI_BRANCH}`)).toBe(true);
  });

  test("a build stopped by its clock lands the pages it pushed to a separate specs repository (AC-1)", async () => {
    const dir = own("aide-wiki-stopped-");
    const paths = repos(dir);
    const git = gitFor();
    const { base } = serverWith(harness, dir, paths, git);

    await wikiBuild(base, dir, {
      ok: false,
      terminalReason: "timeout",
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(mergesOfWiki(git.calls, paths.specs).length).toBeGreaterThan(0);
  });
});
