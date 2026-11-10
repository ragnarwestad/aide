import { describe, expect, test } from "bun:test";
import { capitalizeFirst, getErrorMessage, getWrittenMessage } from "../../../src/messages/shared/written.ts";
import { formatSentence } from "../../../src/messages/format.ts";

// The shared builder every render-facing sentence is
// migrated to call. Its whole job is refusing to compose a sentence
// with no resolution attached.

describe("getErrorMessage", () => {
  test("joins what and resolve with an em dash", () => {
    const { text } = getErrorMessage({ what: "A step's push did not reach origin.", resolve: "Pull it and push again." });
    expect(text).toBe("A step's push did not reach origin. — Pull it and push again.");
  });

  test("an exempt sentence carries no dash, just what", () => {
    const { text } = getErrorMessage({
      what: "this spec is archived — it is a record, and cannot be edited",
      exempt: "editing an archive is intentionally impossible",
    });
    expect(text).toBe("this spec is archived — it is a record, and cannot be edited");
  });

  test("detail becomes the title, never part of the text", () => {
    const { text, title } = getErrorMessage({
      what: "the merge failed.",
      resolve: "Resolve it by hand.",
      detail: "raw git stderr here",
    });
    expect(text).not.toContain("raw git stderr");
    expect(title).toBe("raw git stderr here");
  });

  test("gives the problem and the fix apart (AC-6)", () => {
    const sentence = getErrorMessage({ what: "the push did not reach origin", resolve: "pull it and push again" });
    expect(sentence.problem).toBe("the push did not reach origin");
    expect(sentence.solution).toBe("pull it and push again");
  });

  test("an exempt sentence has a problem and no fix (AC-6)", () => {
    const sentence = getErrorMessage({ what: "this spec is archived", exempt: "a record" });
    expect(sentence.problem).toBe("this spec is archived");
    expect(sentence.solution).toBeUndefined();
  });

  test("neither resolve nor exempt throws", () => {
    expect(() => getErrorMessage({ what: "something happened" })).toThrow(/neither resolve nor exempt/);
  });
});

// The finished sentence's own first letter, capitalized once
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

describe("getWrittenMessage", () => {
  test("a problem with a fix renders as a Problem line and a Solution line (AC-6)", () => {
    expect(formatSentence("en", getWrittenMessage("the push failed", "push it by hand"))).toBe(
      "Problem: The push failed\nSolution: Push it by hand",
    );
  });

  test("a problem without a fix renders as the Problem line alone (AC-6)", () => {
    expect(formatSentence("en", getWrittenMessage("this spec is archived"))).toBe("Problem: This spec is archived");
  });
});
