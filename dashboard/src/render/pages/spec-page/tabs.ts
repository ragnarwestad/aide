// The spec page's paths, its tabs, and which file/phase each one names.

import { pickTab } from "../job-page.ts";
import type { SpecPageView } from "./types.ts";

/** The path this page lives at. One function, because the server routes
 *  on it and the list links to it. */
export const specPagePath = (project: string, specFolder: string): string =>
  `/specs/${encodeURIComponent(project)}/${encodeURIComponent(specFolder)}`;

/** One TAB of that page. Beside `specPagePath` and for the same reason:
 *  the server sends a refused save back to the tab its form was on, and
 *  the query-string shape of a tab is this layer's to know. */
export const specTabPath = (project: string, specFolder: string, tab: string): string =>
  `${specPagePath(project, specFolder)}?tab=${encodeURIComponent(tab)}`;

/** The page's tabs: its four documents in the order they are written and
 *  read, then Checks (the spec's own remaining work) beside Status, then
 *  the lead job's own Logs.
 *
 *  A tuple of this page's own, fed to `job-page.ts`'s `pickTab` and
 *  `tabBar` — which take the list as an argument since spec 212 exactly
 *  so there is still ONE tab-bar renderer for a page with seven tabs
 *  and a page with three. */
export const SPEC_TABS = [
  "description",
  "analysis",
  "solution",
  "status",
  "checks",
  "steps",
] as const;
export type SpecTab = (typeof SPEC_TABS)[number];

/** The one place a raw `?tab=` value becomes a real tab (spec 303).
 *  `spec-page.ts`'s render side and `spec-edit.ts`'s script-loading
 *  decision used to each resolve their own default from the raw query
 *  string, and only one of them was updated when spec 294 changed it
 *  from "overview" to "description" — a bare URL rendered the
 *  Description panel while silently loading no editor script for it.
 *  `development.md` already names three other instances of this same
 *  hand-paired-default shape; this is the fix that stops teaching it a
 *  second time. */
export function resolveSpecTab(raw: string | undefined): SpecTab {
  return pickTab(SPEC_TABS, raw, "description");
}

/** Which tabs move on their own, and therefore reload. Steps is the one
 *  that changes while a step runs, and holds no form; every other tab
 *  carries one, and a page that reloads on a timer wipes what was
 *  half-typed or half-ticked. */
export const RELOADING_TABS: readonly SpecTab[] = ["steps"];

/** The one file of the four a person owns (spec 162). `2-analysis.md`
 *  and `3-solution.md` are the analyze step's output —
 *  a hand edit there is overwritten the next time it runs — and
 *  `4-status.md` has been the runner's since spec 154. Named here
 *  because the page decides which tab is a textarea and the server
 *  decides which file the route writes, and those two must be the same
 *  file. */
export const EDITABLE_SPEC_FILE = "1-description.md";

/** The file whose Status marks a person may now flip, one row at a
 *  time (spec 182). Named beside `EDITABLE_SPEC_FILE` and for the same
 *  reason: this page decides which rows carry a box and the server
 *  decides which file the tick route writes, and those two must be the
 *  same file. It is NOT editable in the `EDITABLE_SPEC_FILE` sense —
 *  there is no textarea and never will be, because a textarea cannot
 *  structurally stop a person rewriting a step's own prose. */
export const STATUS_SPEC_FILE = "4-status.md";

/** Which file each document tab shows. The Description tab renders its
 *  own form rather than a `<pre>`, and is here for the file it names. */
export const TAB_FILES: Partial<Record<SpecTab, string>> = {
  description: EDITABLE_SPEC_FILE,
  analysis: "2-analysis.md",
  solution: "3-solution.md",
  status: STATUS_SPEC_FILE,
};

/** The inverse of `TAB_FILES` (spec 310): which tab a POSTed `file` name
 *  belongs to. Built once here rather than at each call site — the save
 *  route's allowlist (REQ-2) and its redirect target are the same
 *  lookup, since a file outside this map is a file with no tab to send
 *  a refusal back to. */
export const FILE_TABS: Partial<Record<string, SpecTab>> = Object.fromEntries(
  Object.entries(TAB_FILES).map(([tab, file]) => [file, tab as SpecTab]),
);

