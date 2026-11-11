import { describe, expect, test } from "bun:test";
import { servedOlder } from "../../../src/serve/deployment";

const gitRun = (head: string) => async () => ({ code: 0, stdout: `${head}\n`, stderr: "" });

describe("servedOlder", () => {
  test("answers equal when the checkout and served board are the same (AC-5)", async () => {
    const answer = await servedOlder({ readServing: () => ({ sha: "abc1234", repoRoot: "/srv/aide" }), gitRun: gitRun("abc1234") }, "/srv/aide");
    expect(answer).toBe("equal");
  });

  test("answers both short commits when the served board is older (AC-5)", async () => {
    const answer = await servedOlder({ readServing: () => ({ sha: "1111111old", repoRoot: "/srv/aide" }), gitRun: gitRun("2222222new") }, "/srv/aide");
    expect(answer).toEqual({ served: "1111111", head: "2222222" });
  });

  test("answers unknown before the served board is known (AC-5)", async () => {
    const answer = await servedOlder({ readServing: () => ({ sha: null, repoRoot: null }), gitRun: gitRun("2222222new") }, "/srv/aide");
    expect(answer).toBe("unknown");
  });
});
