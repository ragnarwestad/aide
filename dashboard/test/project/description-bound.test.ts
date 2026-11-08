import { describe, expect, test } from "bun:test";
import { DESCRIPTION_MAX, descriptionPart } from "../../src/project/description-bound.ts";

const HEAD = "# T - Description\n\n## Table of contents\n\n- [Description](#description)\n\n---\n\n## Tracking info\n\n- **Task:** `1-t/`\n\n---\n\n";
const CLOSING = "*This description can be edited before /aide-analyze runs.*\n";

describe("the bound", () => {
  test("is 10,000 characters", () => {
    expect(DESCRIPTION_MAX).toBe(10000);
  });
});

describe("descriptionPart", () => {
  test("counts what lies between the Description heading and the create step's closing line, nested headings included (AC-1)", () => {
    const body = "## Problem\n\nIt breaks.\n\n## Acceptance criteria\n\n- **AC-1:** It works.";
    const file = `${HEAD}## Description\n\n${body}\n\n${CLOSING}`;
    expect(descriptionPart(file)).toBe(body);
  });

  test("stops at the template's closing note, and what follows it does not count (AC-1)", () => {
    const file =
      `${HEAD}## Description\n\nThe text.\n\n_(This field can be edited manually to add context.)_\n\n---\n\n## Related documents\n\n- x\n`;
    expect(descriptionPart(file)).toBe("The text.");
  });

  test("runs to the end of the file when no closing line follows", () => {
    expect(descriptionPart(`${HEAD}## Description\n\nOnly this.\n`)).toBe("Only this.");
  });

  test("counts a CRLF line break as one character (AC-1)", () => {
    const file = `${HEAD}## Description\n\na\nb\n\n${CLOSING}`.replace(/\n/g, "\r\n");
    expect(descriptionPart(file)).toBe("a\nb");
  });

  test("is null for a file with no Description heading, so nothing is bounded (AC-1)", () => {
    expect(descriptionPart("# T\n\n## Problem\n\nText\n")).toBeNull();
  });

  test("is not fooled by the heading's words inside a longer heading", () => {
    expect(descriptionPart("# T\n\n## Descriptions of things\n\nText\n")).toBeNull();
  });
});
