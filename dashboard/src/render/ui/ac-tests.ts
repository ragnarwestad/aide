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

export function prepareAcTests(tests: AcTest[]): { file: string; names: string[]; kind?: AcTest["kind"] }[] {
  const groups = new Map<string, { file: string; names: string[]; kind?: AcTest["kind"] }>();
  for (const test of tests) {
    let group = groups.get(test.file);
    if (!group) {
      group = { file: test.file, names: [], ...(test.kind ? { kind: test.kind } : {}) };
      groups.set(test.file, group);
    }
    group.names.push(displayName(test.name));
  }
  return [...groups.values()];
}

export function acTestKinds(tests: AcTest[]): { kind: AcTest["kind"]; tests: AcTest[]; count: number }[] {
  return (["unit", "browser", undefined] as const).map((kind) => {
    const matching = tests.filter((test) => test.kind === kind);
    return { kind, tests: matching, count: matching.length };
  }).filter((group) => group.kind !== undefined || group.count > 0);
}

/** Each test kind has its own stable fold key, so a redraw preserves it independently. */
export function acTestsLine(row: { task: string; tests?: AcTest[]; untested?: boolean }, lang: Language, scope = ""): string {
  const number = /^AC-(\d+):/.exec(row.task)?.[1];
  if (!number) return "";
  const lines = acTestKinds(row.tests ?? []).map(({ kind, tests, count }) => {
    const label = kind ? t(lang, kind === "unit" ? "checks.unit" : "checks.browser") : undefined;
    const summary = kind
      ? `<span class="testkind"><span class="testkindicon ${kind}" role="img" aria-label="${esc(label!)}"></span>${esc(label!)}: ${count}</span>`
      : esc(t(lang, "checks.coveredBy", { names: String(count) }));
    if (!count) return `<div>${summary}</div>`;
    const body = prepareAcTests(tests).map((group) =>
      `<div class="testfile"><span class="testfilepath">${esc(group.file)}</span>` +
      `<div class="testnames">${group.names.map(esc).join("<br>")}</div></div>`,
    ).join("");
    return foldDisclosure({ summary, body, data: { testcriterion: `${scope}|${number}${kind ? `|${kind}` : ""}` }, arrowAfter: true });
  }).join("");
  const warning = row.untested
    ? `<span class="untested">${esc(t(lang, "checks.noTestNames", { id: `AC-${number}` }))}</span>` : "";
  return `<div class="checktests">${lines}${warning}</div>`;
}
