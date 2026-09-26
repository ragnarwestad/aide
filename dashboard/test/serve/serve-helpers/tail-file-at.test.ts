// `tailFileAt`: the tail of a file and the byte where it begins, which is
// what lets a transcript be cut at the byte offsets the run log names.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tailFile, tailFileAt } from "../../../src/serve/serve-helpers";

const file = (content: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), "tail-at-")), "f.jsonl");
  writeFileSync(path, content);
  return path;
};

describe("tailFileAt", () => {
  test("a file under the bound begins at 0 (AC-3)", () => {
    expect(tailFileAt(file("a\nb\n"), 100)).toEqual({ text: "a\nb\n", start: 0 });
  });

  test("a file over the bound gives its tail from the first whole line, and the byte it begins at (AC-3)", () => {
    const content = "æøå one\nsecond\nthird\n";
    const at = tailFileAt(file(content), 10);
    expect(at.text).toBe("third\n");
    expect(Buffer.from(content).subarray(at.start).toString()).toBe(at.text);
  });

  test("a window with no line break keeps its partial line and the window's start (AC-3)", () => {
    const content = "x".repeat(50);
    expect(tailFileAt(file(content), 10)).toEqual({ text: "x".repeat(10), start: 40 });
  });

  test("a missing file is an empty text at 0, and tailFile still answers the text alone (AC-3)", () => {
    expect(tailFileAt("/no/such/file")).toEqual({ text: "", start: 0 });
    const path = file("a\nb\nc\n");
    expect(tailFile(path, 4)).toBe(tailFileAt(path, 4).text);
  });
});
