// /specs: the one list of every spec there IS — cut and ordered on
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
  IN_FLIGHT,
  branchActivity,
  currentStep,
  inFlight,
  stateChip,
  unmergedBadge,
  type BranchView,
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
}

export interface QueuePageOptions {
  /** 81a ships no runner: the page says so rather than leaving jobs in
   *  "queued" with no explanation. */
  runnerAvailable: boolean;
  targets: QueueTarget[];
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
  /** Why the last attempt was refused. Shown on the form, because the
   *  person who pressed the button is the one who needs to read it. */
  error?: string;
  /** Which spec that refusal belongs to, as `<project>/<specFolder>` —
   *  the same key the fold state already uses. The page lists up to 25
   *  rows, so a reason with no row attached says nothing about which
   *  button was pressed. Derived server-side from the job, never taken
   *  from the browser. */
  errorSpec?: string;
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
  /** Which specs are folded shut: `<project>/<folder>`, comma-separated.
   *  It rides in the query string with the rest of the filter, which is
   *  the whole reason it survives the five-second swap of the table —
   *  `swapRows` sends `location.search` back on every tick. Never
   *  rendered as text: only compared for membership, and re-encoded
   *  through `queueHref`. */
  fold?: string;
}

// --- what every form on this page needs ------------------------------------

const QUEUE_STEPS = ["analyze", "review-plan", "implement", "archive"];

// Every form on this page posts to the guarded surface, so every one of
// them carries the token when the page has one. Written once: a form
// that forgot it would be refused with a 401 the reader cannot act on.
const tokenField = (token?: string): string =>
  token ? `<input type="hidden" name="token" value="${esc(token)}">` : "";

/** How the list is cut and ordered. One list, exported so `serve.ts`
 *  builds the redirect after a POST from the same five keys the forms
 *  send — two copies would eventually disagree about what "the view" is. */
export const FILTER_KEYS = ["state", "project", "sort", "dir", "fold"] as const;

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
// Each column has the direction you almost always want first: newest
// run, dearest job, but names from A.
const SORT_DEFAULT_DIR: Record<string, "asc" | "desc"> = {
  started: "desc", cost: "desc", spec: "asc", state: "asc",
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
    phases: QUEUE_STEPS.map((step) => ({ step, attempts: [] })),
    ...fromTarget(t),
  };
}

/** What a row reads off its own spec rather than off its jobs. Written
 *  once because both constructors need it, and a row showing another
 *  spec's done-set or progress is the one way this join can go wrong. */
function fromTarget(
  t: QueueTarget | undefined,
): Pick<SpecGroup, "done" | "title" | "phase" | "percent" | "analyzeStale"> {
  return {
    done: t?.done ?? [],
    title: t?.title,
    phase: t?.phase,
    percent: t?.percent,
    analyzeStale: t?.analyzeStale ?? false,
  };
}

function groupBySpec(rows: QueueRowView[], targets: QueueTarget[]): SpecGroup[] {
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
  const fromJobs = [...byKey.entries()]
    .filter(([key, all]) => known.has(key) || !judgeable.has(all[0]!.project))
    .map(([key, all]) => jobGroup(all, byKeyTarget.get(key)));
  return [
    ...fromJobs,
    ...targets.filter((t) => !byKey.has(groupKey(t.project, t.specFolder))).map(emptyGroup),
  ];
}

function jobGroup(all: QueueRowView[], target: QueueTarget | undefined): SpecGroup {
  const recent = [...all].sort((a, b) => activityMs(b) - activityMs(a));
  const lead = recent.find(inFlight) ?? recent[0]!;
  // The four the form offers, always, in order — a phase nobody has
  // run yet still holds its place, which is what makes progress
  // readable at a glance. A step outside them (explore, create,
  // manifest) is appended rather than dropped: a job that ran is
  // never invisible.
  const extra = [...new Set(all.flatMap(stepsTouched))].filter((s) => !QUEUE_STEPS.includes(s));
  return {
    project: lead.project,
    specFolder: lead.specFolder,
    lead,
    latest: recent[0]!,
    state: lead.state,
    spentUsd: all.reduce((sum, r) => sum + r.spentUsd, 0),
    activityAt: activityMs(recent[0]!),
    branches: branchesOf(recent),
    phases: [...QUEUE_STEPS, ...extra].map((step) => ({
      step,
      attempts: recent
        .map((r) => attemptFor(r, step))
        .filter((a): a is QueueRowView => a !== null),
    })),
    ...fromTarget(target),
  };
}

