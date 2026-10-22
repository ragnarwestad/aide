// The Jobs tab's search box, its state dropdown and its sortable head, drawn
// from the Specs list's own pieces. `view.ts` decides what each offers, counts
// and links to; this file draws it and decides nothing of its own. The bar
// ends in the Specs list's New button, drawn by the same function.

import { t, type Language } from "../../../i18n";
import { esc } from "../../ui/html.ts";
import { SORTS, SORT_DEFAULT_DIR, stateFilterLabel, type SpecsFilter } from "../specs-list/data-model";
import type { SpecsPageOptions } from "../specs-list";
import { menuDropdown, newSpecLink, searchForm, sortHead } from "../specs-list/filter-bar.ts";
import {
  jobsSortPatch,
  jobsStateFilter,
  jobsStateOptions,
  jobsViewPath,
  type RowFacts,
} from "./view.ts";

/** The keys that travel on as hidden fields of the search form, so a search
 *  keeps the filter, the column and the folds the reader had. */
const KEPT = ["sort", "dir", "open", "checks", "phases"] as const;

/** The search box with the state dropdown after its help, and New after the dropdown. */
export function jobsFilterBar(
  facts: RowFacts[],
  f: SpecsFilter,
  lang: Language,
  opts: Pick<SpecsPageOptions, "createProjects"> = {},
): string {
  const state = menuDropdown({
    filter: "state",
    ariaLabel: t(lang, "list.statesLabel"),
    options: jobsStateOptions(facts, f).map((o) => ({
      label: stateFilterLabel(o.key, lang),
      count: o.count,
      on: o.on,
      href: esc(jobsViewPath(f, { state: o.key })),
    })),
  });
  return searchForm(
    {
      action: "/",
      hidden: [["state", jobsStateFilter(f.state).key], ...KEPT.filter((k) => f[k]).map((k): [string, string] => [k, f[k]!])],
      q: f.q ?? "",
      clearHref: esc(jobsViewPath(f, { q: "" })),
      after: state + newSpecLink(opts, lang),
    },
    lang,
  );
}

/** The table head: every heading sorts, none is marked while the tab keeps
 *  its own order, and the second is headed Title. */
export function jobsHead(f: SpecsFilter, lang: Language): string {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort : undefined;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort ?? "created"]!;
  return sortHead(
    {
      now: { sort, dir },
      href: (key) => esc(jobsViewPath(f, jobsSortPatch(f, key))),
      specLabel: "jobs.colTitle",
    },
    lang,
  );
}
