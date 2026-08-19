// `/`: the one list of every spec there IS — cut and ordered on
// demand, one line per spec with its workflow phases beneath it, and
// every spec run from its own row.
//
// A spec is a row from the moment its folder exists, not from the moment
// it first runs: the dropdown and the list held the same things, and a
// spec crossing from one to the other told the reader nothing. Archived
// specs leave the page — but only where their project's absence can be
// PROVEN, never because a specs root happened to be unreadable.
//
// There was a form above the table too, with a spec dropdown of its own:
// two ways in, of which the dropdown read as the one you were meant to
// use, and which the five-second refresh could not keep current because
// it deliberately replaces the rows alone. The row does everything it
// did, so it is gone.
//
// The page carries browser code (compiled from queue-client.ts) so the
// list can refresh without reloading a control someone is half-way
// through setting. Everything the code does also works without it: the
// filters and the sort are ordinary links, and every Run control is a
// plain form.

import { esc, relTime } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import {
  badge,
  btn,
  field,
  filterPills,
  messageSlot,
  phaseChip,
  phases,
  pips,
  rowMessage,
  stepLabel,
  tokenField,
} from "./components.ts";
import {
  IN_FLIGHT,
  branchActivity,
  currentStep,
  inFlight,
  nextActionHint,
  notStartedChip,
  stateChip,
  stateLabel,
  unmergedBadge,
  wordPhase,
  type BranchView,
  type PhaseWord,
  type QueueRowView,
} from "./job-state.ts";

export interface QueueTarget {
  project: string;
  specFolder: string;
  title?: string;
  /** What the spec is about, from `## Description` in 1-description.md.
   *  Shown on the job page, so a reader stops leaving the dashboard to
   *  find out what a job called `02-job-detail-view` actually is. */
  description?: string;
  phase?: string;
  percent?: number;
  /** What this spec builds on, from its own `Depends on:` line (spec
   *  92). Named by folder, the way `aide-run-spec`'s own dependency
   *  refusal names it. Empty or absent when it names none. */
  dependsOn?: string[];
  /** Steps this spec has already had. Marked, never forbidden. */
  done?: string[];
  /** Where the spec's folder is on this machine. Server-side only — it
   *  is what the freshness check runs git in, and an absolute path has
   *  no business on a page. */
  dir?: string;
  /** The description was committed after the last finished analyze, so
   *  the plan on disk describes an older problem than the description
   *  states. Derived live at render time, never stored, exactly like
   *  the merge check: a re-run clears it by being newer. */
  analyzeStale?: boolean;
  /** Why the last archive run did NOT move the folder, from the spec's
   *  own `## Archive held back` section. Archive is the one phase whose
   *  file-truth is always false for a row still on this page — a spec
   *  whose folder moved has left the list — so "held back, and why" is
   *  the only file-side answer archive has to give. */
  archiveHeldBack?: { reason: string };
}

export interface QueuePageOptions {
  /** 81a ships no runner: the page says so rather than leaving jobs in
   *  "queued" with no explanation. */
  runnerAvailable: boolean;
  targets: QueueTarget[];
  /** `project/folder` keys of ARCHIVED specs. A create job normally
   *  keeps its group visible even though its spec is not a target (the
   *  folder does not exist until it lands) — but once the spec has been
   *  archived, that exception would keep a ghost row forever. */
  archived?: string[];
  token?: string;
  /** Browser code for this page, compiled from `queue-client.ts` by the
   *  server. Nothing is hardcoded as a string here: page code is
   *  TypeScript like everything else, and the compiler checks it. */
  script?: string;
  /** The models a job may be asked to run on, from the config. Empty or
   *  absent means the per-step configuration is the only answer and the
   *  page offers no choice at all. */
  modelChoices?: { name: string; budgetUsd: number }[];
  /** What a step gets when no model is picked. Shown on the default
   *  option: every other option carries a figure, so a default without
   *  one reads as "unknown, probably less" when it is usually more. */
  defaultBudgetUsd?: number;
  /** Every allowlisted project. A job may name others it expects to
   *  touch, so the run watches and commits them instead of leaving half
   *  the work uncommitted on the machine. */
  projects?: string[];
  /** Every project a spec may be CREATED in — the raw allowlist, not
   *  the discovered set. A project whose first spec this form exists to
   *  make has nothing on disk yet, so it appears in no other list on
   *  this page. Empty or absent means the form is not offered at all. */
  createProjects?: string[];
  /** Why the last attempt was refused. Shown on the form, because the
   *  person who pressed the button is the one who needs to read it. */
  error?: string;
  /** Which spec that refusal belongs to, as `<project>/<specFolder>` —
   *  the same key the fold state already uses. The page lists up to 25
   *  rows, so a reason with no row attached says nothing about which
   *  button was pressed. Derived server-side from the job, never taken
   *  from the browser. */
  errorSpec?: string;
  /** WHY that refusal happened, when the reason is one the row can
   *  offer a way out of — today only `"conflict"` (spec 106). Derived
   *  server-side from the merge result's own field, never from the
   *  refusal sentence: that text is joined across repos before the page
   *  sees it, and a rewording would silently take the offer away.
   *  Absent for every other refusal, which is what keeps the offer
   *  narrow. */
  errorReason?: string;
  /** How the list is cut and ordered, straight from the query string.
   *  Anything unrecognised falls back to the default rather than
   *  emptying the page. */
  filter?: QueueFilter;
}

export interface QueueFilter {
  state?: string;
  project?: string;
  sort?: string;
  dir?: string;
  /** Which specs are expanded: `<project>/<folder>`, comma-separated.
   *  A row is COLLAPSED unless it is named here — the list is a wall of
   *  controls otherwise, and the reader came to read states. It rides in
   *  the query string with the rest of the filter, which is the whole
   *  reason it survives the five-second swap of the table — `swapRows`
   *  sends `location.search` back on every tick. Never rendered as text:
   *  only compared for membership, and re-encoded through `queueHref`. */
  open?: string;
}

// --- what every form on this page needs ------------------------------------

// One chevron for the fold control; the shut state rotates it in CSS.
// Stroke-based so it takes the text colour and scales with the flat.
const CHEVRON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 6l4 4 4-4"></path></svg>';

const QUEUE_STEPS = ["analyze", "review-plan", "implement", "archive"];

// The phase LINES a spec's expanded row shows, in order. `create` is
// history, not a control (spec 116): a spec that exists cannot be
// created again, so it is never a checkbox (`stepBoxes`), never a
// progress pip (`specHeadRow`), and never "the next phase"
// (`nextStep`/`readyPhase`/`allDone`) — all four of those keep reading
// `QUEUE_STEPS` directly. Only the phase-line list reads this one.
const PHASE_LINES = ["create", ...QUEUE_STEPS];

// Every form on this page posts to the guarded surface, so every one of
// them carries the token when the page has one. Written once: a form
// that forgot it would be refused with a 401 the reader cannot act on.
/** How the list is cut and ordered. One list, exported so `serve.ts`
 *  builds the redirect after a POST from the same five keys the forms
 *  send — two copies would eventually disagree about what "the view" is. */
export const FILTER_KEYS = ["state", "project", "sort", "dir", "open"] as const;

/** The prefix a filter key rides under as a form field. Prefixed
 *  because one of the five is `project`, which is ALSO what the Run
 *  form posts to say which spec to run: two fields of that name arrive
 *  as a list, and the enqueue refuses the whole request as "invalid
 *  project". */
export const FILTER_FIELD_PREFIX = "view.";

/** The current view, sent along with the press. The redirect the server
 *  answers with can only carry forward what the POST itself received,
 *  so the fields have to leave the browser on the same request. */
const filterFields = (f?: QueueFilter): string =>
  FILTER_KEYS.map((k) => {
    const v = f?.[k];
    return v ? `<input type="hidden" name="${FILTER_FIELD_PREFIX}${k}" value="${esc(v)}">` : "";
  }).join("");

// --- the list ---------------------------------------------------------------

const SHOWN = 25;