function applyFilter(groups: SpecGroup[], f: QueueFilter): SpecGroup[] {
  const states = stateFilter(f.state).states;
  return groups.filter(
    (g) => (!states || states.includes(g.state)) && (!f.project || g.project === f.project),
  );
}

function sortGroups(groups: SpecGroup[], f: QueueFilter): SpecGroup[] {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : "started";
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
      (typeof x === "string" ? String(x).localeCompare(String(y)) : (x as number) - (y as number)) * sign;
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
  return esc(q ? `/specs?${q}` : "/specs");
}

const foldedSet = (f: QueueFilter): Set<string> =>
  new Set((f.fold ?? "").split(",").filter(Boolean));

// The fold is a LINK, not a button, and the state is in the URL. That
// buys three things at once for no browser code at all: it works with
// script off, `queue-client.ts` already intercepts `a[data-nav]` inside
// `#jobrows` so a click neither reloads the page nor wipes a half-filled
// form, and the choice survives the table swapping itself every five
// seconds — the same mechanism the filter and the sort ride on.
function foldControl(g: SpecGroup, f: QueueFilter, folded: Set<string>): string {
  const key = groupKey(g.project, g.specFolder);
  const shut = folded.has(key);
  const next = shut ? [...folded].filter((k) => k !== key) : [...folded, key];
  return (
    `<a class="fold" data-nav href="${queueHref(f, { fold: next.join(",") })}" ` +
    // The key is never the visible content — anything in `?fold=` is
    // attacker-chosen text, and a glyph cannot be mistaken for markup.
    `aria-expanded="${shut ? "false" : "true"}" ` +
    `title="${shut ? "show" : "hide"} the phases of ${esc(g.specFolder)}">${shut ? "▸" : "▾"}</a>`
  );
}

function filterBar(groups: SpecGroup[], f: QueueFilter): string {
  const chips = (
    name: string,
    label: string,
    entries: { key: string; label: string; count: number; on: boolean; patch: QueueFilter }[],
  ) =>
    `<span class="filtergroup" data-filter="${esc(name)}"><span class="fieldlabel">${esc(label)}</span>` +
    entries
      .map(
        (e) =>
          `<a data-nav href="${queueHref(f, e.patch)}"${e.on ? ` aria-current="true"` : ""}>` +
          `${esc(e.label)} <span class="tabcount">${e.count}</span></a>`,
      )
      .join("") +
    `</span>`;

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
  if (names.length < 2) return `<div class="listcontrols">${states}</div>`;
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
  return `<div class="listcontrols">${states}${projects}</div>`;
}

