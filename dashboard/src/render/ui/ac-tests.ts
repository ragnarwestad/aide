// The tests proving an acceptance row, grouped by file, or a warning
// that no test names it. Shared by the Status tab and Specs list.

import { t, type Language } from "../../i18n";
import type { AcTest } from "../../project/ac-coverage.ts";
import { esc } from "./html.ts";
import { foldDisclosure } from "./components";

function displayName(name: string): string {
  const id = "ac[-_]?\\d+";
  const list = id + "(?:[\\s,;/]+(?:and\\s+)?" + id + ")*";
  const shortened = name
    .replace(new RegExp("\\s*\\(" + list + "\\)\\s*$", "i"), "")
    .replace(new RegExp("(?:\\s+|\\s*[,;:–—-]\\s*)" + list + "\\s*$", "i"), "")
    .replace(/(?:_ac_?\d+)+(?=\([^)]*\):?\s*$|$)/i, "")
    .trimEnd();
  return shortened.trim() ? shortened : name;
}

export function prepareAcTests(tests: AcTest[]): { file: string; names: string[] }[] {
  const groups = new Map<string, { file: string; names: string[] }>();
  for (const test of tests) {
    let group = groups.get(test.file);
    if (!group) {
      group = { file: test.file, names: [] };
      groups.set(test.file, group);
    }
    group.names.push(displayName(test.name));
  }
  return [...groups.values()];
}

/** `scope` is the spec's key; with the criterion's number and the file it names
 *  a fold, so the page script can open it again after a redraw. */
export function acTestsLine(row: { task: string; tests?: AcTest[]; untested?: boolean }, lang: Language, scope = ""): string {
  if (row.untested) {
    const id = /^(AC-\d+):/.exec(row.task)?.[1] ?? "";
    return `<span class="checktests untested">${esc(t(lang, "checks.noTestNames", { id }))}</span>`;
  }
  if (!row.tests?.length) return "";
  // The number and not the id: the markup holds no `AC-` text.
  const number = /^AC-(\d+):/.exec(row.task)?.[1] ?? "";
  const folds = prepareAcTests(row.tests).map(group =>
    foldDisclosure({
      summary: `${esc(group.file)} (${group.names.length})`,
      body: group.names.map(esc).join("<br>"),
      data: { testfile: `${scope}|${number}|${group.file}` },
    }),
  );
  const heading = t(lang, "checks.coveredBy", { names: "" }).trimEnd();
  return `<div class="checktests">${esc(heading)}${folds.join("")}</div>`;
}
