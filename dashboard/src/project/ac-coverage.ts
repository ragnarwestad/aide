// Which test covers which requirement, as the implement step's runner
// recorded it (`core/scripts/lib/run-spec/record/ac-coverage.sh`): the tests
// whose names carry an AC-id, out of the lines the branch added. Shown
// under each acceptance row, so whoever ticks it sees what proves it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readStatusFromBranch } from "../git/branch-file.ts";
import type { GitRunner } from "../git/process/index.ts";
import { AC_COVERAGE_FILE } from "./spec-names.ts";

export interface AcTest {
  file: string;
  name: string;
  kind?: "unit" | "browser";
}

function kindFromFile(codeRoot: string, file: string): AcTest["kind"] {
  try {
    const code = readFileSync(join(codeRoot, file), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/^\s*#.*$/gm, "");
    const module = String.raw`(?:@playwright\/test|playwright)`;
    const named = String.raw`(?:\{[\s\S]*?\}|\*\s+as\s+\w+|[\w$]+(?:\s*,\s*(?:\{[\s\S]*?\}|\*\s+as\s+\w+))?)`;
    const browser = new RegExp(String.raw`\b(?:import|export)\s+(?:type\s+)?${named}\s+from\s*["']${module}["']`).test(code)
      || new RegExp(String.raw`\bimport\s*["']${module}["']`).test(code)
      || new RegExp(String.raw`\brequire\s*\(\s*["']${module}["']\s*\)`).test(code)
      || /^\s*(?:from\s+playwright(?:[._\s]|$)|import\s+playwright(?:[._\s]|$))/m.test(code);
    return browser ? "browser" : "unit";
  } catch {
    return undefined;
  }
}

/** The record beside a spec's `4-status.md`, or `null` where there is
 *  none — a spec implemented before the record existed, or one with no
 *  criteria. A record that does not parse reads as none. */
export function readAcCoverage(dir: string): Record<string, AcTest[]> | null {
  try {
    return parseAcCoverage(readFileSync(join(dir, AC_COVERAGE_FILE), "utf-8"));
  } catch {
    return null;
  }
}

/** The record on a spec's open branch, beside the `4-status.md` at
 *  `statusRelPath` — where implement wrote it. */
export async function branchAcCoverage(
  run: GitRunner,
  target: { root: string; branch: string },
  statusRelPath: string,
): Promise<Record<string, AcTest[]> | null> {
  const file = await readStatusFromBranch(run, target.root, target.branch, join(dirname(statusRelPath), AC_COVERAGE_FILE));
  return file ? parseAcCoverage(file.text) : null;
}

/** The same record from its text — the copy on a spec's open branch,
 *  where implement wrote it and where it stays until archive lands. */
export function parseAcCoverage(text: string): Record<string, AcTest[]> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed.acs === "object" && parsed.acs ? parsed.acs : null;
  } catch {
    return null;
  }
}

/** A row's tests, and whether it has none that anyone accounted for:
 *  analyze's "Not tested:" note says so already, and says why. Rows
 *  that name no AC-id, and every row where there is no record, come
 *  back as they were. */
export function withAcCoverage<T extends { task: string; note?: string }>(
  rows: T[],
  coverage: Record<string, AcTest[]> | null,
  codeRoot?: string,
): (T & { tests?: AcTest[]; untested?: boolean })[] {
  if (!coverage) return rows;
  return rows.map((row) => {
    const id = /^(AC-\d+):/.exec(row.task)?.[1];
    if (!id || !(id in coverage)) return row;
    const tests = (coverage[id] ?? []).map((test) => {
      if (test.kind || !codeRoot) return test;
      const kind = kindFromFile(codeRoot, test.file);
      return kind ? { ...test, kind } : test;
    });
    return tests.length > 0
      ? { ...row, tests }
      : { ...row, untested: !(row.note ?? "").startsWith("Not tested:") };
  });
}
