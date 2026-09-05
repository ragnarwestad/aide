// Spec 400: schedule writes commit into the CODE checkout, so
// `dashboard-checkout.ts`'s "nobody commits in them" comment and
// `docs/running-specs.md`'s schedule section both had to stop claiming
// something no longer true. Neither claim is checked by any other test
// — there is no automated check on comment wording — so this is a
// plain grep-based regression guard, the same shape
// `docs-name-real-files.test.ts` already uses for a different prose
// claim (REQ-3, REQ-4).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

test("dashboard-checkout.ts names both exceptions to 'nobody commits in them' (REQ-3)", () => {
  const text = readFileSync(join(ROOT, "src/git/dashboard-checkout.ts"), "utf-8");
  expect(text).toContain("nobody commits in them");
  expect(text).toContain("saveSpecFile");
  expect(text).toContain("schedule-admin.ts");
});

describe("docs/running-specs.md's schedule section (REQ-4)", () => {
  // Collapsed to single spaces: the markdown itself hard-wraps this
  // paragraph, so a literal substring check would break on a rewrap
  // that changes no meaning at all.
  const flat = readFileSync(join(ROOT, "docs/running-specs.md"), "utf-8").replace(/\s+/g, " ");

  test("no longer claims there is no edit form", () => {
    expect(flat).not.toContain("no edit form");
  });

  test("says an edit through the interface commits and pushes with no manual git step", () => {
    expect(flat).toContain("commits and pushes the change from the dashboard's own checkout immediately");
    expect(flat).toContain("no manual git step");
  });
});
