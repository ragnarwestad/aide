// What `gh pr list` says about a spec's branch, read into the one fact the
// board needs: did its pull request merge, and from which head. An open
// request wins over a merged one, and an answer that cannot be read is no
// answer at all, never "not merged".

import { describe, expect, test } from "bun:test";
import {
  askPullRequest, pullRequestListArgs, readPullRequestList, type GhRunner,
} from "../../src/integrations/pull-requests.ts";

const list = (...requests: { state: string; headRefOid?: string }[]): string => JSON.stringify(requests);

describe("readPullRequestList", () => {
  test("a merged request alone gives its head (AC-1)", () => {
    expect(readPullRequestList(list({ state: "MERGED", headRefOid: "abc123" }))).toEqual({ merged: true, headSha: "abc123" });
  });

  test("the newest merged request is the one that counts (AC-1)", () => {
    const stdout = list({ state: "MERGED", headRefOid: "new" }, { state: "MERGED", headRefOid: "old" });
    expect(readPullRequestList(stdout)).toEqual({ merged: true, headSha: "new" });
  });

  test("an open request wins over a merged one (AC-2)", () => {
    const stdout = list({ state: "MERGED", headRefOid: "old" }, { state: "OPEN", headRefOid: "new" });
    expect(readPullRequestList(stdout)).toEqual({ merged: false });
    expect(readPullRequestList(list({ state: "OPEN", headRefOid: "new" }, { state: "MERGED", headRefOid: "old" }))).toEqual({
      merged: false,
    });
  });

  test("a request closed without merging, or none at all, is not merged (AC-2)", () => {
    expect(readPullRequestList(list({ state: "CLOSED", headRefOid: "x" }))).toEqual({ merged: false });
    expect(readPullRequestList("[]")).toEqual({ merged: false });
  });

  test("output that is not a JSON array is no answer (AC-2)", () => {
    expect(readPullRequestList("oops")).toBeNull();
    expect(readPullRequestList("")).toBeNull();
    expect(readPullRequestList('{"state":"MERGED"}')).toBeNull();
  });
});

describe("askPullRequest", () => {
  test("asks gh about the branch in the code root (AC-1)", async () => {
    const asked: { dir: string; args: string[] }[] = [];
    const run: GhRunner = async (dir, args) => {
      asked.push({ dir, args });
      return { code: 0, stdout: list({ state: "MERGED", headRefOid: "abc" }) };
    };
    expect(await askPullRequest(run, "/code/aide", "aide/37-x")).toEqual({ merged: true, headSha: "abc" });
    expect(asked).toEqual([{ dir: "/code/aide", args: pullRequestListArgs("aide/37-x") }]);
    expect(pullRequestListArgs("aide/37-x")).toContain("aide/37-x");
  });

  test("a failed gh is no answer (AC-2)", async () => {
    const run: GhRunner = async () => ({ code: 1, stdout: list({ state: "MERGED", headRefOid: "abc" }) });
    expect(await askPullRequest(run, "/code/aide", "aide/37-x")).toBeNull();
  });
});
