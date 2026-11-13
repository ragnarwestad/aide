// The Jobs tab's search box, its state dropdown and its sortable head, drawn
// from the Specs list's own pieces. `view.ts` decides what each offers, counts
// and links to; this file draws it and decides nothing of its own. The bar
// ends in the New group button, which opens the dialog `execution-group-editor.ts` draws.

import { t, type Language } from "../../../i18n";
import { askButton } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { SORTS, SORT_DEFAULT_DIR, stateFilterLabel } from "../specs-list/data-model";
import { menuDropdown, searchForm, sortHead } from "../specs-list/filter-bar.ts";
import { NEW_GROUP_DIALOG } from "./execution-group-editor.ts";
import {
  jobsSortPatch,
  jobsKindOptions,
  jobsKindValue,
  jobsStateValue,
  jobsStateOptions,
  jobsViewPath,
  type JobsFilter,
  type RowFacts,
} from "./view.ts";

/** The keys that travel on as hidden fields of the search form, so a search
 *  keeps the filter, the column and the folds the reader had. */
const KEPT = ["sort", "dir", "open", "checks", "phases"] as const;
const KIND_LABELS = {
  spec: "jobs.filterKindSpec",
  deploy: "jobs.filterKindDeploy",
  schedule: "jobs.filterKindSchedule",
  cleanup: "jobs.filterKindCleanup",
  group: "jobs.filterKindGroup",
} as const;

/** The search box with the state dropdown after its help, and New group after the dropdown. */
export function jobsFilterBar(facts: RowFacts[], f: JobsFilter, lang: Language): string {
  const stateOptions = jobsStateOptions(facts, f);
  const kindOptions = jobsKindOptions(facts, f);
  const kindNarrowed = kindOptions.some((o) => o.on && o.key !== "all");
  const options = [
    ...stateOptions.map((o) => ({
      label: stateFilterLabel(o.key, lang),
      count: o.count,
      on: o.on,
      summary: o.on && (!kindNarrowed || o.key !== "all"),
      href: esc(jobsViewPath(f, { state: o.state })),
    })),
    ...kindOptions.map((o, index) => ({
      heading: index === 0 ? t(lang, "jobs.kindHeading") : undefined,
      label: o.key === "all" ? stateFilterLabel("all", lang) : t(lang, KIND_LABELS[o.key]),
      count: o.count,
      on: o.on,
      summary: o.on && o.key !== "all",
      href: esc(jobsViewPath(f, { kind: o.kind })),
    })),
  ];
  const state = menuDropdown({
    filter: "state",
    ariaLabel: t(lang, "list.statesLabel"),
    options,
    multipleLabel: t(lang, "list.statesChosen", {
      n: options.filter((o) => o.summary).length,
    }),
  });
  return searchForm(
    {
      action: "/",
      hidden: [["state", jobsStateValue(f.state)], ["kind", jobsKindValue(f.kind)], ...KEPT.filter((k) => f[k]).map((k): [string, string] => [k, f[k]!])],
      q: f.q ?? "",
      clearHref: esc(jobsViewPath(f, { q: "" })),
      after: state + askButton({ label: t(lang, "list.groupCreate"), dialogId: NEW_GROUP_DIALOG, variant: "primary" }),
    },
    lang,
  );
}

/** The table head: every heading sorts, Created is marked by default,
 *  and the second is headed Title. */
export function jobsHead(f: JobsFilter, lang: Language): string {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort : "created";
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