function sortableHead(f: QueueFilter): string {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : "started";
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  const th = (key: string, label: string, cls = "") => {
    const on = key === sort;
    // Clicking the column you are already sorted by turns it round.
    const next = on ? (dir === "asc" ? "desc" : "asc") : SORT_DEFAULT_DIR[key]!;
    const mark = on ? ` <span class="sortmark">${dir === "asc" ? "▴" : "▾"}</span>` : "";
    const aria = on ? ` aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : "";
    return (
      `<th class="${cls}"${aria}>` +
      `<a data-nav href="${queueHref(f, { sort: key, dir: next === SORT_DEFAULT_DIR[key] ? "" : next })}">` +
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

function actionForm(r: QueueRowView, token: string | undefined, filter: QueueFilter | undefined): string {
  const action =
    r.state === "awaiting-approval" ? "approve" : r.state === "queued" || r.state === "running" ? "cancel" : null;
  if (!action) return "";
  const hidden = tokenField(token) + filterFields(filter);
  return (
    `<form method="post" action="/api/queue/${esc(r.id)}/${action}">${hidden}` +
    `<button type="submit">${action === "approve" ? "Approve" : "Cancel"}</button></form>`
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

function mergeForm(g: SpecGroup, opts: QueuePageOptions): string {
  const open = g.branches.filter((b) => !b.merged);
  // No lead means no job, which means no branch — the guard is for the
  // type checker, and it holds for the same reason the `if` above does.
  if (open.length === 0 || !g.lead) return "";
  const names = open.map((b) => b.label).join(", ");
  const label = mergeLabel(open, g, opts);
  const hidden = tokenField(opts.token) + filterFields(opts.filter);
  const action = `/api/queue/${esc(g.lead.id)}/merge`;
  if (!inFlight(g.lead)) {
    return (
      `<form method="post" action="${action}" class="mergeform">${hidden}` +
      `<button type="submit" title="${esc(names)}">${esc(label)}</button></form>`
    );
  }
  // Two controls, not one button that flips: a button re-enabled the
  // moment someone notices is still the default action in every way
  // that matters — same size, same place, one click. Merging mid-job
  // stays possible for someone who MEANS it, which is what makes the
  // small one behind a confirmation the right shape.
  //
  // The confirm text is fixed on purpose. Interpolating the step or the
  // repo names would put render-time strings inside a JS string literal
  // inside an HTML attribute — two escaping contexts at once, for a
  // sentence that needs neither.
  return (
    `<span class="mergeform">` +
    `<button type="button" disabled title="${esc(names)}">${esc(label)}</button> ` +
    `<form method="post" action="${action}" class="mergeoverride" ` +
    `onsubmit="return confirm('This spec still has a step running. Merge anyway?')">${hidden}` +
    `<button type="submit" class="small" title="${esc(names)}">merge anyway</button></form></span>`
  );
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
          `title="compare the branch in ${esc(b.label)}">${esc(b.label)}</a>${unmergedBadge(b, activity)}</span>`,
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
// `blank` because a header with nothing spent still owes the reader a
// dash, while an empty phase line should simply be empty.
const costCell = (spentUsd: number, blank: string): string =>
  spentUsd > 0 ? `$${spentUsd.toFixed(2)}` : blank;

// A step the spec has already had is marked done and left unticked; a
// step already queued or running is disabled, because the queue would
// refuse it anyway and a button that says so before the press is kinder
// than a refusal after it.
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
function stepBoxes(g: SpecGroup): string {
  const done = new Set(g.done);
  const next = QUEUE_STEPS.find((s) => !done.has(s));
  const pair = ["analyze", "review-plan"].filter((s) => !done.has(s));
  const single = next ? [next] : [];
  const checked = new Set(g.lead || pair.length === 0 ? single : pair);
  const busy = new Set(g.phases.filter((p) => p.attempts.some(inFlight)).map((p) => p.step));
  return QUEUE_STEPS.map((s) => {
    const isDone = done.has(s);
    // Busy wins over pre-ticked: a box the reader sees ticked but cannot
    // submit is worse than one that is simply not ticked.
    const off = busy.has(s);
    return (
      // `data-phase`, not `data-step`: the phase LINES already carry
      // `data-step`, and a test enumerating them would find four
      // checkboxes on the header row as well.
      `<label class="stepbox${isDone ? " isdone" : ""}" data-phase="${esc(s)}">` +
      `<input type="checkbox" name="steps" value="${esc(s)}"` +
      `${checked.has(s) && !off ? " checked" : ""}${off ? " disabled" : ""}> ` +
      `${esc(s)}${isDone ? ' <span class="tick" title="already done">✓</span>' : ""}</label>`
    );
  }).join("");
}

// One control per spec, on the spec's own row: tick the phases, press
// Run once, and they go as ONE job in the workflow's order — the browser
// submits checkboxes in the order they are drawn, never in the order
// they were clicked.
//
// It sits on the HEADER row and not on the phase lines, because folding
// OMITS those lines from the page (see `groupRows`). A control on a line
// that is sometimes not drawn is a control that sometimes is not there.
//
// Everything the retired form above the table asked for is here. The
// model is in the open; the other repos the job will touch and whether
// to stop for approval between the steps are behind a disclosure, so
// four boxes and a button is all the row costs when nobody asks.
function specRunForm(g: SpecGroup, opts: QueuePageOptions): string {
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
  const select = models.length
    ? `<select name="model">` +
      `<option value="">${esc(asConfigured)}</option>` +
      models
        .map((m) => `<option value="${esc(m.name)}">${esc(m.name)} — $${m.budgetUsd} per step</option>`)
        .join("") +
      `</select>`
    : "";
  // The row's own project is watched already, so offering it again is an
  // error waiting to be submitted. The row knows which spec it is before
  // it is drawn, so this is a filter at render time — the old shared
  // form had to disable the box from script as the selection changed.
  const others = (opts.projects ?? []).filter((p) => p !== g.project);
  const extraField = others.length
    ? `<span class="field"><span class="fieldlabel">Also touches</span>` +
      `<span class="steps">` +
      others
        .map(
          (p) =>
            `<label class="stepbox" data-project="${esc(p)}">` +
            `<input type="checkbox" name="extraProjects" value="${esc(p)}"> ${esc(p)}</label>`,
        )
        .join("") +
      `</span></span>`
    : "";
  // Off by default, and SHOWN. Hiding it made the button quietly create
  // a job that stops for approval after every step — the opposite of
  // what pressing it looks like it does.
  const gate =
    `<label class="stepbox gate"><input type="checkbox" name="gate"> ` +
    `stop for approval between steps</label>`;
  return (
    `<form method="post" action="/api/queue" class="rowrun">${tokenField(opts.token)}${filterFields(opts.filter)}` +
    `<input type="hidden" name="project" value="${esc(g.project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
    `<span class="steps">${stepBoxes(g)}</span>` +
    select +
    `<details class="more"><summary>more</summary>${extraField}${gate}</details>` +
    `<button type="submit">Run</button></form>`
  );
}

