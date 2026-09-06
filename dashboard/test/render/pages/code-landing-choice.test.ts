// The Code-landing choice, in the reader's own words: the branch it
// would merge into is named, and the pull request it would make is
// described as being made. "The default branch" is GitHub's term for a
// setting on another site; "leave it for a pull request" read as though
// nothing would happen, while a `pr` landing runs `gh pr create`.

import { describe, expect, test } from "bun:test";
import { codeLandingChoices } from "../../../src/render/pages/site/settings-table.ts";

describe("the Code-landing choice says what it does", () => {
  test("the merge choice names the project's own branch", () => {
    expect(codeLandingChoices("main")[0]!.label).toBe("Merge into main");
    // Not uniform across projects — this repo is `master`.
    expect(codeLandingChoices("master")[0]!.label).toBe("Merge into master");
  });

  // The Add form asks before the project is on this machine, and a
  // checkout that cannot be reached has no name to give either.
  test("with no name to give, it says which branch it means in words", () => {
    expect(codeLandingChoices(null)[0]!.label).toBe("Merge into the project's main branch");
    expect(codeLandingChoices(null)[0]!.label).not.toContain("default branch");
  });

  test("the pull-request choice says the request is created", () => {
    const pr = codeLandingChoices("main")[1]!;
    expect(pr.value).toBe("pr");
    expect(pr.label).toBe("Create a pull request");
  });

  // The values are what the manifest stores, and are not translated
  // along with the labels.
  test("the stored values are unchanged", () => {
    expect(codeLandingChoices("main").map((o) => o.value)).toEqual(["merge", "pr"]);
  });
});
