// The specs directory setting has one name, "Specs path", everywhere a
// reader meets it. The lower-case "specs root" that names the
// directory itself is a different word and stays.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD = join(import.meta.dir, "..", "..");
const pages = [
  join(DASHBOARD, "README.md"),
  ...readdirSync(join(DASHBOARD, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(DASHBOARD, "docs", f)),
];

describe("the docs name the setting Specs path", () => {
  test("no page writes Specs root with a capital S (AC-4)", () => {
    const hits = pages.filter((p) => /Specs root/.test(readFileSync(p, "utf-8")));
    expect(hits).toEqual([]);
  });
});