// The four questions actually asked of this list. "Problems" holds
// everything that did not simply finish — a cap-stop and a crash are
// different, but both are things you go looking for on purpose.
// "Not started" comes AFTER "All", which must stay first: `stateFilter`
// falls back to `STATE_FILTERS[0]`, so moving it changes the default
// filter for every reader.
const STATE_FILTERS: { key: string; label: string; states?: string[] }[] = [
  { key: "all", label: "All" },
  { key: "not-started", label: "Not started", states: ["not-started"] },
  // Read off `IN_FLIGHT` rather than written out a second time: a state
  // added to one and forgotten in the other is exactly the drift this
  // page cannot afford, and the single-job page needs the same set.
  { key: "active", label: "Active", states: [...IN_FLIGHT] },
  { key: "done", label: "Done", states: ["done"] },
  { key: "problem", label: "Problems", states: ["failed", "stopped", "interrupted", "cancelled"] },
];

const SORTS = ["started", "spec", "state", "cost"];
// The default view: newest spec at the top. Chosen 2026-08-19 over
// "last activity", which put a spec that had just been created at the
// bottom of the list — under everything that had ever run.
const DEFAULT_SORT = "spec";
// Each column has the direction you almost always want first: newest
// run, dearest job, but names from A.
const SORT_DEFAULT_DIR: Record<string, "asc" | "desc"> = {
  started: "desc", cost: "desc", spec: "desc", state: "asc",
};

function stateFilter(key: string | undefined): { key: string; states?: string[] } {
  return STATE_FILTERS.find((f) => f.key === key) ?? STATE_FILTERS[0]!;
}

// --- one spec, however many jobs it took -------------------------------------

// The list is about SPECS. A spec taken through analyze, review-plan,
// implement and archive as four separate jobs is still one spec, and
// how far it has got should read without counting rows.

/** Every step this job has anything to say about: the ones it finished,
 *  plus the one it is on. */
function stepsTouched(r: QueueRowView): string[] {
  const finished = (r.results ?? []).map((x) => x.step).filter((s): s is string => !!s);
  return [...new Set([...finished, currentStep(r)])];
}

/** The job as ONE of its steps saw it. Same shape as the job, so every
 *  cell that renders a job renders a step without knowing the
 *  difference — but with that step's own outcome and its own cost, not
 *  the job's running total. A step the job finished is done (or failed,
 *  and then it keeps the error); a step it has not reached yet is not an
 *  attempt at all. */
function attemptFor(r: QueueRowView, step: string): QueueRowView | null {
  const res = (r.results ?? []).find((x) => x.step === step);
  if (res) {
    return {
      ...r,
      state: res.ok ? "done" : r.state === "done" ? "failed" : r.state,
      spentUsd: res.costUsd,
      error: res.ok ? undefined : r.error,
    };
  }
  if (currentStep(r) !== step) return null;
  // What the finished steps did not account for. A job's `spentUsd` is
  // the sum over its steps, so the step in flight owns the remainder.
  const counted = (r.results ?? []).reduce((sum, x) => sum + x.costUsd, 0);
  return { ...r, spentUsd: Math.max(0, r.spentUsd - counted) };
}

function activityMs(r: QueueRowView): number {
  return Date.parse(r.startedAt ?? r.createdAt) || 0;
}

interface Phase {
  step: string;
  /** Every job whose current/last step is this phase, newest first. A
   *  phase can be re-run — `85-dashboard-into-aide` archived three
   *  times — so this is a list, not a job. */
  attempts: QueueRowView[];
  /** Archive only: the spec's own reason for not having been archived.
   *  Every other phase answers "has this happened" out of `done`. */
  heldBack?: { reason: string };
}

interface SpecGroup {
  project: string;
  specFolder: string;
  /** The job the header speaks for: whatever is in flight, or failing
   *  that the most recently active one. Absent for a spec nothing has
   *  ever run — there is no job page to link to, and no honest answer
   *  to "is it in flight?". */
  lead?: QueueRowView;
  /** The most recently active job, in flight or not. The "Started"
   *  column shows ITS time, so the column and the sort answer the same
   *  question: when did anything last happen to this spec? */
  latest?: QueueRowView;
  /** `not-started` is this page's own pseudo-state, not a job's: a spec
   *  that exists and has never been run. It is the filter key and the
   *  CSS suffix; the words the reader sees are "not started". */
  state: QueueRowView["state"] | "not-started";
  spentUsd: number;
  activityAt: number;
  /** Every repo this SPEC has a branch in, however many jobs made them.
   *  Folded by label from rows already on the page — the server folds
   *  the same thing by root when the Merge button posts back, and that
   *  one is the authority. Nothing here decides where git runs. */
  branches: BranchView[];
  phases: Phase[];
  /** Steps this spec has already had, from its matching target: what its
   *  own files show, and what the queue actually ran. Marked on the
   *  row's checkboxes, never forbidden — re-analyzing after the code
   *  moved on is a legitimate thing to want. */
  done: string[];
  /** What the spec is and how far it has got, from its own 4-status.md.
   *  It used to be one summary line for whichever spec the top form's
   *  dropdown had selected; every row now answers for itself. */
  title?: string;
  phase?: string;
  percent?: number;
  /** The specs this one builds on, by folder — from its own
   *  1-description.md, not from anything the queue ran. */
  dependsOn: string[];
  /** This spec's description has moved on since its last analysis. The
   *  analyze line says so; nothing is blocked by it. */
  analyzeStale: boolean;
}

/** Fold branch entries by label, most-recently-active row winning a
 *  given label. The rows arrive newest-first, so the first sighting of
 *  a label is the one to keep. */
function branchesOf(recent: QueueRowView[]): BranchView[] {
  const byLabel = new Map<string, BranchView>();
  for (const row of recent) {
    for (const b of row.branchUrls ?? []) {
      if (!byLabel.has(b.label)) byLabel.set(b.label, b);
    }
  }
  return [...byLabel.values()];
}

const groupKey = (project: string, specFolder: string): string => `${project}/${specFolder}`;

// A spec with no job is still a spec. It is the ONLY row on this page
// where the whole workflow is still ahead of you, which is exactly the
// row the analyze button belongs on.
function emptyGroup(t: QueueTarget): SpecGroup {
  return {
    project: t.project,
    specFolder: t.specFolder,
    state: "not-started",
    spentUsd: 0,
    activityAt: 0,
    branches: [],
    phases: PHASE_LINES.map((step) => ({ step, attempts: [], ...heldBackFor(step, t) })),
    ...fromTarget(t),
  };
}

/** What a row reads off its own spec rather than off its jobs. Written
 *  once because both constructors need it, and a row showing another
 *  spec's done-set or progress is the one way this join can go wrong. */
function fromTarget(
  t: QueueTarget | undefined,
): Pick<SpecGroup, "done" | "title" | "phase" | "percent" | "dependsOn" | "analyzeStale"> {
  return {
    done: t?.done ?? [],
    title: t?.title,
    phase: t?.phase,
    percent: t?.percent,
    dependsOn: t?.dependsOn ?? [],
    analyzeStale: t?.analyzeStale ?? false,
  };
}

/** Archive's own file-side answer, on archive's line and nowhere else.
 *  Written once because both constructors build their phases. */
const heldBackFor = (step: string, t: QueueTarget | undefined): { heldBack?: { reason: string } } =>
  step === "archive" && t?.archiveHeldBack ? { heldBack: t.archiveHeldBack } : {};

const isCreate = (r: QueueRowView): boolean => r.steps.includes("create");

