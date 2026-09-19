// Which test covers which requirement, as the implement step's runner
// recorded it (`core/scripts/lib/run-spec-ac-coverage.sh`): the tests
// whose names carry an AC-id, out of the lines the branch added. Shown
// under each acceptance row, so whoever ticks it sees what proves it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface AcTest {
  file: string;
  name: string;
}

/** The record beside a spec's `4-status.md`, or `null` where there is
 *  none — a spec implemented before the record existed, or one with no
 *  criteria. A record that does not parse reads as none. */
export function readAcCoverage(dir: string): Record<string, AcTest[]> | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "ac-coverage.json"), "utf-8"));
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
): (T & { tests?: AcTest[]; untested?: boolean })[] {
  if (!coverage) return rows;
  return rows.map((row) => {
    const id = /^(AC-\d+):/.exec(row.task)?.[1];
    if (!id || !(id in coverage)) return row;
    const tests = coverage[id] ?? [];
    return tests.length > 0
      ? { ...row, tests }
      : { ...row, untested: !(row.note ?? "").startsWith("Not tested:") };
  });
}
