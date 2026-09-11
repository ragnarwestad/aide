// The tab-bar machinery every tabbed page shares: reading which tab is
// open off the URL, the bar itself, and the frame it sits in. Split out
// of job-page.ts, which is where it used to live because the job page
// was the first to need it — `spec-page.ts`, `schedule-page.ts` and
// `site/project-page.ts` all call the same functions rather than
// carrying copies (spec 150). `development.md` names the
// two-copies-of-one-shape problem three times over as this repo's own
// recurring cost; a second tab bar would have been the fourth.

import { backLink } from "./components.ts";
import { esc } from "./html.ts";

/** A tab name off the query string, or the fallback. The list of tabs
 *  and the fallback are both arguments: a job has three tabs and the
 *  spec page has seven since spec 212, so the set is the caller's to
 *  know, and the spec page is about the SPEC, so it opens on the spec
 *  whatever job is running. */
export function pickTab<T extends string>(
  tabs: readonly T[],
  name: string | undefined,
  fallback: T,
): T {
  return (tabs as readonly string[]).includes(name ?? "") ? (name as T) : fallback;
}

/** A tab's key is its route (`?tab=steps`) and everywhere else it is
 *  read as data, so renaming it would ripple into the query string, the
 *  `JobTab`/`SpecTab` types and every test asserting on either. The
 *  VISIBLE word only needed to change once — "Steps" sat directly beside
 *  "Status" on the spec page, and a phase's own task table lives under
 *  Status, so two tabs both readable as "the steps" was the confusion
 *  (raised 2026-08-25). "steps" is still exactly the right word for what
 *  the tab CONTAINS — one row per workflow step — so only the label a
 *  reader sees changes, not the concept. */
const TAB_LABELS: Record<string, string> = { steps: "Logs" };

/** The tab bar, over a BASE PATH rather than a job (spec 150). It used
 *  to build its hrefs from `job.id`, which is the one assumption a
 *  spec-scoped page could not share — and copying the bar into the new
 *  page would have been two renderings of "Logs (12)" that nothing
 *  keeps in step. */
export function tabBar<T extends string>(
  tabs: readonly T[],
  basePath: string,
  current: T,
  /** How much is behind a tab, for the tabs that have a figure at all.
   *  Partial rather than one entry per tab: Description, Analysis,
   *  Solution and Status count nothing, and a tab with no entry renders
   *  its label with no `(N)` suffix — exactly as Activity already did
   *  for a job that had captured nothing, before spec 240 folded it into
   *  this same tab. */
  counts: Partial<Record<T, number>>,
  /** Extra markup at the row's right end — a spec's own Reopen/Reset/
   *  Update (spec 300), right-aligned by the shared ".row" class.
   *  Absent for every caller but the spec page. */
  trailing = "",
): string {
  // A real tab bar, the same one the site's own two tabs are: the row
  // sits ON a hairline and the open tab is marked by an underline in
  // the accent colour, PaceUp's tab bar being the reference. It was a
  // row of filter pills with a caption — "Spec" — beside it until
  // 2026-08-23: these are pages, not a filter over one page, and a
  // caption saying which kind of thing you are already looking at said
  // nothing. Chips are for choosing among values; tabs are for moving
  // between views, and the page has both.
  //
  // The count rides in the label — "Logs (12)" — rather than in a
  // badge sitting on it, because it is part of the sentence.
  return (
    `<nav class="tabbar subtabs">` +
    tabs
      .map((t) => {
        const label = TAB_LABELS[t] ?? t[0]!.toUpperCase() + t.slice(1);
        const n = counts[t] || undefined;
        return (
          // data-goto (spec 312): a real page load, same as the top
          // row's own tabs (shell.ts) — nav-busy.ts marks it waiting.
          `<a class="tab" data-nav data-goto href="${esc(basePath)}?tab=${t}"` +
          `${t === current ? ` aria-current="page"` : ""}>` +
          `${esc(label)}${n === undefined ? "" : ` (${n})`}</a>`
        );
      })
      .join("") +
    (trailing ? `<span class="row">${trailing}</span>` : "") +
    `</nav>`
  );
}

/** The frame a tabbed page sits in: the way back, then the banner, the
 *  tabs, and whatever the open tab holds. Shared with `spec-page.ts`
 *  (spec 150) so the last three literals the two pages had in common
 *  are written once — the panels themselves already are.
 *
 *  `backHref` is resolved by the server, from the request's own
 *  `Referer` (spec 252) — this layer only draws it. */
export function tabbedBody(
  banner: string, tabs: string, panel: string, backHref: string, title?: string,
  /** True for a page whose content is FIELDS: they cap themselves at a
   *  reading width narrower than `.doc`'s own, and the wrapper takes
   *  theirs so the page has one right edge. A page of tables — this
   *  one, Projects — keeps the wider default. */
  formFields = false,
  /** Drawn at the far end of the title's own line. */
  headTrailing = "",
): string {
  // One wrapper, one right edge: the head line's buttons used to sit at
  // the frame's width while the open tab's text stopped well short of
  // it (2026-08-23).
  return (
    // Both spellings written out rather than built by hand: the class
    // guard reads the literal the class attribute holds, and a ternary
    // in there is a class name it cannot check
    // (css-guard-class-vocabulary).
    (formFields ? `<div class="doc formdoc">` : `<div class="doc">`) +
    backLink(backHref, title, headTrailing) +
    banner +
    tabs +
    `<div class="tabpanel">${panel}</div>` +
    `</div>`
  );
}
