// The configuration reference and the dashboard's docs name only the
// manifest keys the dashboard reads. A key that is documented but read by
// nothing sends a reader to set something that changes nothing.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../../src/project/parse-manifest.ts";

const REPO = join(import.meta.dir, "..", "..", "..", "..");
const DASHBOARD = join(REPO, "dashboard");
const CONFIGURATION = join(REPO, "docs", "CONFIGURATION.md");

const RETIRED_KEYS = [
  "stack", "dependencies", "logging", "statistics", "reports", "docs", "reuse", "generated", "installCmd",
  "deployment.host", "deployment.command", "deployment.url", "deployment.note", "deployment.preview",
];

const pages = [
  CONFIGURATION,
  join(DASHBOARD, "README.md"),
  join(DASHBOARD, "CLAUDE.md"),
  ...readdirSync(join(DASHBOARD, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(DASHBOARD, "docs", f)),
];

/** The keys in the first column of the `.aide/project.yaml` section's table. */
function manifestTableKeys(): string[] {
  const text = readFileSync(CONFIGURATION, "utf-8");
  const section = text.split(/^## /m).find((s) => s.startsWith(".aide/project.yaml"));
  if (!section) throw new Error("docs/CONFIGURATION.md has no .aide/project.yaml section");
  return [...section.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]!);
}

/** A manifest that sets the key to a value of the shape the parser accepts. */
function manifestSetting(key: string): string {
  if (key === "deployment.previewFrom") return "name: p\ndeployment:\n  previewFrom: command\n";
  if (key === "codeLanding") return "name: p\ncodeLanding: pr\n";
  const [head, ...rest] = key.split(".");
  if (rest.length === 0) return head === "name" ? "name: x\n" : `name: p\n${head}: x\n`;
  return `name: p\n${head}:\n  ${rest.join(".")}: x\n`;
}

describe("the configuration reference's manifest table", () => {
  test("names at least the keys a run reads", () => {
    const keys = manifestTableKeys();
    for (const key of ["AIDE_TEST_CMD", "worktreeLinks", "codeLanding", "name"]) expect(keys).toContain(key);
  });

  test("every key in it reads back through the parser (AC-4)", () => {
    for (const key of manifestTableKeys()) {
      const result = parseManifest(manifestSetting(key));
      if (!result.ok) throw new Error(result.error);
      const path = key.split(".");
      let value: unknown = result.data;
      for (const part of path) value = (value as Record<string, unknown> | undefined)?.[part];
      expect([key, value === undefined]).toEqual([key, false]);
    }
  });
});

describe("no page names a manifest key that nothing reads", () => {
  test("none of the retired keys is written as a code span (AC-4)", () => {
    const hits: string[] = [];
    for (const page of pages) {
      const text = readFileSync(page, "utf-8");
      for (const key of RETIRED_KEYS) {
        if (text.includes(`\`${key}\``)) hits.push(`${page.slice(REPO.length + 1)}: ${key}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
