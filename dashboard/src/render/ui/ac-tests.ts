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
  const groups = prepareAcTests(row.tests);
  const kindLabel = (kind: "unit" | "browser") => t(lang, kind === "unit" ? "checks.unit" : "checks.browser");
  const kindIcon = (kind: "unit" | "browser"): string => {
    const label = kindLabel(kind);
    return `<span class="testkind"><span class="testkindicon ${kind}" role="img" aria-label="${esc(label)}"></span>${esc(label)}</span>`;
  };
  const kinds = (["unit", "browser"] as const).filter((kind) => row.tests!.some((test) => test.kind === kind));
  const body = groups.map((group) =>
    `<div class="testfile"><span class="testfilepath">${esc(group.file)}${group.kind === "browser" ? kindIcon("browser") : ""}</span>` +
    `<div class="testnames">${group.names.map(esc).join("<br>")}</div></div>`,
  ).join("");
  return `<div class="checktests">${foldDisclosure({
    summary: kinds.map(kindIcon).join(""),
    body,
    data: { testcriterion: `${scope}|${number}` },
    arrowAfter: true,
  })}</div>`;
}
