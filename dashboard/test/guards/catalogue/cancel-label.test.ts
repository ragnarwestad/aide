// No source file but the catalogue writes the Cancel label by hand: every
// Cancel button reads `dialog.cancel`, and every confirmation is asked in
// the reader's language.

import { describe, expect, test } from "bun:test";
import { read } from "../source.ts";

const sources = read("src/**/*.ts").filter((s) => !s.file.startsWith("src/i18n/") && !s.file.endsWith(".test.ts"));

describe("the Cancel label is the catalogue's", () => {
  test("no file writes \"Cancel\" as a label (AC-5)", () => {
    const hits = sources.filter((s) => /label:\s*["'`]Cancel["'`]/.test(s.text)).map((s) => s.file);
    expect(hits).toEqual([]);
  });

  test("no file asks a confirmation in English by hand (AC-5)", () => {
    const hits = sources.filter((s) => /confirmDialog\(\s*["']en["']/.test(s.text)).map((s) => s.file);
    expect(hits).toEqual([]);
  });
});
