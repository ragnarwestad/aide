// What GitHub says about the Cloudflare Pages build of a branch's newest
// commit, read into the one fact the board needs: the branch's own address,
// once the host has published it. An answer that cannot be read is no
// answer at all, never "no address".

import { describe, expect, test } from "bun:test";
import {
  askBranchPreview, branchPreviewArgs, readBranchPreview, type CheckRun,
} from "../../src/integrations/branch-previews.ts";
import type { GhRunner } from "../../src/integrations/pull-requests.ts";

const BRANCH_URL = "https://aide-40-x.woodstack.pages.dev";
const COMMIT_URL = "https://f66306f3.woodstack.pages.dev";

/** The summary table Cloudflare writes, trimmed to the rows read. */
const summary = (branchRow = `<a href='${BRANCH_URL}'>${BRANCH_URL}</a>`): string =>
  "<table><tr><td><strong>Latest commit:</strong> </td><td><code>6e59726</code></td></tr>" +
  "<tr><td><strong>Status:</strong></td><td>&nbsp;✅&nbsp; Deploy successful!</td></tr>" +
  `<tr><td><strong>Preview URL:</strong></td><td><a href='${COMMIT_URL}'>${COMMIT_URL}</a></td></tr>` +
  `<tr><td><strong>Branch Preview URL:</strong></td><td>${branchRow}</td></tr></table>`;

const run = (o: Partial<CheckRun> & { text?: string } = {}): CheckRun => ({
  id: 1,
  name: "Cloudflare Pages",
  status: "completed",
  conclusion: "success",
  app: { slug: "cloudflare-workers-and-pages" },
  output: { summary: o.text ?? summary() },
  ...o,
});

const answer = (...runs: CheckRun[]): string => JSON.stringify({ total_count: runs.length, check_runs: runs });

describe("readBranchPreview", () => {
  test("a successful run gives the Branch Preview URL, not the one fixed to a commit (AC-1)", () => {
    expect(readBranchPreview(answer(run()))).toEqual({ address: BRANCH_URL });
  });

  test("no Cloudflare Pages run, or a non-https address, is no address (AC-1)", () => {
    const other = run({ name: "build", app: { slug: "github-actions" } });
    expect(readBranchPreview(answer(other))).toEqual({});
    expect(readBranchPreview(answer())).toEqual({});
    expect(readBranchPreview(answer(run({ text: summary("<a href='http://x.pages.dev'>x</a>") })))).toEqual({});
    expect(readBranchPreview(answer(run({ text: "<table></table>" })))).toEqual({});
  });

  test("a run still queued or in progress gives no address (AC-2)", () => {
    expect(readBranchPreview(answer(run({ status: "queued", conclusion: null })))).toEqual({});
    expect(readBranchPreview(answer(run({ status: "in_progress", conclusion: null })))).toEqual({});
  });

  test("a run that completed without success gives no address (AC-2)", () => {
    expect(readBranchPreview(answer(run({ conclusion: "failure" })))).toEqual({});
  });

  test("the newest of two Cloudflare runs is the one that counts (AC-2)", () => {
    const old = run({ id: 1 });
    const building = run({ id: 2, status: "in_progress", conclusion: null });
    expect(readBranchPreview(answer(old, building))).toEqual({});
    expect(readBranchPreview(answer(building, old))).toEqual({});
  });

  test("output that is not a check-runs object is no answer (AC-2)", () => {
    expect(readBranchPreview("oops")).toBeNull();
    expect(readBranchPreview("")).toBeNull();
    expect(readBranchPreview("[]")).toBeNull();
    expect(readBranchPreview('{"message":"Not Found"}')).toBeNull();
  });
});

describe("askBranchPreview", () => {
  test("asks gh about the branch's check runs in the code root (AC-1)", async () => {
    const asked: { dir: string; args: string[] }[] = [];
    const ghRun: GhRunner = async (dir, args) => {
      asked.push({ dir, args });
      return { code: 0, stdout: answer(run()) };
    };
    expect(await askBranchPreview(ghRun, "/code/woodstack", "aide/40-x")).toEqual({ address: BRANCH_URL });
    expect(asked).toEqual([{ dir: "/code/woodstack", args: branchPreviewArgs("aide/40-x") }]);
    expect(branchPreviewArgs("aide/40-x")).toEqual(["api", "repos/{owner}/{repo}/commits/aide/40-x/check-runs"]);
  });

  test("a gh that exits non-zero is no answer (AC-2)", async () => {
    const ghRun: GhRunner = async () => ({ code: 1, stdout: answer(run()) });
    expect(await askBranchPreview(ghRun, "/code/woodstack", "aide/40-x")).toBeNull();
  });
});
