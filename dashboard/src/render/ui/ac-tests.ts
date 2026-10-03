// The tests proving an acceptance row, grouped by file, or a warning
// that no test names it. Shared by the Status tab and Specs list.

import { t, type Language } from "../../i18n";
import type { AcTest } from "../../project/ac-coverage.ts";
import { esc } from "./html.ts";

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

export function acTestsLine(row: { task: string; tests?: AcTest[]; untested?: boolean }, lang: Language): string {
  if (row.untested) {
    const id = /^(AC-\d+):/.exec(row.task)?.[1] ?? "";
    return `<span class="checktests untested">${esc(t(lang, "checks.noTestNames", { id }))}</span>`;
  }
  if (!row.tests?.length) return "";
  const lines = prepareAcTests(row.tests).flatMap(group => [group.file, ...group.names]);
  const heading = t(lang, "checks.coveredBy", { names: "" }).trimEnd();
  return `<span class="checktests">${[heading, ...lines].map(esc).join("<br>")}</span>`;
}
