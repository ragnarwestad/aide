import { describe, expect, test } from "bun:test";
import { capitalizeFirst, errorSentence } from "../../src/format/error-sentence.ts";

// spec 352, Step 0: the shared builder every render-facing sentence is
// migrated to call. Its whole job is refusing to compose a sentence
// with no resolution attached.

describe("errorSentence", () => {
  test("joins what and resolve with an em dash", () => {
    const { text } = errorSentence({ what: "A step's push did not reach origin.", resolve: "Pull it and push again." });
    expect(text).toBe("A step's push did not reach origin. — Pull it and push again.");
  });

  test("an exempt sentence carries no dash, just what", () => {
    const { text } = errorSentence({
      what: "this spec is archived — it is a record, and cannot be edited",
      exempt: "editing an archive is intentionally impossible",
    });
    expect(text).toBe("this spec is archived — it is a record, and cannot be edited");
  });

  test("detail becomes the title, never part of the text", () => {
    const { text, title } = errorSentence({
      what: "the merge failed.",
      resolve: "Resolve it by hand.",
      detail: "raw git stderr here",
    });
    expect(text).not.toContain("raw git stderr");
    expect(title).toBe("raw git stderr here");
  });

  test("neither resolve nor exempt throws", () => {
    expect(() => errorSentence({ what: "something happened" })).toThrow(/neither resolve nor exempt/);
  });
});

// spec 442: the finished sentence's own first letter, capitalized once
// at render time — never the message catalog's, which stays lowercase
// because its entries are reused both standalone and mid-sentence.
describe("capitalizeFirst", () => {
  test("capitalizes a lowercase-starting sentence", () => {
    expect(capitalizeFirst("archive merge failed: cannot merge into main")).toBe(
      "Archive merge failed: cannot merge into main",
    );
  });

  test("leaves an already-capitalized sentence unchanged", () => {
    expect(capitalizeFirst("Already capitalized.")).toBe("Already capitalized.");
  });

  test("an empty string is unchanged", () => {
    expect(capitalizeFirst("")).toBe("");
  });
});
