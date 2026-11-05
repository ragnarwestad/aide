// A step whose work did not reach origin names the repo, the branch and
// why, from what the runner sorted out of git's own words; a step refused
// for a conflict names the files. The runner's own English stays the (?).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store, enqueue, makeRunner, okResult, resetHarness, cleanupHarness } from "../runner-fixtures.ts";
import { renderSentence } from "../../../../src/i18n/message.ts";
import { gitFailureMessage } from "../../../../src/queue/runner/git-failure.ts";

beforeEach(resetHarness);
afterEach(cleanupHarness);

const BRANCH = "aide/49-crop-the-cover-image";
// What the runner wrote for a real step on the serving host, less its paths.
const UNPUSHED =
  "the step's own work did not reach origin: /x/code, /x/specs — cannot push " + BRANCH +
  " in /x/code, and origin did not answer: git@github.com: Permission denied (publickey).";

const unpushed = (pushFailures: unknown) => ({ ok: false, terminalReason: "unpushed", pushFailures });

describe("gitFailureMessage", () => {
  test("one repo whose push failed: the repo, the branch, and why", () => {
    expect(gitFailureMessage(unpushed([{ repo: "code", branch: BRANCH, kind: "auth" }]))).toEqual({
      key: "runner.notPushedCode",
      values: { branch: BRANCH },
      inner: { key: "git.pushAuth" },
    });
  });

  test("both repos: one sentence each, a refusal with origin's own words", () => {
    const m = gitFailureMessage(
      unpushed([
        { repo: "code", branch: BRANCH, kind: "github" },
        { repo: "specs", branch: BRANCH, kind: "refused", message: "GH006: Protected branch update failed" },
      ]),
    );
    expect(m).toEqual([
      { key: "runner.notPushedCode", values: { branch: BRANCH }, inner: { key: "git.pushGitHub" } },
      {
        key: "runner.notPushedSpecs",
        values: { branch: BRANCH },
        inner: { key: "git.pushRefused", values: { cause: "GH006: Protected branch update failed" } },
      },
    ]);
  });

  test("a repo left unpushed with nothing said is told that no error text was given", () => {
    expect(gitFailureMessage(unpushed([{ repo: "specs", branch: BRANCH, kind: "none" }]))).toMatchObject({
      inner: { key: "git.pushNoText" },
    });
  });

  test("a refusal for a conflict names the files, five at most and how many more", () => {
    const m = gitFailureMessage({
      ok: false,
      terminalReason: "refused",
      errorReason: "conflict",
      conflict: { repo: "code", branch: BRANCH, base: "main", files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"], more: 2 },
    });
    expect(m).toEqual({
      key: "runner.conflictCode",
      values: { branch: BRANCH, base: "main", files: "a.ts, b.ts, c.ts, d.ts, e.ts (+2)" },
    });
  });

  test("an entry the runner does not write, or another ending, is no message of this kind", () => {
    expect(gitFailureMessage(unpushed([{ repo: "code", branch: BRANCH, kind: "other" }]))).toBeUndefined();
    expect(gitFailureMessage(unpushed([{ repo: "elsewhere", branch: BRANCH, kind: "auth" }]))).toBeUndefined();
    expect(gitFailureMessage(unpushed(undefined))).toBeUndefined();
    expect(gitFailureMessage({ ok: false, terminalReason: "refused", errorReason: "conflict" })).toBeUndefined();
    expect(
      gitFailureMessage({ ok: false, terminalReason: "cli-error", pushFailures: [{ repo: "code", branch: BRANCH, kind: "auth" }] }),
    ).toBeUndefined();
  });
});

describe("a step whose push GitHub did not take the key for", () => {
  const run = () => {
    const job = enqueue({ steps: ["implement"] });
    const runner = makeRunner({
      readResult: () => ({
        ...okResult(0.1),
        ...unpushed([{ repo: "code", branch: BRANCH, kind: "auth" }]),
        error: UNPUSHED,
      }),
    });
    runner.tick();
    runner.poll();
    return store.get(job.id);
  };

  test("ends failed naming the repo, the branch and the key, with the runner's words behind the (?)", () => {
    const after = run();
    expect(after?.state).toBe("failed");
    expect(after?.error).toEqual({ key: "runner.notPushedCode", values: { branch: BRANCH }, inner: { key: "git.pushAuth" } });
    expect(after?.errorDetail).toBe(UNPUSHED);
  });

  test("reads in Norwegian as GitHub not taking the key of the machine that runs Aide", () => {
    const text = renderSentence("nb", run()?.error as Parameters<typeof renderSentence>[1]) ?? "";
    expect(text).toContain(BRANCH);
    expect(text).toContain("GitHub godtar ikke SSH-nøkkelen til maskinen som kjører Aide");
  });
});

describe("a step refused because main could not be fetched", () => {
  const refused = (fetchFailure: unknown) => ({ ok: false, terminalReason: "refused", fetchFailure });

  test("names the repo and the base, with why sorted like a failed push", () => {
    expect(gitFailureMessage(refused({ repo: "code", branch: "main", kind: "auth" }))).toEqual({
      key: "runner.notFetchedCode",
      values: { base: "main" },
      inner: { key: "git.pushAuth" },
    });
  });

  test("git's own first line, or no text, says to fetch by hand rather than to push", () => {
    expect(gitFailureMessage(refused({ repo: "specs", branch: "main", kind: "other", message: "bad object" }))).toEqual({
      key: "runner.notFetchedSpecs",
      values: { base: "main" },
      inner: { key: "git.fetchOther", values: { cause: "bad object" } },
    });
    expect(gitFailureMessage(refused({ repo: "code", branch: "main", kind: "none" }))).toMatchObject({
      inner: { key: "git.fetchNoText" },
    });
  });

  test("reads in Norwegian as GitHub not taking the key, naming the base", () => {
    const text = renderSentence("nb", gitFailureMessage(refused({ repo: "code", branch: "main", kind: "auth" })) as Parameters<typeof renderSentence>[1]) ?? "";
    expect(text).toContain("main");
    expect(text).toContain("GitHub godtar ikke SSH-nøkkelen");
  });
});
