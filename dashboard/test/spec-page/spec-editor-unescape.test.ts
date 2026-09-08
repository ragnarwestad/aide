// The damage this undoes is on spec 417's own description, in the specs
// repo: `\#\# Requirements` where a heading was, and `\- \*\*REQ\-1:\*\*`
// where the requirement bullets were. The editor writes that whenever it
// is holding markdown as literal text — a paste into the WYSIWYG
// surface — and these files are markdown source, so it comes back off.

import { describe, expect, test } from "bun:test";
import { unescapeMarkdown } from "../../src/spec-editor/unescape-markdown.ts";

describe("unescapeMarkdown", () => {
  test("the exact damage seen on 417: a heading and its REQ bullets come back", () => {
    const damaged =
      "\\#\\# Requirements\n\n" +
      "\\- \\*\\*REQ\\-1:\\*\\* The column SHALL be renamed to \"State/Action\"\\.\n" +
      "\\- \\*\\*REQ\\-2:\\*\\* The Norwegian one SHALL be renamed too\\.\n";
    expect(unescapeMarkdown(damaged)).toBe(
      "## Requirements\n\n" +
        '- **REQ-1:** The column SHALL be renamed to "State/Action".\n' +
        "- **REQ-2:** The Norwegian one SHALL be renamed too.\n",
    );
  });

  test("markdown that was never escaped is returned byte for byte", () => {
    const clean = "# Title\n\n- **REQ-1:** a thing\n\n---\n\n*emphasis* and `code`\n";
    expect(unescapeMarkdown(clean)).toBe(clean);
  });

  // A backslash in code is far more likely to be meant: a regex in a
  // fence, a `\d` in a span. Those are the one place the escapes stay.
  test("a fenced code block keeps every backslash it has", () => {
    const text = "before \\* after\n\n```ts\nconst re = /\\d\\.\\*/;\n```\n\nafter \\# here\n";
    expect(unescapeMarkdown(text)).toBe(
      "before * after\n\n```ts\nconst re = /\\d\\.\\*/;\n```\n\nafter # here\n",
    );
  });

  test("a tilde fence is a fence too, and only its own character closes it", () => {
    const text = "~~~\n\\.\n```\n\\.\n~~~\n\\.\n";
    expect(unescapeMarkdown(text)).toBe("~~~\n\\.\n```\n\\.\n~~~\n.\n");
  });

  test("an inline code span keeps its backslashes while the text around it loses them", () => {
    expect(unescapeMarkdown("say \\*this\\* but `not \\*that\\*` here\\.")).toBe(
      "say *this* but `not \\*that\\*` here.",
    );
  });

  test("an unmatched backtick opens nothing", () => {
    expect(unescapeMarkdown("a ` lone tick and \\*this\\*")).toBe("a ` lone tick and *this*");
  });

  test("a backslash before a character markdown never escapes is left alone", () => {
    expect(unescapeMarkdown("C:\\temp and \\n and \\q")).toBe("C:\\temp and \\n and \\q");
  });

  test("a doubled backslash was an escaped backslash, and becomes one", () => {
    expect(unescapeMarkdown("a \\\\ b")).toBe("a \\ b");
  });

  test("a trailing lone backslash is left as it stands", () => {
    expect(unescapeMarkdown("ends with \\")).toBe("ends with \\");
  });
});
