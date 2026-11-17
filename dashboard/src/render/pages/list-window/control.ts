import { btnLink } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { queuePath } from "../specs-list/filter-bar.ts";
import type { SpecsFilter } from "../specs-list/data-model";
import { type ListWindow } from "./index.ts";

export function windowAttributes(window: ListWindow<unknown>): string {
  if (window.query === undefined) return "";
  return ` data-window-query="${esc(window.query ?? "")}" data-window-limit="${window.requested}" data-window-loaded="${window.loaded}" data-window-total="${window.total}" data-window-more="${window.hasMore ? "1" : "0"}" data-window-boundary="${esc(window.boundary ?? "")}"`;
}

export function windowControl(window: ListWindow<unknown>, filter: SpecsFilter, path: string, lang: Language): string {
  if (!window.hasMore) return "";
  const href = queuePath(filter, {
    limit: String(window.requested + 100), boundary: window.boundary,
    windowQuery: window.query, grow: "1",
  }, path);
  return `<div class="row">${btnLink({ label: t(lang, "jobs.showMore"), href, data: { nav: "", "list-more": "" } })}</div>`;
}