/** A job for this spec is queued or running (moved from panels.ts,
 *  spec 315 — the route layer needs the same fact the render layer
 *  already computed). Note: `overview.ts`'s Checks-tab code has its own,
 *  independent copy of this same check (`view.lead?.state === "queued"
 *  || "running"`, spec-page/overview.ts:109) — untouched here, since
 *  nothing in this spec reads it and no REQ asks for that consolidation;
 *  named so it is not mistaken for a gap this move should have closed. */
export function activeJob(view: SpecPageView): boolean {
  return view.lead?.state === "queued" || view.lead?.state === "running";
}

/** REQ-4 (spec 315): does this tab's panel actually mount the editor?
 *  The one place both `panels.ts` (what to draw) and `spec-edit.ts`
 *  (whether to fetch the bundle at all) ask the same question —
 *  mirroring `documentPanel`'s own branching exactly, so the two can
 *  never again disagree the way spec 303 had to fix once for the
 *  default tab. */
export function documentTabNeedsEditor(view: SpecPageView, tab: SpecTab): boolean {
  const file = TAB_FILES[tab];
  if (!file || view.archived || activeJob(view)) return false;
  if (tab === "description") return true; // always has a form, even empty
  return (view.files.find((f) => f.label === file)?.text ?? null) !== null;
}

/** Which tab a phase's own link opens (spec 237): the tab that shows
 *  what that phase MADE, or — for archive, which writes no file of its
 *  own — Checks, the spec's own remaining-work tab.
 *
 *  ONE map, exported and imported rather than copied: `queue-list.ts`
 *  is the only caller, and `development.md` names two copies of one
 *  shape as this repo's own recurring mistake often enough that a
 *  fifth would be a choice.
 *
 *  A step outside these four — `explore`, `manifest`, `reset`, or
 *  anything not in the fixed workflow — has no tab that speaks for it,
 *  so it is absent here and the caller keeps the job page it has always
 *  linked to. */
export const PHASE_TAB: Partial<Record<string, SpecTab>> = {
  create: "description",
  analyze: "solution",
  implement: "status",
  archive: "checks",
};

/** What each tab's own "(?)" says (spec 311, REQ-3). One string per tab,
 *  prepended to its panel by `renderSpecPage()` — not a parameter on
 *  `documentPanel()`/`descriptionPanel()`/`checklist()`, which stay
 *  exactly as they are, and not touching `stepResults()` at all, since
 *  that function is shared with the job page and this help is the SPEC
 *  page's own. */
export const TAB_HELP: Record<SpecTab, string> = {
  description: "The problem as it was reported, kept in <code>1-description.md</code>. " +
    "While the spec is active and no job is running, Save here rewrites, commits and pushes it; an archived spec, or one with a job in flight, shows the same file read-only.",
  analysis: "What <code>/aide-analyze</code> found when it read the code for this problem, " +
    "kept in <code>2-analysis.md</code> and written by that step. " +
    "While the spec is active and no job is running, Save here rewrites, commits and pushes it; an archived spec, or one with a job in flight, shows the same file read-only.",
  solution: "The plan <code>/aide-analyze</code> wrote, kept in <code>3-solution.md</code>. " +
    "Where it lists more than one Approach, only the one marked recommended gets built — " +
    "the rest are the record of what was weighed, not options still open. The Acceptance " +
    "criteria, Risk analysis and Implementation plan below all describe that one approach. " +
    "While the spec is active and no job is running, Save here rewrites, commits and pushes it; an archived spec, or one with a job in flight, shows the same file read-only.",
  status: "Progress through the plan, kept in <code>4-status.md</code> and updated by " +
    "<code>/aide-implement</code> as it runs. While the spec is active and no job is " +
    "running, Save here rewrites, commits and pushes it; an archived spec, or one with a " +
    "job in flight, shows the same file read-only. The same file's Acceptance criteria " +
    "rows are what the Checks tab lets a person tick.",
  checks: "The spec's own remaining work, read from <code>4-status.md</code>. While the " +
    "spec is active, only the <code>## Acceptance criteria</code> rows below can be " +
    "ticked, and only they hold the next archive run back; the Phase tables shown on the " +
    "Status tab (RED/GREEN/REFACTOR, or a Checklist) are <code>/aide-implement</code>'s " +
    "own record of that run and are not part of this gate.",
  steps: "Every workflow step this spec's jobs have run — create, analyze, implement, " +
    "archive — each with its own cost and how it ended. Nothing here is editable; open a " +
    "row to see that step's own log.",
};
