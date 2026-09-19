// The line under an acceptance row that names the tests proving it, or
// says no test does (`project/ac-coverage.ts`). One line, the same on
// the spec page's Overview tab and in the Specs list's checks.

import { t, type Language } from "../../i18n";
import type { AcTest } from "../../project/ac-coverage.ts";
import { esc } from "./html.ts";

/** A browser test is outside the merge's test suite: it counts because
 *  the implement step ran it, and the line says so. */
const isBrowserTest = (test: AcTest): boolean => /(^|\/)e2e\//.test(test.file);

export function acTestsLine(row: { task: string; tests?: AcTest[]; untested?: boolean }, lang: Language): string {
  if (row.untested) {
    const id = /^(AC-\d+):/.exec(row.task)?.[1] ?? "";
    return `<span class="checktests untested">${esc(t(lang, "checks.noTestNames", { id }))}</span>`;
  }
  if (!row.tests?.length) return "";
  const names = row.tests
    .map((test) => (isBrowserTest(test) ? t(lang, "checks.browserTest", { name: test.name }) : test.name))
    .join(" · ");
  return `<span class="checktests">${esc(t(lang, "checks.coveredBy", { names }))}</span>`;
}
