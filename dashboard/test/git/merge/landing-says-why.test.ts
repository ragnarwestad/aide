// A merge whose push failed says why in the board's own words, and a merge
// that conflicts names the files. git's own lines stay the (?) detail,
// whole, without the carriage return ssh writes.

import { describe, expect, test } from "bun:test";
import { mergeBranchIntoDefault } from "../../../src/git/branch-merge/index.ts";
import { fakeGit, CLEAN_MASTER } from "../../helpers/fake-git.ts";
import { renderSentence } from "../../../src/i18n/message.ts";

const BRANCH = "aide/49-crop-the-cover-image";
const ROOT = "/repos/skjera";
const noWait = async (_ms: number): Promise<void> => {};
const sentence = (lang: "en" | "nb", s: unknown): string =>
  renderSentence(lang, s as Parameters<typeof renderSentence>[1]) ?? "";

const REACHES_THE_PUSH = {
  ...CLEAN_MASTER,
  "ls-remote --exit-code": { code: 0, stdout: "deadbeef\trefs/heads/aide/49-crop-the-cover-image\n" },
  "merge -q --ff-only": { code: 0 },
  fetch: { code: 0 },
};

const PUBLICKEY =
  "git@github.com: Permission denied (publickey).\r\nfatal: Could not read from remote repository.\n\n" +
  "Please make sure you have the correct access rights\nand the repository exists.\n";

describe("a merge whose push failed", () => {
  test("an SSH key GitHub does not take is said as such, not as an origin that could not be reached", async () => {
    const git = fakeGit({
      ...REACHES_THE_PUSH,
      "ls-remote origin": { code: 128, stderr: PUBLICKEY },
      push: { code: 128, stderr: PUBLICKEY },
    });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "main", noWait);
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ key: "landing.pushFailedTo", inner: { key: "git.pushAuth" } });
    expect(sentence("nb", result.error)).toContain("GitHub godtar ikke SSH-nøkkelen til maskinen som kjører Aide");
    expect(result.detail).toBe(
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n" +
        "Please make sure you have the correct access rights\nand the repository exists.",
    );
  });

  test("a push that said nothing says that no error text was given", async () => {
    const git = fakeGit({ ...REACHES_THE_PUSH, "ls-remote origin": { code: 128 }, push: { code: 128 } });
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "main", noWait);
    expect(result.error).toMatchObject({ key: "landing.pushFailedTo", inner: { key: "git.pushNoText" } });
  });

  test("the push and the question to origin get longer than the four-second default", async () => {
    const asked: (number | undefined)[] = [];
    const git = fakeGit({ ...REACHES_THE_PUSH, "ls-remote origin": { code: 0 }, push: { code: 0 } });
    const run: typeof git.run = (dir, args, timeoutMs) => {
      if (args[0] === "push" && !args.includes("--delete")) asked.push(timeoutMs);
      return git.run(dir, args, timeoutMs);
    };
    await mergeBranchIntoDefault(run, ROOT, BRANCH, "main", noWait);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((ms) => (ms ?? 0) >= 60_000)).toBe(true);
  });
});

describe("a merge that conflicts", () => {
  const conflicting = (files: string) =>
    fakeGit({
      ...REACHES_THE_PUSH,
      "merge -q --ff-only": { code: 1 },
      "merge -q --no-edit": { code: 1, stdout: "CONFLICT (content): Merge conflict in a.ts\n" },
      "diff --name-only --diff-filter=U": { code: 0, stdout: files },
      "merge --abort": { code: 0 },
    });

  test("names the files in conflict, read before the merge is undone, and stays a conflict", async () => {
    const git = conflicting("a.ts\nb.ts\n");
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "main", noWait);
    expect(result.reason).toBe("conflict");
    expect(result.error).toMatchObject({ key: "landing.mergeConflictIn", values: { files: ["a.ts", "b.ts"] } });
    expect(result.detail).toContain("CONFLICT (content): Merge conflict in a.ts");
    const asked = git.calls.map((c) => c.args.join(" "));
    expect(asked.indexOf("diff --name-only --diff-filter=U")).toBeLessThan(asked.indexOf("merge --abort"));
  });

  test("keeps every conflict file as its own detail item (AC-3, AC-5)", async () => {
    const git = conflicting("1\n2\n3\n4\n5\n6\n7\n");
    const result = await mergeBranchIntoDefault(git.run, ROOT, BRANCH, "main", noWait);
    expect(result.error).toMatchObject({ values: { files: ["1", "2", "3", "4", "5", "6", "7"] } });
  });
});
