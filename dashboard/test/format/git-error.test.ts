// What git said when a push failed, sorted for the board. `git_error_json`
// and `git_error_detail` (core/scripts/lib/git-error.sh) sort a run's own
// pushes the same way, and core/tests/fixtures/git-errors.json pins both.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gitError, gitErrorDetail } from "../../src/format/git-error.ts";

const CASES = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../../core/tests/fixtures/git-errors.json"),
    "utf-8",
  ),
).cases as {
  name: string;
  said: string;
  kind: string;
  message?: string;
  detail: string;
}[];

describe("gitError", () => {
  test.each(CASES)("$name", ({ said, kind, message }) => {
    const got = gitError(said);
    expect(got.kind as string).toBe(kind);
    expect("message" in got ? got.message : undefined).toBe(message);
  });
});

describe("gitErrorDetail", () => {
  test.each(CASES)("$name", ({ said, detail }) => {
    expect(gitErrorDetail(said)).toBe(detail);
  });
});