function groupBySpec(rows: QueueRowView[], targets: QueueTarget[], archived?: string[]): SpecGroup[] {
  const byKey = new Map<string, QueueRowView[]>();
  for (const r of rows) {
    const key = groupKey(r.project, r.specFolder);
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }
  const byKeyTarget = new Map(targets.map((t) => [groupKey(t.project, t.specFolder), t]));
  const known = new Set(byKeyTarget.keys());
  // Which projects we are entitled to judge. An empty target list is
  // "we do not know", never "everything is archived": a specs root that
  // is not checked out on this host looks exactly the same from here,
  // and a project losing its whole history to a momentarily unreadable
  // disk is not recoverable by a filter.
  const judgeable = new Set(targets.map((t) => t.project));
  const archivedSet = new Set(archived ?? []);
  const fromJobs = [...byKey.entries()]
    // A create job's spec is not a known target BY CONSTRUCTION: the
    // folder is what the job is making, and until it lands there is
    // nothing on disk to match. Without this it would be filtered out
    // in exactly the projects that already have specs — so the job the
    // reader just started would render nothing at all.
    .filter(
      ([key, all]) =>
        known.has(key) ||
        !judgeable.has(all[0]!.project) ||
        // The create exception ends where the archive begins: a spec
        // that has been archived is no longer "not landed yet".
        (all.some(isCreate) && !archivedSet.has(key)),
    )
    .map(([key, all]) => jobGroup(all, byKeyTarget.get(key)));
  return [
    ...fromJobs,
    ...targets.filter((t) => !byKey.has(groupKey(t.project, t.specFolder))).map(emptyGroup),
  ];
}

function jobGroup(all: QueueRowView[], target: QueueTarget | undefined): SpecGroup {
  const recent = [...all].sort((a, b) => activityMs(b) - activityMs(a));
  const spec = fromTarget(target);
  const lead = recent.find(inFlight) ?? recent[0]!;
  // The five, always, in order — a phase nobody has run yet still holds
  // its place, which is what makes progress readable at a glance. A
  // step outside them (explore, manifest, resolve) is appended rather
  // than dropped: a job that ran is never invisible. `create` is one of
  // the five since spec 116, so a create job lands on its own line at
  // the front rather than being appended after archive.
  const extra = [...new Set(all.flatMap(stepsTouched))].filter((s) => !PHASE_LINES.includes(s));
  return {
    project: lead.project,
    specFolder: lead.specFolder,
    lead,
    latest: recent[0]!,
    state: lead.state,
    spentUsd: all.reduce((sum, r) => sum + r.spentUsd, 0),
    activityAt: activityMs(recent[0]!),
    branches: branchesOf(recent),
    phases: [...PHASE_LINES, ...extra].map((step) => ({
      step,
      attempts: recent
        .map((r) => attemptFor(r, step))
        .filter((a): a is QueueRowView => a !== null),
      ...heldBackFor(step, target),
    })),
    ...spec,
    // A create job has no target to read a title off — the spec it is
    // making is not on disk yet — so the job's own title is the row's.
    // Only as a fallback: once the spec has landed, the folder's own
    // 1-description.md is the better answer, and the one every other
    // row already uses.
    title: spec.title ?? all.find((r) => r.createTitle)?.createTitle,
  };
}

function applyFilter(groups: SpecGroup[], f: QueueFilter): SpecGroup[] {
  const states = stateFilter(f.state).states;
  return groups.filter(
    (g) => (!states || states.includes(g.state)) && (!f.project || g.project === f.project),
  );
}

