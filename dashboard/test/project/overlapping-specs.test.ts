// The specs a stopped analysis recorded as sharing its files (`### Overlapping
// specs` in 2-analysis.md), less those archived since — and the reader held to
// the one `aide-spec-overlap` has in bash: one rule, written twice.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOverlappingSpecs, overlappingSpecsIn } from "../../src/project/overlapping-specs.ts";
import type { SpecRef } from "../../src/project/discover";

const SCRIPT = join(import.meta.dir, "../../../core/scripts/aide-spec-overlap");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "overlapping-specs-"));
  dirs.push(dir);
  return dir;
};

/** A spec folder whose 2-analysis.md holds `analysis`; the folder's path. */
function specWith(analysis: string | undefined): string {
  const dir = join(scratch(), "81-mine");
  mkdirSync(dir, { recursive: true });
  if (analysis !== undefined) writeFileSync(join(dir, "2-analysis.md"), analysis);
  return dir;
}

const RECORD = [
  "# Analysis",
  "",
  "## Round 1",
  "",
  "### Files to change",
  "",
  "- `src/a.ts`",
  "",
  "### Overlapping specs",
  "",
  "- `82-other` — `src/a.ts`, `src/b.ts`",
  "- `83-gone` — `src/a.ts`",
  "- `85-shut` — `src/c.ts`",
  "- `86-missing` — `src/d.ts`",
  "",
  "### Risks",
  "",
].join("\n");

const ref = (over: Partial<SpecRef>): SpecRef =>
  ({ folder: "x", dir: "/x", archived: false, closed: false, title: null, description: null, dependsOn: [], ...over }) as SpecRef;

const REFS: Record<string, SpecRef> = {
  "82-other": ref({ title: "The other thing" }),
  "83-gone": ref({ archived: true, title: "Gone" }),
  "85-shut": ref({ archived: true, closed: true, title: "Shut" }),
};

describe("openOverlappingSpecs", () => {
  test("keeps only the specs that are still open: archived, closed and missing ones are left out (AC-3)", () => {
    const open = openOverlappingSpecs(specWith(RECORD), (folder) => REFS[folder]);
    expect(open).toEqual([{ folder: "82-other", label: "82 The other thing", files: ["src/a.ts", "src/b.ts"] }]);
  });

  test("a spec with no title is named by its whole folder", () => {
    const open = openOverlappingSpecs(specWith(RECORD), (folder) => (folder === "82-other" ? ref({}) : undefined));
    expect(open?.[0]?.label).toBe("82-other");
  });

  test("every spec archived answers an empty list, not undefined (AC-4)", () => {
    const open = openOverlappingSpecs(specWith(RECORD), () => undefined);
    expect(open).toEqual([]);
  });

  test("no folder, no file and no subsection answer undefined (AC-2)", () => {
    expect(openOverlappingSpecs(undefined, () => undefined)).toBeUndefined();
    expect(openOverlappingSpecs(specWith(undefined), () => undefined)).toBeUndefined();
    expect(openOverlappingSpecs(specWith("# Analysis\n\n## Round 1\n\n### Files to change\n\n- `a.ts`\n"), () => undefined)).toBeUndefined();
  });
});

describe("overlappingSpecsIn", () => {
  test("reads the newest round alone, each path less ./ and a line number (AC-2)", () => {
    const text = [
      "## Round 1",
      "",
      "### Overlapping specs",
      "",
      "- `70-old` — `old.ts`",
      "",
      "## Round 2",
      "",
      "### Overlapping specs",
      "",
      "- `82-other` — `./a.ts:12`, `b.ts:3-9`",
      "",
    ].join("\n");
    expect(overlappingSpecsIn(text)).toEqual([{ spec: "82-other", files: ["a.ts", "b.ts"] }]);
  });

  test("is what `aide-spec-overlap` answers as `warned` for the same file (AC-2)", () => {
    const text = [
      "# Analysis",
      "",
      "## Round 1",
      "",
      "### Overlapping specs",
      "",
      "- `70-old` — `old.ts`",
      "",
      "## Round 2",
      "",
      "### Files to change",
      "",
      "- `mine.ts`",
      "",
      "### Overlapping specs",
      "",
      "- `82-other` — `./a.ts:12`, `b.ts`, `c.ts:3-9`",
      "- `84-third` — `d.ts`",
      "",
      "### Risks",
      "",
      "- `85-not-in-the-record` — `e.ts`",
      "",
    ].join("\n");
    const specsRoot = scratch();
    mkdirSync(join(specsRoot, "81-mine"));
    writeFileSync(join(specsRoot, "81-mine", "2-analysis.md"), text);
    const ran = Bun.spawnSync({
      cmd: ["bash", SCRIPT, "--specs-root", specsRoot, "--spec", "81-mine"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(ran.exitCode).toBe(0);
    const said = JSON.parse(ran.stdout.toString()) as { warned: { spec: string; files: string[] }[] };
    expect(said.warned.length).toBe(2);
    expect(overlappingSpecsIn(text)).toEqual(said.warned);
  });
});
