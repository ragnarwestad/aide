// The Code-landing choice, in the reader's own words: the branch it
// would merge into is named, and the pull request it would make is
// described as being made. "The default branch" is GitHub's term for a
// setting on another site; "leave it for a pull request" read as though
// nothing would happen, while a `pr` landing runs `gh pr create`.

import { describe, expect, test } from "bun:test";
import { PREVIEW_FROMS } from "../../../src/project/parse-manifest.ts";
import { renderAddProjectPage } from "../../../src/render";
import { codeLandingChoices, previewFromChoices } from "../../../src/render/pages/projects-page/settings-table.ts";

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

describe("the Try a branch choice", () => {
  // The words the manifest parser keeps are the words the form offers:
  // a word in one list and not the other is a choice that saves as
  // something no reader recognises.
  test("its values are the three words the manifest parser keeps (AC-1)", () => {
    expect(previewFromChoices().map((o) => o.value)).toEqual([...PREVIEW_FROMS]);
    expect(previewFromChoices().map((o) => o.value)).toEqual(["none", "command", "cloudflare-pages"]);
  });

  test("the Add project form asks it and starts on none (AC-1)", () => {
    const html = renderAddProjectPage([{ label: "Projects", path: "/projects" }], "2026-09-20T00:00:00Z", {});
    const select = html.match(/<select name="previewFrom"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
    expect([...select.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(["none", "command", "cloudflare-pages"]);
    expect([...select.matchAll(/<option value="([^"]*)"[^>]*selected/g)].map((m) => m[1])).toEqual(["none"]);
  });
});