// A spec folder leads with its number, and that number is what a person
// reads the column by — so `81-…` sorts before `103-…`, which plain text
// order gets wrong the moment there are three digits. Same number (or
// no number: a state, a create job's provisional key) falls back to text.
function compareFolders(a: string, b: string): number {
  const na = Number.parseInt(a, 10), nb = Number.parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

function sortGroups(groups: SpecGroup[], f: QueueFilter): SpecGroup[] {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : DEFAULT_SORT;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  const sign = dir === "asc" ? 1 : -1;
  const key = (g: SpecGroup): number | string =>
    sort === "cost" ? g.spentUsd
    : sort === "spec" ? g.specFolder
    : sort === "state" ? g.state
    : g.activityAt;
  return [...groups].sort((a, b) => {
    const x = key(a), y = key(b);
    const cmp =
      (typeof x === "string" ? compareFolders(String(x), String(y)) : (x as number) - (y as number)) * sign;
    if (cmp !== 0) return cmp;
    // Only between two specs that have BOTH never run. A general folder
    // tie-break is not free: 29 job fixtures sharing one `createdAt` all
    // tie on `activityAt` today and keep their insertion order, and
    // reversing them moves the 25-row cap onto the wrong end of the
    // list. Never-run specs have no insertion order worth keeping —
    // theirs is whatever the disk scan happened to produce.
    if (a.activityAt === 0 && b.activityAt === 0) return b.specFolder.localeCompare(a.specFolder);
    return 0;
  });
}

// Links, not script: the filter lives in the URL, so it survives a
// reload, can be shared, and works with JavaScript switched off. The
// page's own code intercepts the click to avoid reloading a form
// someone is half-way through.
function queueHref(f: QueueFilter, patch: QueueFilter): string {
  const merged = { ...f, ...patch };
  const q = Object.entries(merged)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return esc(q ? `/?${q}` : "/");
}

// Which rows the reader has opened — the exceptions, not the rule. The
// default is collapsed: a row says what the spec IS and how it is
// doing, and the controls that act on it come with expanding it.
const openedSet = (f: QueueFilter): Set<string> =>
  new Set((f.open ?? "").split(",").filter(Boolean));

// The fold is a LINK, not a button, and the state is in the URL. That
// buys three things at once for no browser code at all: it works with
// script off, `queue-client.ts` already intercepts `a[data-nav]` inside
// `#jobrows` so a click neither reloads the page nor wipes a half-filled
// form, and the choice survives the table swapping itself every five
// seconds — the same mechanism the filter and the sort ride on.
function foldControl(g: SpecGroup, f: QueueFilter, opened: Set<string>): string {
  const key = groupKey(g.project, g.specFolder);
  const shut = !opened.has(key);
  const next = shut ? [...opened, key] : [...opened].filter((k) => k !== key);
  return (
    `<a class="fold${shut ? " shut" : ""}" data-nav href="${queueHref(f, { open: next.join(",") })}" ` +
    // The key is never the visible content — anything in `?open=` is
    // attacker-chosen text, and an icon cannot be mistaken for markup.
    `aria-expanded="${shut ? "false" : "true"}" ` +
    `title="${shut ? "show" : "hide"} the phases and controls of ${esc(g.specFolder)}">${CHEVRON}</a>`
  );
}

// What the page used to say in a paragraph above the list: how runs
// work here. A front page does not open with four sentences a returning
// reader has read, so the same facts sit behind a "?" beside the filter
// chips instead. It is inside `#jobrows`, so it shuts again on the
// five-second refresh — the same as `moreRow`'s own disclosure, and
// fine for the same reason: nothing here is being typed into.
function runsHelp(): string {
  return (
    `<details class="intro"><summary title="How runs work here" ` +
    `aria-label="How runs work here">?</summary>` +
    `<p>A few jobs run side by side here, each in a checkout of its own, ` +
    `and never two on the same spec. Every step is bounded by its own ` +
    `budget and a wall clock — a job that hits either cap is ` +
    `<em>stopped</em>, not failed.</p></details>`
  );
}

function filterBar(groups: SpecGroup[], f: QueueFilter): string {
  const chips = (
    name: string,
    label: string,
    entries: { key: string; label: string; count: number; on: boolean; patch: QueueFilter }[],
  ) =>
    filterPills(
      name,
      label,
      entries.map((e) => ({
        label: e.label,
        count: e.count,
        on: e.on,
        href: queueHref(f, e.patch),
      })),
    );

  const current = stateFilter(f.state).key;
  // Counts are of what the OTHER filter already allows, so the numbers
  // add up to the table you are looking at rather than to some list
  // nobody asked for. They count SPECS, because that is what the table
  // holds one line per.
  const byProject = groups.filter((g) => !f.project || g.project === f.project);
  const states = chips(
    "state",
    "Show",
    STATE_FILTERS.map((s) => ({
      key: s.key,
      label: s.label,
      count: byProject.filter((g) => !s.states || s.states.includes(g.state)).length,
      on: s.key === current,
      patch: { state: s.key === "all" ? "" : s.key },
    })),
  );

  const names = [...new Set(groups.map((g) => g.project))].sort();
  if (names.length < 2) return `<div class="row">${states}${runsHelp()}</div>`;
  const byState = applyFilter(groups, { state: f.state });
  const projects = chips("project", "Project", [
    { key: "", label: "All", count: byState.length, on: !f.project, patch: { project: "" } },
    ...names.map((p) => ({
      key: p,
      label: p,
      count: byState.filter((g) => g.project === p).length,
      on: f.project === p,
      patch: { project: p },
    })),
  ]);
  return `<div class="row">${states}${projects}${runsHelp()}</div>`;
}

function sortableHead(f: QueueFilter): string {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : DEFAULT_SORT;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  const th = (key: string, label: string, cls = "") => {
    const on = key === sort;
    // Clicking the column you are already sorted by turns it round.
    const next = on ? (dir === "asc" ? "desc" : "asc") : SORT_DEFAULT_DIR[key]!;
    // Every sortable column carries the chevron — faint until hovered,
    // so the reader can see the column CAN be sorted; full on the sorted
    // one, and ascending turns it by a class rather than swapping a
    // glyph, same as the fold control. Which way an unsorted column
    // will go on the first click is what its chevron points.
    const mark = CHEVRON;
    const linkCls = on
      ? (dir === "asc" ? "sortlink on asc" : "sortlink on")
      : (SORT_DEFAULT_DIR[key] === "asc" ? "sortlink asc" : "sortlink");
    const aria = on ? ` aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : "";
    return (
      `<th class="${cls}"${aria}>` +
      `<a class="${linkCls}" data-nav href="${queueHref(f, { sort: key, dir: next === SORT_DEFAULT_DIR[key] ? "" : next })}">` +
      `${esc(label)}${mark}</a></th>`
    );
  };
  return (
    // "Progress", not "Step": the column stopped holding a step name the
    // moment the list became one line per spec. It holds the whole
    // workflow as pips on a header line, and how many attempts a phase
    // took on the lines beneath.
    `<thead><tr>${th("spec", "Spec")}<th>Progress</th>${th("state", "State")}` +
    `${th("started", "Started")}${th("cost", "Cost", "num")}<th></th></tr></thead>`
  );
}

// A gated job is waiting on a person, and the two things that person
// can do are approve it or stop it. Cancel used to be offered only
// while a job was queued or running — the route has never had a state
// guard on it (`serve.ts`), so a gated job could be cancelled by
// anything except the page it was gated on. The design sheet puts both
// buttons on that row; this is where they come from.
function actionForm(
  r: QueueRowView,
  token: string | undefined,
  filter: QueueFilter | undefined,
  o: { approveOnly?: boolean; cancelOnly?: boolean } = {},
): string {
  const gated = r.state === "awaiting-approval";
  const canCancel = gated || r.state === "queued" || r.state === "running";
  if (!(o.approveOnly ? gated : canCancel)) return "";
  const hidden = tokenField(token) + filterFields(filter);
  // `actionform` is what the page's own code selects on, and
  // `data-pending` is what the button says while the request is out —
  // written here, beside the label it replaces, rather than as a verb
  // table in the script.
  const one = (verb: "approve" | "cancel", label: string, pending: string, variant: "ok" | "danger") =>
    `<form method="post" action="/api/queue/${esc(r.id)}/${verb}" class="actionform">${hidden}` +
    btn({ label, pending, variant }) +
    `</form>`;
  // A collapsed row offers the one thing it needs RIGHT NOW and nothing
  // else — approving is that thing; stopping the job is a decision the
  // reader takes with the row open in front of them.
  if (o.approveOnly) return one("approve", "Approve", "approving…", "ok");
  // The mirror of `approveOnly`, and it exists for the same reason the
  // two buttons ended up on different lines (spec 109): Approve is what
  // a gate needs RIGHT NOW, so it stays on the header the reader is
  // already looking at, and drawing it a second time on the controls
  // line below would be one decision offered twice.
  return (
    (o.cancelOnly ? "" : gated ? one("approve", "Approve", "approving…", "ok") : "") +
    one("cancel", "Cancel", "cancelling…", "danger")
  );
}

// The merging still belongs to the user — the button is pressed, never
// scheduled. What moves onto the page is the EXECUTION, which is the
// part that got forgotten: a spec's work merged in one repo and left in
// the other, three times on 2026-08-17.
//
// One button for the whole spec, not one per repo. The report that
// comes back is per repo, because several repos cannot be merged
// atomically — but a spec with three repos growing three near-identical
// buttons to find and press in turn is not what "sørger for å gjøre det
// rett" asked for.
//
// The names are on the button BEFORE it is pressed, so merging an
// unfinished spec is a choice rather than a surprise.
//
// The COUNT is not, any more. `Merge (1)` said how many repos and
// nothing about which kind, so a reader had to know that one meant the
// specs repo, that the specs repo is the plan, and that the step still
// running was about to rewrite it. Two of those three facts are the
// page's to state.

/** A branch's label is a directory basename (`serve.ts`, `repoLabel`)
 *  and a project's checkout is named after the project by construction
 *  (`branch-status.ts`, `projectCheckout`) — so a label that is a known
 *  project name is that project's CODE, and a label that is not is the
 *  specs repo. Not a heuristic: `.claude/rules/development.md` closes
 *  the set ("the run only watches ... the roots it knows about"), so
 *  there is no third kind of repo for a label to belong to. */
function isCodeRepo(label: string, g: SpecGroup, opts: QueuePageOptions): boolean {
  return label === g.project || (opts.projects ?? []).includes(label);
}

/** What pressing the button will actually land. `paceup` and
 *  `atlasaurus` keep their specs inside the project repo, so their one
 *  branch is code — the common shape, and the one calling it "the plan"
 *  would get backwards. */
function mergeLabel(open: BranchView[], g: SpecGroup, opts: QueuePageOptions): string {
  const code = open.some((b) => isCodeRepo(b.label, g, opts));
  const plan = open.some((b) => !isCodeRepo(b.label, g, opts));
  return code && plan ? "Merge the plan and the code" : code ? "Merge the code" : "Merge the plan";
}

function mergeForm(g: SpecGroup, opts: QueuePageOptions, refused: boolean): string {
  const open = g.branches.filter((b) => !b.merged);
  // No lead means no job, which means no branch — the guard is for the
  // type checker, and it holds for the same reason the `if` above does.
  if (open.length === 0 || !g.lead) return "";
  const names = open.map((b) => b.label).join(", ");
  // A merge that was just refused is not a new decision to make — it is
  // the same one, again. The button says so, and stops being the
  // primary action on a row that has just told the reader why it could
  // not be done.
  const label = refused ? "Merge again" : mergeLabel(open, g, opts);
  const hidden = tokenField(opts.token) + filterFields(opts.filter);
  const action = `/api/queue/${esc(g.lead.id)}/merge`;
  // Only ever the ordinary button: both callers below refuse to invoke
  // this while the spec is busy. It used to draw a disabled stand-in of
  // its own instead — a second way of saying "not now", beside the one
  // every other control on the row uses, on a row that has one thing to
  // offer. Merging mid-job means cancelling the job first.
  return (
    `<form method="post" action="${action}" class="mergeform">${hidden}` +
    btn({ label, pending: "merging…", title: names, variant: refused ? "" : "primary" }) +
    `</form>`
  );
}

// The way out of the one refusal that HAS one (spec 106). Merging by
// hand is still there beside it, unchanged — this is an alternative
// offered, never a replacement, and it appears only after a merge was
// refused for a real conflict.
//
// It queues a job, so it is `specRunForm`'s shape and not `mergeForm`'s:
// a POST to /api/queue with the steps fixed, since this control never
// lets a person pick them. Everything that follows — the cost, the
// cancel, the caps, the model — is what any other step gets, because it
// IS any other step.
function resolveForm(g: SpecGroup, opts: QueuePageOptions): string {
  const hidden =
    tokenField(opts.token) +
    filterFields(opts.filter) +
    `<input type="hidden" name="project" value="${esc(g.project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
    `<input type="hidden" name="steps" value="resolve">`;
  return (
    `<form method="post" action="/api/queue" class="resolveform">${hidden}` +
    btn({
      label: "let aide resolve it",
      pending: "queueing…",
      title: "merge the default branch into the spec's branch, resolve, and run the tests",
    }) +
    `</form>`
  );
}

// What a COLLAPSED row may ask of the reader: the one thing the spec
// needs right now, or nothing at all. Approve while a gate waits, Merge
// while a branch waits — the two the description names as reachable
// without expanding. Everything else (Run, Cancel, the model, the gate,
// the other repos) belongs to the row you have opened.
//
// Since spec 109 it is what the header cell draws whether the row is
// open or shut, which is why the header line holds still when a row is
// expanded: an OPEN row's extra controls go on their own line under it
// (`controlsRow`), never into this cell.
//
// A selector, never a second copy of the markup: both branches call the
// same component the expanded row calls, so a change to either form
// reaches both places at once.
function collapsedAction(
  g: SpecGroup,
  opts: QueuePageOptions,
  refused: boolean,
  conflict: boolean,
): string {
  if (g.lead && g.lead.state === "awaiting-approval") {
    return actionForm(g.lead, opts.token, opts.filter, { approveOnly: true });
  }
  // A branch an earlier job left behind does not make a busy row
  // actionable: the step still running is writing to that very branch,
  // and the merge would be refused. Nothing at all, then — Cancel stays
  // one click away, by opening the row.
  if (specBusy(g)) return "";
  // Both, in the order the reader decides between them: the merge they
  // just tried, and the other way to get it.
  return mergeForm(g, opts, refused) + (conflict ? resolveForm(g, opts) : "");
}

// Every repo the spec pushed to, each with its own compare link and its
// own merge state. Never one link standing in for two: the two branches
// share a NAME and nothing else.
function branchList(branches: BranchView[], activity?: string): string {
  if (branches.length === 0) return "";
  return (
    `<span class="branchlist">` +
    branches
      .map(
        (b) =>
          `<span class="branch"><a class="small" href="${esc(b.url)}" ` +
          `title="compare the branch in ${esc(b.label)}">${esc(b.label)}</a>` +
          // Beside the compare link, never instead of it: one says where
          // the work is, the other where it can be tried.
          (b.previewUrl
            ? ` <a class="small" href="${esc(b.previewUrl)}" ` +
              `title="open this branch's own build">preview</a>`
            : "") +
          `${unmergedBadge(b, activity)}</span>`,
      )
      .join("") +
    `</span>`
  );
}

// The two cells the header line and the phase lines fill the same way.
// A spec's state and a phase's state are the same question asked at two
// altitudes, and they must never be worded differently.
const stateCell = (r: QueueRowView): string =>
  stateChip(r) + (r.error ? `<div class="muted small">${esc(r.error)}</div>` : "");
// The same two-part shape, for a PHASE — whose state is the file's
// answer (`wordPhase`), not the last job's. No badge at all means the
// phase has neither happened nor been attempted. The attempt's own
// error text still rides along beneath it: a reader is told no less
// than before, only in the file's order.
const phaseWordCell = (w: PhaseWord, r: QueueRowView | undefined): string =>
  (w.badge ? badge(w.badge.variant, w.badge.label) : `<span class="muted small">not run yet</span>`) +
  (w.qualifier ? `<div class="muted small">${esc(w.qualifier)}</div>` : "") +
  (r?.error ? `<div class="muted small">${esc(r.error)}</div>` : "");
// `blank` because a header with nothing spent still owes the reader a
// dash, while an empty phase line should simply be empty.
const costCell = (spentUsd: number, blank: string): string =>
  spentUsd > 0 ? `$${spentUsd.toFixed(2)}` : blank;

/** Whether a job is in flight on this spec — queued, running, or parked
 *  at a gate. ONE rule for the whole row, read off the SPEC and not off
 *  the steps some job happens to name: the queue refuses a second job
 *  on a spec that already has one (`clashing()`, queue.ts), so every
 *  control the row draws beside Cancel would be promising a press the
 *  server was going to turn down. `actionForm` already narrows itself
 *  to Cancel (or Approve + Cancel); everything else on the row reads
 *  THIS, so a control added later has one question to ask rather than a
 *  rule to remember. */
const specBusy = (g: SpecGroup): boolean => !!g.lead && inFlight(g.lead);

/** Why the row will not take a click, in the words the badge uses. One
 *  sentence for the whole row: about the JOB, so every locked control
 *  says the same thing rather than each wording it freshly. */
const busyReason = (g: SpecGroup): string =>
  g.lead ? `${stepLabel(currentStep(g.lead))} is ${stateLabel(g.lead)}` : "";

// A step the spec has already had is marked done and left unticked;
// EVERY step is disabled while a job is in flight on the spec, because
// the queue would refuse a second one anyway and a box that says so
// before the press is kinder than a refusal after it.
//
// What is TICKED depends on how far the spec has got. A spec nothing has
// ever run pre-ticks `analyze` AND `review-plan` together — that pair as
// one gated job is what every spec here has actually been started as,
// and the two belong together. Any other spec pre-ticks the first phase
// it has not had, which is what you almost always came to run.
//
// `g.lead` is the test for "nothing has ever run": it is absent only for
// a spec `emptyGroup` built, which is a spec with no job row at all. A
// spec whose only job ran `explore` has a lead, and keeps the ordinary
// single pre-tick even though its done-set is still empty.
//
// The pair is filtered against the done-set, because the two answer
// different questions: `done` is read off the spec's own FILES, so a
// spec analysed by hand and never queued has `analyze` done while
// nothing has ever run for it. Ticking a box that also carries the done
// mark would say two things at once. And a spec that has both of them
// done already falls back to the ordinary rule rather than to nothing:
// the pair exists to tick a spec's two STARTING phases, not to leave a
// spec that is past them with no box ticked at all.
function stepBoxes(g: SpecGroup, busy: boolean): string {
  const done = new Set(g.done);
  const next = QUEUE_STEPS.find((s) => !done.has(s));
  const pair = ["analyze", "review-plan"].filter((s) => !done.has(s));
  const single = next ? [next] : [];
  const checked = new Set(g.lead || pair.length === 0 ? single : pair);
  // Every box, not merely the ones the in-flight job was queued with.
  // The server refuses a second job on a spec that already has one,
  // whatever steps the two name (`clashing()`, queue.ts, tests the
  // whole job against UNFINISHED) — so a job queued as `implement` left
  // `analyze` tickable and a press away from a refusal. The question is
  // about the SPEC ("is anything in flight here"), which is why it
  // arrives as one flag rather than being re-derived per step.
  //
  // Why the box will not take a click, on the label the pointer is
  // already over — worded through `currentStep`/`stateLabel` rather
  // than freshly, because a spec's state and a phase's state must never
  // be worded differently.
  const why = busy ? busyReason(g) : "";
  // The step actually being WORKED gets the spinner; every other step
  // gets the lock and the same sentence. Both are off — the difference
  // is what a reader is being told, not what they can do. A queued job
  // is spinning nothing yet, so none of its steps does either.
  const running = g.lead?.state === "running" ? currentStep(g.lead) : "";
  return phases(
    QUEUE_STEPS.map((s) =>
      phaseChip({
        // `data-phase`, not `data-step`: the phase LINES already carry
        // `data-step`, and a test enumerating them would find four
        // checkboxes on the header row as well.
        dataAttr: "data-phase",
        value: s,
        // The step keeps its technical name everywhere it is a VALUE;
        // the reader is shown `review`, never `review-plan`.
        label: stepLabel(s),
        name: "steps",
        checked: checked.has(s) && !busy,
        done: done.has(s),
        busy: busy && s === running,
        disabled: busy && s !== running,
        title: busy ? why : undefined,
      }),
    ).join(""),
  );
}

// The run form's own id. It exists for the "more" line's sake alone:
// those fields sit in a different `<tr>`, and `form="<id>"` is what
// makes the browser post them with this form anyway.
const runFormId = (g: SpecGroup): string => `rowrun-${groupKey(g.project, g.specFolder)}`;

// The row's own anchor. `id`, not `data-folder`: a badge pointing at
// another spec's row needs something `href="#..."` can find with no
// script at all — this page's own rule. Same shape as `runFormId`, so
// "an id that names a spec" stays the one convention it already is.
const rowAnchorId = (g: SpecGroup): string => `spec-${groupKey(g.project, g.specFolder)}`;

// The three things nobody sets every time — the model, the other repos
// the job will touch, and whether to stop for approval between the
// steps. Built here rather than inside `moreRow` so the `form`
// attribute every one of them needs is written once, beside the id it
// has to match.
function moreFields(g: SpecGroup, opts: QueuePageOptions, busy: boolean): string {
  // Three fields that set up a job, on a row where no job can be
  // started: while the spec is busy every one of them is disabled, and
  // each carries the same sentence the phase boxes do.
  const why = busy ? busyReason(g) : "";
  // The heavy model is worth reserving for heavy work, so the choice is
  // explicit and the default is "whatever the config says per step".
  // Each option carries what it is granted per step, because that is the
  // number that decides whether the job can finish — the default one
  // included. Without a figure the default was the only option on the
  // list without one, which read as the cheap or the unknown choice
  // while it was in fact the most generous: picking `opus` granted $15
  // for the same model the default ran at $35.
  const models = opts.modelChoices ?? [];
  const asConfigured =
    typeof opts.defaultBudgetUsd === "number"
      ? `as configured per step — $${opts.defaultBudgetUsd} per step`
      : "as configured per step";
  const formId = runFormId(g);
  const select = models.length
    ? field(
        "Model",
        `<select name="model" form="${esc(formId)}"${busy ? " disabled" : ""}>` +
          `<option value="">${esc(asConfigured)}</option>` +
          models
            .map((m) => `<option value="${esc(m.name)}">${esc(m.name)} — $${m.budgetUsd} per step</option>`)
            .join("") +
          `</select>`,
      )
    : "";
  // The row's own project is watched already, so offering it again is an
  // error waiting to be submitted. The row knows which spec it is before
  // it is drawn, so this is a filter at render time — the old shared
  // form had to disable the box from script as the selection changed.
  const others = (opts.projects ?? []).filter((p) => p !== g.project);
  const extraField = others.length
    ? field(
        "Also touches",
        phases(
          others
            .map((p) =>
              phaseChip({
                dataAttr: "data-project",
                value: p,
                label: p,
                name: "extraProjects",
                form: formId,
                disabled: busy,
                title: busy ? why : undefined,
              }),
            )
            .join(""),
        ),
        { group: true },
      )
    : "";
  // Off by default. It sits behind the same disclosure as the model and
  // the other repos, because those three ARE what the row's "more"
  // promises — one place for everything nobody sets every time, rather
  // than one control in the open and two hidden.
  const gate = phaseChip({
    dataAttr: "data-gate",
    value: "1",
    label: "stop for approval between steps",
    name: "gate",
    form: formId,
    disabled: busy,
    title: busy ? why : undefined,
  });
  return `${select}${extraField}${gate}`;
}

// One control per spec, on the spec's own row: tick the phases, press
// Run once, and they go as ONE job in the workflow's order — the browser
// submits checkboxes in the order they are drawn, never in the order
// they were clicked.
//
// It sits on the spec's own CONTROLS line — under the header, never
// inside it (`controlsRow`) — and it is drawn only for a row the reader
// has OPENED (see `groupRows`): a collapsed row is about what the spec
// is and how far it has got, not about starting it.
//
// Everything the retired form above the table asked for is still here:
// four boxes and a button on the line the row opens to, and the three
// rarely-set fields on the "more" line beneath that (`moreRow`).
function specRunForm(g: SpecGroup, opts: QueuePageOptions): string {
  // Run while any phase is still to run for the first time; Run again
  // only once every phase has — a spec with `archive` pre-ticked and
  // never run was offering "Run again" for it. While a job is in flight
  // the control reads as busy AND is disabled: it used to be only the
  // first, with a title inviting the reader to tick a phase the job did
  // not hold — the exact press the queue then refused.
  const busy = specBusy(g);
  // Archive is left out on purpose: a spec whose folder actually moved
  // has left this page altogether (`serve.ts` drops archived specs), so
  // archive can never be true for a row that is here to read. Requiring
  // it would make "Run again" unreachable for every spec there is.
  const allDone = QUEUE_STEPS.filter((s) => s !== "archive").every((s) => g.done.includes(s));
  // Plain disabled while busy — never the busy VARIANT, whose built-in
  // spinner would stand beside the running phase chip's: the row has
  // one spinner, and the chip holds it (2026-08-19).
  const run = btn({
    label: allDone ? "Run again" : "Run",
    variant: busy ? "" : "primary",
    pending: "starting…",
    disabled: busy,
    title: busy ? busyReason(g) : undefined,
  });
  return (
    `<form id="${esc(runFormId(g))}" method="post" action="/api/queue" class="rowrun">` +
    `${tokenField(opts.token)}${filterFields(opts.filter)}` +
    `<input type="hidden" name="project" value="${esc(g.project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
    stepBoxes(g, busy) +
    run +
    `</form>`
  );
}

// Everything an OPEN row offers that a shut one does not, on a line of
// its own directly under the header. It used to be concatenated into
// the header's last `<td>` beside whatever that cell already showed —
// a cell nothing sets a width on, so it wrapped, and the header line
// the reader was scanning moved down at the moment they acted on it
// (spec 109). `moreRow` had already been pulled out of that same cell
// for that same reason; this is the rest of it.
//
// Cancel only, never Approve: a gate's Approve stays on the header,
// where a shut row already offers it, so the one decision is in one
// place. Merge stays there for the same reason.
function controlsRow(g: SpecGroup, opts: QueuePageOptions): string {
  return (
    `<tr data-controls="${esc(g.specFolder)}"><td colspan="6">` +
    specRunForm(g, opts) +
    (g.lead ? actionForm(g.lead, opts.token, opts.filter, { cancelOnly: true }) : "") +
    `</td></tr>`
  );
}

// "more" on a line of its OWN, under the row it belongs to. It used to
// be a `<details>` inside the action cell: opening it widened that cell
// and shoved every column sideways, so the reader lost their place on a
// row they were reading. A full-width row cannot widen a column,
// because it is not inside one.
//
// Drawn only when the row is open, and omitted rather than hidden —
// the same rule the phase lines follow (`groupRows`).
function moreRow(g: SpecGroup, opts: QueuePageOptions, busy: boolean): string {
  // `<details>` has no `disabled` of its own, and inventing CSS to fake
  // one would be a new class for no new promise. So the disclosure
  // still opens — every field inside it is individually disabled, which
  // is where the promise actually lives — and the summary says why in
  // the same words, in the muted look the page already has.
  const summary = busy
    ? `<summary class="muted" title="${esc(busyReason(g))}">more</summary>`
    : `<summary title="more: model, gate, also touches">more</summary>`;
  return (
    `<tr data-more="${esc(g.specFolder)}"><td colspan="6">` +
    `<details class="more">${summary}` +
    `<span class="row">${moreFields(g, opts, busy)}</span></details></td></tr>`
  );
}

// The one control on this page that is NOT about a spec that exists:
// every other way in is a form on a spec's own row, and a spec that has
// never been written has no row to put one on. So it is a panel above
// the table — where the retired "Run a spec" form used to be, which is
// also the only place left for it.
//
// Three fields and nothing else. Everything a job can be tuned with —
// the model, the other repos, whether to stop for approval — belongs to
// running a spec, and this form does not run one: it makes a spec, which
// then appears as a row and is run from there like all the others.
//
// It posts a project NAME, a title and a description. What the spec ends
// up being CALLED is decided by `/aide-create` alone: nothing here, and
// nothing in `aide-run-spec`, computes a spec number or a folder slug.
// What the new spec builds on (spec 110). One chip per active spec,
// newest first — the number is the order a reader thinks in, and it is
// the reverse of `discoverProjects`'s ascending sort.
//
// The chip's own project rides on a WRAPPER, not on the chip: `phaseChip`
// ties its `data-` attribute to its form value, and the value here has
// to be the folder. A bare `<span>` with a data attribute needs no class,
// so the closed component vocabulary (`css-token-guard.test.ts`) is
// untouched.
//
// Every project's chips are rendered, and the browser scopes them to the
// chosen one (`queue-client.ts`). Without script they are all offered,
// and a cross-project pick is caught by the same server refusal that
// catches it from the API — the convenience is lost, the guard is not.
function dependsOnField(opts: QueuePageOptions): string {
  const specs = [...(opts.targets ?? [])].sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      -a.specFolder.localeCompare(b.specFolder, "en", { numeric: true }),
  );
  if (specs.length === 0) return "";
  return field(
    "Depends on",
    phases(
      specs
        .map(
          (t) =>
            `<span data-project="${esc(t.project)}">` +
            phaseChip({
              dataAttr: "data-depends",
              value: t.specFolder,
              label: t.specFolder,
              name: "dependsOn",
            }) +
            `</span>`,
        )
        .join(""),
    ),
    { group: true },
  );
}

function newSpecForm(opts: QueuePageOptions): string {
  const projects = opts.createProjects ?? [];
  if (projects.length === 0) return "";
  return (
    // The page's one creating action, and it read as grey disclosure
    // text. It stays a `<details>`/`<summary>` pair — that is what
    // opens it without script, and what `queue-client.ts` closes on a
    // successful create — but it wears the same primary-button look as
    // every other action here.
    `<details class="newspec"><summary class="btn primary">New spec</summary>` +
    `<form method="post" action="/api/queue/create" class="newspecform">${tokenField(opts.token)}` +
    field(
      "Project",
      `<select name="project">` +
        projects.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("") +
        `</select>`,
    ) +
    dependsOnField(opts) +
    field(
      "Title",
      `<input type="text" name="title" maxlength="120" required ` +
        `placeholder="what the spec is about, in a few words">`,
    ) +
    // Create belongs on the first line with the short fields, not under
    // the textarea it used to touch. `.field.wide` is `flex-basis:100%`,
    // so Description breaks the wrapping row on its own; anything after
    // it in the markup lands underneath it.
    btn({ label: "Create", variant: "primary", pending: "creating…" }) +
    field(
      "Description",
      `<textarea name="description" rows="4" maxlength="2000" required ` +
        `placeholder="the problem, and what you want instead"></textarea>`,
      { wide: true },
    ) +
    // The slot a refusal is written into. A rejected create names a spec
    // that was never made, so there is no row for the reason to land on
    // the way there is for every other action — and the page-level
    // banner sits above a disclosure that may well be shut, which is
    // where a create refusal went unread. Empty until something fills
    // it (`.refused:empty` draws nothing).
    messageSlot("refused") + `</form></details>`
  );
}

// One line about the spec: what it is, and how far it has got. It has to
// SAY something even when there is nothing recorded — a line that is
// blank on half the rows reads as a page that failed to load.
function specSummary(g: SpecGroup): string {
  const bits: string[] = [];
  if (g.title) bits.push(esc(g.title));
  if (g.phase) bits.push(esc(g.phase));
  if (typeof g.percent === "number") bits.push(`${g.percent}% done`);
  // The same words `aide-run-spec`'s dependency guard refuses in — by
  // folder, one per dependency — so the row and the refusal say the same
  // thing about the same fact.
  if (g.dependsOn.length) bits.push(`depends on ${g.dependsOn.map(esc).join(", ")}`);
  return bits.length ? bits.join(" · ") : `<span class="muted">no status recorded yet</span>`;
}

// A dependency identifier — "106", or the whole folder name — resolved
// the same narrow way `aide-run-spec`'s own `resolve_dependency_folder`
// does: exact folder, or an `<id>-` prefix, and nothing fuzzier. Scoped
// to the dependent spec's own project, so a spec numbered the same
// somewhere else is never what a row is waiting on.
function resolveDependency(from: SpecGroup, id: string, all: SpecGroup[]): SpecGroup | undefined {
  return all.find(
    (g) => g.project === from.project && (g.specFolder === id || g.specFolder.startsWith(`${id}-`)),
  );
}

// "after 106" — one per dependency that is still in the way, by the same
// rule `aide-run-spec` refuses a run on: that spec's own branch is still
// unmerged. `dep.branches` already answers it for every spec on the
// page, the identical expression the row reads about its OWN branches
// one line below. No git is asked anything here.
//
// The RESOLVED folder's leading digits, not the identifier as written: a
// `Depends on:` line naming the full slug would otherwise print it whole
// on every row waiting on it. Every `specFolder` starts with digits by
// construction — `discover.ts` only reads folders that do.
function dependencyBadges(g: SpecGroup, all: SpecGroup[]): string {
  return g.dependsOn
    .map((id) => resolveDependency(g, id, all))
    .filter((dep): dep is SpecGroup => !!dep && dep.branches.some((b) => !b.merged))
    .map(
      (dep) =>
        ` <a href="#${esc(rowAnchorId(dep))}">` +
        badge(
          "waiting",
          `after ${dep.specFolder.split("-", 1)[0]}`,
          `${dep.specFolder} is not merged yet`,
        ) +
        `</a>`,
    )
    .join("");
}

// The header line for one spec: what it is, how far it has got, what it
// has cost in total, and the one action the spec is actually waiting on.
// Running its phases is NOT here — that, and stopping a run, live on the
// controls line an open row grows beneath this one (`controlsRow`).
function specHeadRow(
  g: SpecGroup,
  opts: QueuePageOptions,
  now: number,
  opened: Set<string>,
  all: SpecGroup[],
): string {
  // Three answers, not two — and named `run-*` rather than
  // `active`/`archived`, which `site.ts` uses for the unrelated
  // question of whether a spec folder has been archived on disk. The
  // two used to share the words and mean different things.
  const rowClass = !g.lead ? "run-new" : inFlight(g.lead) ? "run-live" : "run-past";
  // The spec name is the way IN: the job it points at is whatever is
  // running, or the last thing that happened. The diff link sits beside
  // it rather than replacing it — nothing a reader uses today disappears.
  // A spec that has never run has no job page to point at, so the name
  // is text: a link to nothing is worse than no link.
  const spec = g.lead
    ? `<a href="/specs/${esc(g.lead.id)}">${esc(g.specFolder)}</a>`
    : esc(g.specFolder);
  // The badge is about the branch AND the job that is still writing to
  // it, so the row's lead job comes down with the list.
  const diff = g.branches.length
    ? ` ${branchList(g.branches, g.lead ? branchActivity(g.lead) : undefined)}`
    : "";
  // One pip per phase: green for a phase that has run, blue for the one
  // running now, grey for a phase still ahead. The whole workflow in six
  // millimetres, on the line you are already reading.
  // `create` is a phase LINE and never a pip (spec 116): the glance is
  // about the four phases a reader can still run, and a spec that
  // exists cannot be created again.
  const progress = pips(
    g.phases.filter((p) => p.step !== "create").map((p) => ({
      // One rule, one function: what the FILES say, qualified by the
      // most relevant attempt (whatever is in flight, else the latest).
      // The pips used to read the job history alone, so a spec analysed
      // by hand showed four grey pips and a cancelled re-run turned a
      // finished phase grey again.
      kind: wordPhase(g.done.includes(p.step), p.heldBack, p.attempts.find(inFlight) ?? p.attempts[0])
        .pip,
      title: stepLabel(p.step),
    })),
  );
  const jobs = g.phases.reduce((n, p) => n + p.attempts.length, 0);
  // The same key the fold state is written in, so no second format for
  // "which spec" is invented.
  const refusal =
    opts.errorSpec && opts.errorSpec === groupKey(g.project, g.specFolder) ? opts.error : undefined;
  // The one refusal with a way out. Both halves are required: the
  // reason belongs to whichever row the refusal does, so a conflict on
  // another spec's row must not offer this one a resolve.
  const conflict = !!refusal && opts.errorReason === "conflict";
  // The earliest phase the spec's own files say has not happened — the
  // same pair `stepBoxes` ticks its box from and the Run button reads
  // for "Run" vs "Run again", asked once more for the sentence. Worded
  // for a reader here, so `review-plan` reaches it as "review".
  const nextStep = QUEUE_STEPS.find((s) => !g.done.includes(s));
  const readyPhase = nextStep ? stepLabel(nextStep) : undefined;
  return (
    // `data-folder`, not `data-spec`: the attribute NAME would otherwise
    // end in the same "a-spec" that half the fixtures use as a folder,
    // and a test looking for a spec by name would find the markup.
    `<tr class="spechead ${rowClass}" id="${esc(rowAnchorId(g))}" data-folder="${esc(g.specFolder)}">` +
    `<td><div class="spec-name">${foldControl(g, opts.filter ?? {}, opened)} ${spec}${diff}</div>` +
    `<div class="spec-title">${esc(g.project)} · ${specSummary(g)}</div>` +
    // Why the button you just pressed did nothing — on the row you
    // pressed it on, with the warning mark beside it, so a refusal is
    // never told from a running row by colour alone.
    (refusal ? rowMessage("err", refusal, { hook: "refused" }) : "") +
    `</td>` +
    `<td>${progress}` +
    `<div class="muted small">${jobs} ${jobs === 1 ? "run" : "runs"}</div></td>` +
    // The badge says the state; the sentence beside it says what is
    // going on and what the next click is. The pips, the badge and the
    // branch marks each answer a narrower question, and a reader had to
    // assemble this from all of them.
    `<td>${g.lead ? stateCell(g.lead) : notStartedChip()}` +
    `<div class="muted small">${esc(
      nextActionHint(
        g.lead,
        g.branches.some((b) => !b.merged),
        g.phases.find((p) => p.step === "archive")?.heldBack?.reason,
        readyPhase,
      ),
    )}${dependencyBadges(g, all)}</div></td>` +
    `<td>${g.latest ? relTime(g.latest.startedAt ?? g.latest.createdAt, now) : "–"}</td>` +
    `<td class="num">${costCell(g.spentUsd, "–")}</td>` +
    // The same cell whether the row is open or shut, which is the whole
    // point: at most one action — whichever the spec is actually
    // waiting on — so opening a row cannot make this cell taller and
    // take the line the reader was scanning down with it.
    `<td>${collapsedAction(g, opts, !!refusal, conflict)}</td></tr>`
  );
}

// One line per phase, in the workflow's own order, whether or not it has
// happened. A phase nobody has run yet is the point of the fixed order:
// it says what is still ahead without anyone counting rows.
//
// Read-only: the phase is RUN from the header row, which is the only
// line a collapsed spec leaves in the page. The trailing cell stays,
// empty — the table is six columns wide on every row.
function phaseSubRows(g: SpecGroup, now: number): string {
  return g.phases
    .map((p) => {
      const latest = p.attempts[0];
      const word = wordPhase(g.done.includes(p.step), p.heldBack, latest);
      const name = latest
        ? `<a href="/specs/${esc(latest.id)}">${esc(stepLabel(p.step))}</a>`
        : `<span class="muted">${esc(stepLabel(p.step))}</span>`;
      // The latest attempt, with a count when there have been more —
      // three archive runs on one spec is a real history, not a row to
      // repeat three times.
      // The plan is about an older problem than the description is: said
      // on the analyze line, because analyze is the phase that has to
      // run again. Amber, like every other "worth noticing, not
      // alarming" mark on this page — and it blocks nothing.
      const stale =
        p.step === "analyze" && g.analyzeStale
          ? " " +
            badge(
              "waiting",
              "description changed since",
              "1-description.md was committed after the last finished analyze",
            )
          : "";
      const tries =
        p.attempts.length > 1
          ? `<div class="muted small">${p.attempts.length} attempts</div>`
          : latest?.model
            ? `<div class="muted small">${esc(latest.model)}</div>`
            : "";
      return (
        `<tr class="subrow${latest ? "" : " untried"}" data-step="${esc(p.step)}">` +
        `<td class="phasecell">${name}${stale}</td>` +
        `<td>${tries}</td>` +
        `<td>${phaseWordCell(word, latest)}</td>` +
        `<td>${latest ? relTime(latest.startedAt ?? latest.createdAt, now) : ""}</td>` +
        `<td class="num">${latest ? costCell(latest.spentUsd, "") : ""}</td>` +
        `<td></td></tr>`
      );
    })
    .join("");
}

// A collapsed row OMITS its phase lines and its "more" line rather than
// hiding them: the state is in the URL, so the server knows before it
// draws. A `<details>` cannot do this — it breaks the table — and a
// checkbox's state would be destroyed by the innerHTML swap every five
// seconds.
//
// Collapsed is the default, and the URL names the exceptions. That is
// what the fold is FOR: a list of twenty specs is read one state at a
// time, and the row you are about to act on is the one you open.
function groupRows(
  groups: SpecGroup[],
  opts: QueuePageOptions,
  now: number,
  opened: Set<string>,
  all: SpecGroup[],
): string {
  return groups
    .map((g) => {
      const head = specHeadRow(g, opts, now, opened, all);
      return opened.has(groupKey(g.project, g.specFolder))
        ? head + controlsRow(g, opts) + moreRow(g, opts, specBusy(g)) + phaseSubRows(g, now)
        : head;
    })
    .join("");
}

// The controls and the rows alone, so the page can refresh its table
// from script without touching a form someone is half-way through
// filling in.
//
// One list, cut and ordered on demand. It used to be two — a fixed
// "Active" section above a "Recent" one — which answered the single
// question "is anything running?" and no other. A filter answers that
// one too, and every other one besides.
//
// One line per SPEC, not per job. A spec taken through its four steps as
// four separate jobs used to fill four rows, repeating its own name on
// every one, each showing a single progress pip. It is one spec, and it
// gets one line, with its phases beneath it.
export function renderQueueRows(rows: QueueRowView[], opts: QueuePageOptions, now = Date.now()): string {
  const f = opts.filter ?? {};
  const groups = groupBySpec(rows, opts.targets, opts.archived);
  const matched = sortGroups(applyFilter(groups, f), f);
  const hidden = Math.max(0, matched.length - SHOWN);
  const body = matched.length
    ? // `groups`, not `matched`: a dependency the filter or the 25-row
      // cap has hidden is still in the way of the row that names it.
      groupRows(matched.slice(0, SHOWN), opts, now, openedSet(f), groups)
    : `<tr><td colspan="6" class="empty muted">` +
      // Two different emptinesses. "Nothing matches what you asked for"
      // is answered by changing the filter; "there is no spec here at
      // all" is not, and telling that reader to pick one above is
      // pointing at an empty dropdown.
      (groups.length
        ? "No spec matches this filter."
        : "No spec to show — no project on this machine has one to run.") +
      `</td></tr>`;
  return (
    filterBar(groups, f) +
    `<table class="list">${sortableHead(f)}<tbody>${body}</tbody></table>` +
    (hidden ? `<p class="muted small listnote">${hidden} older ${hidden === 1 ? "spec" : "specs"} not shown.</p>` : "")
  );
}

export function renderQueuePage(
  rows: QueueRowView[],
  generatedAt: string,
  entries: NavEntry[],
  opts: QueuePageOptions,
): string {
  // One container: the script swaps its whole contents, so the controls
  // and the rows can never drift apart on a refresh.
  const table = `<div id="jobrows">${renderQueueRows(rows, opts)}</div>`;
  const notice = opts.runnerAvailable
    ? ""
    : `<p class="muted">No runner is installed on this machine yet (slice 81b) — ` +
      `queued jobs stay queued, and nothing here spends money.</p>\n`;
  const body =
    notice +
    // The fallback, and only that. A refusal that names its spec is
    // shown on that spec's own row (`specHeadRow`) — the page lists up
    // to 25 of them, so the banner said nothing about which button was
    // pressed. One that names no spec has nowhere else to go, and
    // dropping it silently is worse than a banner.
    (opts.error && !opts.errorSpec
      ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) + "\n"
      : "") +
    // OUTSIDE `#jobrows`, deliberately: the script swaps that container
    // every five seconds, and a half-typed description must survive it.
    newSpecForm(opts) +
    table;
  // The front page IS aide: the tab says only that.
  return pageShell("Specs", entries, "/", body, generatedAt, 10, {
    docTitle: "aide",
    refreshInNoscript: !!opts.script,
    script: opts.script,
  });
}