// One line about the spec: what it is, and how far it has got. It has to
// SAY something even when there is nothing recorded — a line that is
// blank on half the rows reads as a page that failed to load.
function specSummary(g: SpecGroup): string {
  const bits: string[] = [];
  if (g.title) bits.push(esc(g.title));
  if (g.phase) bits.push(`<span class="chip">${esc(g.phase)}</span>`);
  if (typeof g.percent === "number") bits.push(`${g.percent}% done`);
  return bits.length ? bits.join(" · ") : `<span class="muted">no status recorded yet</span>`;
}

// The header line for one spec: what it is, how far it has got, what it
// has cost in total, and every action there is to take on it — running
// its phases included.
function specHeadRow(g: SpecGroup, opts: QueuePageOptions, now: number, folded: Set<string>): string {
  // Three answers, not two. `archived` greys the row out (css.ts), which
  // is the last thing a spec with the whole workflow still ahead of it
  // should look like.
  const rowClass = !g.lead ? "notstarted" : inFlight(g.lead) ? "active" : "archived";
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
  const pips = g.phases
    .map((p) => {
      const cls = p.attempts.some(inFlight) ? "now" : p.attempts.length ? "past" : "todo";
      return `<span class="pip ${cls}" title="${esc(p.step)}"></span>`;
    })
    .join("");
  const jobs = g.phases.reduce((n, p) => n + p.attempts.length, 0);
  // The same key the fold state is written in, so no second format for
  // "which spec" is invented.
  const refusal =
    opts.errorSpec && opts.errorSpec === groupKey(g.project, g.specFolder) ? opts.error : undefined;
  return (
    // `data-folder`, not `data-spec`: the attribute NAME would otherwise
    // end in the same "a-spec" that half the fixtures use as a folder,
    // and a test looking for a spec by name would find the markup.
    `<tr class="spechead ${rowClass}" data-folder="${esc(g.specFolder)}">` +
    `<td><div class="speccell">${foldControl(g, opts.filter ?? {}, folded)} ${spec}${diff}</div>` +
    `<div class="muted small">${esc(g.project)}</div>` +
    `<div class="small specinfo">${specSummary(g)}</div>` +
    // Why the button you just pressed did nothing — on the row you
    // pressed it on. The same `muted small` line a job's own error
    // already uses (`stateCell`), so a reason reads the same wherever
    // it comes from.
    (refusal ? `<div class="muted small refused">${esc(refusal)}</div>` : "") +
    `</td>` +
    `<td><div class="pips">${pips}</div>` +
    `<div class="muted small">${jobs} ${jobs === 1 ? "run" : "runs"}</div></td>` +
    // Written inline rather than through `stateChip`, which needs a job
    // this group does not have — and which would print the hyphenated
    // VALUE where the reader wants the words. `not-started` is the
    // filter key and the CSS suffix; "not started" is the text.
    `<td>${g.lead ? stateCell(g.lead) : `<span class="state s-not-started">not started</span>`}</td>` +
    `<td>${g.latest ? relTime(g.latest.startedAt ?? g.latest.createdAt, now) : "–"}</td>` +
    `<td class="num">${costCell(g.spentUsd, "–")}</td>` +
    // Run is about what the spec has still to do; approve/cancel is
    // about the run in flight; Merge is about the work one left behind.
    // All three live in the one action cell, and the Run control is
    // first because it is the one every row has.
    `<td>${specRunForm(g, opts)}${g.lead ? actionForm(g.lead, opts.token, opts.filter) : ""}${mergeForm(g, opts)}</td></tr>`
  );
}

