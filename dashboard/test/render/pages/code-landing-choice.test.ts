// The Code-landing choice, in the reader's own words: the branch it
// would merge into is named, and the pull request it would make is
// described as being made. "The default branch" is GitHub's term for a
// setting on another site; "leave it for a pull request" read as though
// nothing would happen, while a `pr` landing runs `gh pr create`.

import { describe, expect, test } from "bun:test";
import { codeLandingChoices } from "../../../src/render/pages/projects-page/settings-table.ts";

describe("the Code-landing choice says what it does", () => {
  test("the merge choice names the project's own branch", () => {
    expect(codeLandingChoices("main")[0]!.label).toBe("Merge into main");
    // Not uniform across projects — this repo is `master`.
    expect(codeLandingChoices("master")[0]!.label).toBe("Merge into master");
  });

  // The values are what the manifest stores, and are not translated
  // along with the labels.
  test("the stored values are unchanged", () => {
    expect(codeLandingChoices("main").map((o) => o.value)).toEqual(["merge", "pr"]);
  });
});
