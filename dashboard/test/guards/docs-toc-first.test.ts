// Every documentation page opens with its title and then its table of
// contents, before any other text: the documentation standard's order, and
// the first thing a reader or an AI assistant uses to find its way.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DASHBOARD = join(import.meta.dir, "..", "..");
const DIRS = [join(DASHBOARD, "docs"), join(DASHBOARD, "..", "docs")];

const pages = DIRS.flatMap((dir) =>
  readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => join(dir, f)),
);

test.each(pages.map((p) => [p.slice(DASHBOARD.length - "dashboard".length), p]))(
  "%s has its table of contents first, under its title",
  (_name, path) => {
    const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.trim() !== "");
    expect(lines[0]!.startsWith("# ")).toBe(true);
    expect(lines[1]).toBe("## Table of contents");
  },
);
