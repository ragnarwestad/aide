// A scheduled job lives in the serving host's `queue-config.json`, not in a
// project's manifest and not in git. The comment in `dashboard-checkout.ts`,
// the docs' scheduling section and this repository's own manifest each say
// so in prose or data nothing else checks, so this is a plain grep-based
// regression guard, the same shape `docs-name-real-files.test.ts` uses.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "..", "..");

test("dashboard-checkout.ts says nobody commits in the checkouts but a spec Save, and does not name schedule-admin.ts (AC-6)", () => {
  const text = readFileSync(join(ROOT, "src/git/dashboard-checkout.ts"), "utf-8");
  expect(text).toContain("nobody commits in them");
  expect(text).toContain("saveSpecFile");
  expect(text).not.toContain("schedule-admin.ts");
});

describe("docs/running-specs.md's scheduling section (AC-6)", () => {
  // Collapsed to single spaces: the markdown itself hard-wraps this
  // paragraph, so a literal substring check would break on a rewrap
  // that changes no meaning at all.
  const flat = readFileSync(join(ROOT, "docs/running-specs.md"), "utf-8").replace(/\s+/g, " ");

  test("names queue-config.json, keyed by project, with no jobs on a fresh install and nothing committed", () => {
    expect(flat).toContain("`queue-config.json`");
    expect(flat).toContain("keyed by project");
    expect(flat).toContain("A fresh install has no scheduled jobs");
    expect(flat).toContain("commits nothing");
  });

  test("has no schedule: list and no push from the dashboard's checkout", () => {
    expect(flat).not.toContain("schedule:");
    expect(flat).not.toContain("from the dashboard's own checkout immediately");
  });
});

test("this repository's .aide/project.yaml has no schedule key (AC-4)", () => {
  const manifest = parse(readFileSync(join(ROOT, "..", ".aide", "project.yaml"), "utf-8")) as Record<string, unknown>;
  expect(manifest).not.toHaveProperty("schedule");
});
