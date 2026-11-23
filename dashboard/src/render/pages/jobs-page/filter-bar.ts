// The Jobs tab's search box, its state dropdown and its sortable head, drawn
// from the Specs list's own pieces. `view.ts` decides what each offers, counts
// and links to; this file draws it and decides nothing of its own. The bar
// ends in the New group button, which opens the dialog `execution-group-editor.ts` draws.

import { t, type Language } from "../../../i18n";
import { askButton } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { stateFilterLabel } from "../specs-list/data-model";
import { menuDropdown, resultCount, searchForm, sortHead } from "../specs-list/filter-bar.ts";
import { NEW_GROUP_DIALOG } from "./execution-group-editor.ts";
import {
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
  land: "jobs.filterKindLand",
  schedule: "jobs.filterKindSchedule",
  cleanup: "jobs.filterKindCleanup",
  group: "jobs.filterKindGroup",
} as const;

/** The search box with the type and state dropdowns after its help, and New
 *  group after them. New group is off while no project has two specs to
 *  group (`groupable`). */
export function jobsFilterBar(facts: RowFacts[], f: JobsFilter, lang: Language, shownCount = facts.length, groupable = true): string {
  const stateOptions = jobsStateOptions(facts, f);
  const kindOptions = jobsKindOptions(facts, f);
  const state = menuDropdown({
    filter: "state",
    icon: "state",
    none: { label: t(lang, "list.state.none"), href: esc(jobsViewPath(f, { state: "none" })) },
    ariaLabel: t(lang, "list.statesLabel"),
    triggerLabel: t(lang, "list.statesLabel"),
    options: stateOptions.map((o) => ({
      key: o.key,
      label: stateFilterLabel(o.key, lang),
      count: o.count,
      on: o.on,
      href: esc(jobsViewPath(f, { state: o.state })),
    })),
  });
  const kind = menuDropdown({
    filter: "kind",
    icon: "kind",
    none: { label: t(lang, "list.state.none"), href: esc(jobsViewPath(f, { kind: "none" })) },
    ariaLabel: t(lang, "jobs.typesLabel"),
    triggerLabel: t(lang, "jobs.typesLabel"),
    options: kindOptions.map((o) => ({
      key: o.key,
      label: o.key === "all" ? stateFilterLabel("all", lang) : t(lang, KIND_LABELS[o.key]),
      count: o.count,
      on: o.on,
      href: esc(jobsViewPath(f, { kind: o.kind })),
    })),
  });
  return searchForm(
    {
      action: "/",
      hidden: [["state", jobsStateValue(f.state)], ["kind", jobsKindValue(f.kind)], ...KEPT.filter((k) => f[k]).map((k): [string, string] => [k, f[k]!])],
      q: f.q ?? "",
      clearHref: esc(jobsViewPath(f, { q: "" })),
      after: kind + state + resultCount(shownCount) + askButton({ label: t(lang, "list.groupCreate"), shortLabel: t(lang, "list.newShort"), dialogId: NEW_GROUP_DIALOG, variant: "primary", disabled: !groupable, title: groupable ? undefined : t(lang, "list.groupNoneToGroup") }),
    },
    lang,
  );
}

/** The table head: plain headings, since the tab keeps its own order —
 *  running, the queue in its order, then the newest change — and the
 *  second is headed Title. */
export function jobsHead(_f: JobsFilter, lang: Language): string {
  return sortHead({ now: { dir: "desc" }, href: () => "", specLabel: "jobs.colTitle", plain: true }, lang);
}
