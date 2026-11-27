// The Tests line under Implement: how many tests the newest implement's own
// commits added and removed, drawn like the Review and Verify lines above it,
// with the count per folder in its title. Shown only when that implement
// touched a test, so a reader sees what a spec brings before it merges.

import { esc } from "../../../ui/html.ts";
import { t } from "../../../../i18n";
import type { TestChange } from "../../../../queue/runner/types.ts";
import type { Phase } from "../data-model";
import type { SpecsPageOptions } from "../";

export interface TestTotals {
  added: number;
  removed: number;
  dirs: TestChange[];
}

/** The tests the newest implement attempt added and removed, or nothing
 *  when it touched no test or has not finished. */
export function testTotalsOf(p: Phase): TestTotals | undefined {
  const dirs = (p.attempts[0]?.results ?? []).findLast((r) => r.step === "implement")?.testChanges;
  if (!dirs?.length) return undefined;
  return {
    added: dirs.reduce((n, d) => n + d.added, 0),
    removed: dirs.reduce((n, d) => n + d.removed, 0),
    dirs,
  };
}

/** The line itself, or no line. */
export function testsLine(p: Phase, opts: SpecsPageOptions): { tag: string; cells: string }[] {
  const totals = testTotalsOf(p);
  if (!totals) return [];
  const lang = opts.lang ?? "en";
  const title = [t(lang, "list.testsLineTitle"), ...totals.dirs.map((d) => `${d.dir} +${d.added} −${d.removed}`)].join("\n");
  return [{
    tag: `<tr class="subrow" data-side="tests">`,
    cells:
      `<td class="phasecell" colspan="2"><span class="phasefold">${esc(t(lang, "list.testsLine"))}</span></td>` +
      `<td class="modelcell"></td>` +
      `<td data-col="state"><span title="${esc(title)}">+${totals.added} −${totals.removed}</span></td>` +
      `<td data-col="started"></td>` +
      `<td class="num" data-col="cost"></td>`,
  }];
}