// One line per phase, in the workflow's own order, whether or not it has
// happened. A phase nobody has run yet is the point of the fixed order:
// it says what is still ahead without anyone counting rows.
//
// Read-only: the phase is RUN from the header row, which is the only
// line of a folded spec left in the page. The trailing cell stays, empty
// — the table is six columns wide on every row.
function phaseSubRows(g: SpecGroup, now: number): string {
  return g.phases
    .map((p) => {
      const latest = p.attempts[0];
      const name = latest
        ? `<a href="/specs/${esc(latest.id)}">${esc(p.step)}</a>`
        : `<span class="muted">${esc(p.step)}</span>`;
      // The latest attempt, with a count when there have been more —
      // three archive runs on one spec is a real history, not a row to
      // repeat three times.
      // The plan is about an older problem than the description is: said
      // on the analyze line, because analyze is the phase that has to
      // run again. Amber, like every other "worth noticing, not
      // alarming" mark on this page — and it blocks nothing.
      const stale =
        p.step === "analyze" && g.analyzeStale
          ? ` <span class="chip stale" title="1-description.md was committed after the last finished analyze">description changed since</span>`
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
        `<td>${latest ? stateCell(latest) : `<span class="muted small">not run yet</span>`}</td>` +
        `<td>${latest ? relTime(latest.startedAt ?? latest.createdAt, now) : ""}</td>` +
        `<td class="num">${latest ? costCell(latest.spentUsd, "") : ""}</td>` +
        `<td></td></tr>`
      );
    })
    .join("");
}

// Folding OMITS the phase lines rather than hiding them: the state is in
// the URL, so the server knows before it draws. A `<details>` cannot do
// this — it breaks the table — and a checkbox's state would be destroyed
// by the innerHTML swap every five seconds.
function groupRows(groups: SpecGroup[], opts: QueuePageOptions, now: number, folded: Set<string>): string {
  return groups
    .map((g) => {
      const head = specHeadRow(g, opts, now, folded);
      return folded.has(groupKey(g.project, g.specFolder)) ? head : head + phaseSubRows(g, now);
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
  const groups = groupBySpec(rows, opts.targets);
  const matched = sortGroups(applyFilter(groups, f), f);
  const hidden = Math.max(0, matched.length - SHOWN);
  const body = matched.length
    ? groupRows(matched.slice(0, SHOWN), opts, now, foldedSet(f))
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
    `<table class="jobs">${sortableHead(f)}<tbody>${body}</tbody></table>` +
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
    `<p class="intro">aide runs on this machine: a few jobs side by side, each in ` +
    `a checkout of its own, and never two on the same spec. Every step is ` +
    `bounded by its own budget and a wall clock. A job that hits a cap is ` +
    `<em>stopped</em>, not failed.</p>\n` +
    // The fallback, and only that. A refusal that names its spec is
    // shown on that spec's own row (`specHeadRow`) — the page lists up
    // to 25 of them, so the banner said nothing about which button was
    // pressed. One that names no spec has nowhere else to go, and
    // dropping it silently is worse than a banner.
    (opts.error && !opts.errorSpec ? `<p class="refusal">${esc(opts.error)}</p>\n` : "") +
    table;
  return pageShell("Specs", entries, "/specs", body, generatedAt, 10, {
    refreshInNoscript: !!opts.script,
    script: opts.script,
  });
}
