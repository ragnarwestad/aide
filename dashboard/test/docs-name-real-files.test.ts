// The docs and CLAUDE.md name source files by path, and the source
// moves — a file split into a directory, a module folded into another —
// while the sentence naming it stays behind. A reader who follows a
// dead path loses the thread, and nothing else notices.
//
// Every backticked `src/…ts` or `test/…ts` path in the pages below must
// exist. Paths under `dashboard/` written from the repo root count too,
// with the prefix stripped.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const PAGES = [
  "CLAUDE.md",
  "README.md",
  "../.claude/CLAUDE.md",
  "../.claude/rules/development.md",
  ...[...new Bun.Glob("docs/**/*.md").scanSync(ROOT)],
];

const PATH_IN_BACKTICKS = /`(?:dashboard\/)?((?:src|test)\/[A-Za-z0-9_./-]+\.ts)`/g;

describe("every source file the docs name exists", () => {
  for (const page of PAGES) {
    test(page, () => {
      const text = readFileSync(join(ROOT, page), "utf-8");
      const missing = [...text.matchAll(PATH_IN_BACKTICKS)]
        .map((m) => m[1]!)
        .filter((p) => !existsSync(join(ROOT, p)));
      expect(missing).toEqual([]);
    });
  }
});
