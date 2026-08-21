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

import { esc, relTime, usdOrTokens } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { NEW_SPEC_ROUTE } from "./site.ts";
// One function, because the server routes on this path and the list
// links to it (spec 150).
import { specPagePath } from "./spec-page.ts";
import {
  badge,
  btn,
  field,
  filterPills,
  phaseChip,
  phases,
  pips,
  rowMessage,
  stepLabel,
  tokenField,
} from "./components.ts";
import {
  IN_FLIGHT,
  anyCostUnmeasured,
  branchActivity,
  currentStep,
  inFlight,
  nextActionHint,
  specNotice,
  type RestingState,
  notStartedChip,
  specStateChip,
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
  /** What this spec builds on, from its own `Depends on:` line (spec
   *  92). Named by folder, the way `aide-run-spec`'s own dependency
   *  refusal names it. Empty or absent when it names none. */
  dependsOn?: string[];
  /** Steps this spec has already had, from the runner's own commits
   *  (spec 154). Marked, never forbidden. */
  done?: string[];
  /** Steps whose latest commit STOPPED, by step, with the reason —
   *  `timeout`, `budget_exhausted`. Such a step has run and has not
   *  finished, and the row says so instead of "not run yet" even once
   *  the queue's own memory of that attempt is gone. */
  stopped?: Record<string, string>;
  /** What `4-status.md`'s own line claims. Not what anything is decided
   *  from — the history above is — but the row wears a qualifier when
   *  the two disagree, which is how a copied folder or a killed run
   *  becomes visible rather than silently wrong. */
  fileSteps?: string[];
  /** The steps the file and the history do not agree about — said on
   *  the phase line it is about, never once per phase. */
  fileDisagrees?: string[];
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
  modelChoices?: { name: string; budgetUsd: number; tool?: "claude" | "codex" }[];
  /** The configured model per step (plus a "default" key), from the
   *  config's own `model` table. It is what a phase line's select is
   *  pre-filled with when the phase has not run yet — the reader sees
   *  the real name, never the word "default" (asked for 2026-08-19). */
  defaultModels?: Record<string, string>;
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

// Exported since spec 160: `queue.ts` keeps the same list under
// `PHASE_STEPS` — it decides which steps a running job may still be
// given — and the render layer does not import that module. A test
// reads both and refuses to let them drift.
export const QUEUE_STEPS = ["analyze", "review-plan", "implement", "archive"];

// The phase LINES a spec's expanded row shows, in order. `create` is
// history, not a control (spec 116): a spec that exists cannot be
// created again, so it is never a checkbox (`phaseSubRows`), never a
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
      spentTokens: res.tokens,
      error: res.ok ? undefined : r.error,
    };
  }
  if (currentStep(r) !== step) return null;
  // What the finished steps did not account for. A job's `spentUsd` is
  // the sum over its steps, so the step in flight owns the remainder.
  const counted = (r.results ?? []).reduce((sum, x) => sum + x.costUsd, 0);
  // The same remainder in tokens — but only where there is one to take.
  // A job with no token figure has no remainder either, and subtracting
  // from nothing would invent a zero.
  const countedTokens = (r.results ?? []).reduce((sum, x) => sum + (x.tokens ?? 0), 0);
  return {
    ...r,
    spentUsd: Math.max(0, r.spentUsd - counted),
    spentTokens: r.spentTokens === undefined ? undefined : Math.max(0, r.spentTokens - countedTokens),
  };
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
  /** What this phase's own git history says beyond whether it happened
   *  (spec 154): why its last run did not finish, and whether
   *  `4-status.md` agrees that it ran at all. */
  history: { stopped?: string; fileDisagrees?: boolean };
}

interface SpecGroup {
  project: string;
  specFolder: string;
  /** Whether `specFolder` is a real folder or a create job's provisional
   *  key. The key says nothing to anyone, which is why the row keeps the
   *  title while it stands (`specSummary`, 2026-08-21) and drops it once
   *  the spec has landed and the folder name IS the title. */
  named: boolean;
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
  /** Whether any step summed into `spentUsd` was over-charged rather
   *  than measured (spec 152). Rolled up across every job the spec has
   *  had, because the cell it marks is the same roll-up. */
  costUnmeasured: boolean;
  /** The same roll-up in tokens, absent while no job under this spec has
   *  reported any (spec 118). */
  spentTokens?: number;
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
    // It came from a target, so the folder is on disk by construction.
    named: true,
    state: "not-started",
    spentUsd: 0,
    costUnmeasured: false,
    activityAt: 0,
    branches: [],
    phases: PHASE_LINES.map((step) => ({
      step,
      attempts: [],
      ...heldBackFor(step, t),
      ...historyFor(step, t),
    })),
    ...fromTarget(t),
  };
}

/** What a row reads off its own spec rather than off its jobs. Written
 *  once because both constructors need it, and a row showing another
 *  spec's done-set or progress is the one way this join can go wrong. */
function fromTarget(
  t: QueueTarget | undefined,
): Pick<SpecGroup, "done" | "title" | "phase" | "dependsOn" | "analyzeStale"> {
  return {
    done: t?.done ?? [],
    title: t?.title,
    phase: t?.phase,
    dependsOn: t?.dependsOn ?? [],
    analyzeStale: t?.analyzeStale ?? false,
  };
}

/** Archive's own file-side answer, on archive's line and nowhere else.
 *  Written once because both constructors build their phases. */
const heldBackFor = (step: string, t: QueueTarget | undefined): { heldBack?: { reason: string } } =>
  step === "archive" && t?.archiveHeldBack ? { heldBack: t.archiveHeldBack } : {};

/** The git-side answer for one phase (spec 154), for the same reason
 *  `heldBackFor` exists: both constructors build their phases, and a
 *  phase reading another phase's stop reason is the one way this join
 *  can go wrong.
 *
 *  The disagreement is asked per step, not per spec: one line of one
 *  file covers all five, but the row has a line per phase and the same
 *  sentence down all five of them is the duplication spec 143 already
 *  took off this page once. */
const historyFor = (
  step: string,
  t: QueueTarget | undefined,
): { history: { stopped?: string; fileDisagrees?: boolean } } => ({
  history: { stopped: t?.stopped?.[step], fileDisagrees: t?.fileDisagrees?.includes(step) },
});

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
    // Archived beats every other reason to keep a group visible. An
    // unreadable specs root and an in-flight create job both argue for
    // showing something anyway; a folder already in archive/ answers
    // "did this spec finish" with certainty, so none of the other
    // branches get a vote. The check used to sit on the create branch
    // alone, and a project with no other live target still slipped an
    // archived spec's row through `judgeable` — every phase reading
    // "not run yet" under a job reporting done (spec 134).
    .filter(
      ([key, all]) =>
        !archivedSet.has(key) &&
        // A create job's spec is not a known target BY CONSTRUCTION: the
        // folder is what the job is making, and until it lands there is
        // nothing on disk to match. Without this it would be filtered out
        // in exactly the projects that already have specs — so the job the
        // reader just started would render nothing at all.
        (known.has(key) || !judgeable.has(all[0]!.project) || all.some(isCreate)),
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
  // step outside them (explore, manifest) is appended rather
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
    costUnmeasured: all.some((r) => anyCostUnmeasured(r.results)),
    // Summed over the jobs that HAVE a figure, and absent when none
    // does — so a spec whose runs all predate spec 118 shows a dash
    // rather than a total of nothing.
    spentTokens: all.some((r) => r.spentTokens !== undefined)
      ? all.reduce((sum, r) => sum + (r.spentTokens ?? 0), 0)
      : undefined,
    activityAt: activityMs(recent[0]!),
    branches: branchesOf(recent),
    phases: [...PHASE_LINES, ...extra].map((step) => ({
      step,
      attempts: recent
        .map((r) => attemptFor(r, step))
        .filter((a): a is QueueRowView => a !== null),
      ...heldBackFor(step, target),
      ...historyFor(step, target),
    })),
    ...spec,
    // A create job has no target to read a title off — the spec it is
    // making is not on disk yet — so the job's own title is the row's.
    // Only as a fallback: once the spec has landed, the folder's own
    // 1-description.md is the better answer, and the one every other
    // row already uses.
    title: spec.title ?? all.find((r) => r.createTitle)?.createTitle,
    // Whether the name above the line is a real folder or a placeholder.
    // A target IS the folder on disk, so a group without one is a create
    // job whose spec has not landed and whose name is a provisional key
    // that says nothing to anyone — the one case where the title has to
    // stay on the row (see `specSummary`).
    named: !!target,
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
// five-second refresh, and fine for that: nothing here is being typed
// into.
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

function filterBar(groups: SpecGroup[], f: QueueFilter, opts: QueuePageOptions): string {
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
  if (names.length < 2) return `<div class="row">${states}${runsHelp()}${newSpecLink(opts)}</div>`;
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
  return `<div class="row">${states}${projects}${runsHelp()}${newSpecLink(opts)}</div>`;
}

function sortableHead(f: QueueFilter): string {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : DEFAULT_SORT;
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  // `labelHtml` for the one column whose heading is a consumption label
  // and not a noun: "Cost" is the wrong word above a column of token
  // counts, so it carries the same two spans its cells do (spec 118).
  // `attrs` is the fold hook (spec 155): the two columns a phone drops
  // are named on the cell rather than counted by position, because the
  // column ORDER has already changed once (see below) and an
  // `nth-child` rule would have broken silently when it did.
  const th = (key: string, label: string, cls = "", labelHtml?: string, attrs = "") => {
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
      `<th class="${cls}"${attrs}${aria}>` +
      `<a class="${linkCls}" data-nav href="${queueHref(f, { sort: key, dir: next === SORT_DEFAULT_DIR[key] ? "" : next })}">` +
      `${labelHtml ?? esc(label)}${mark}</a></th>`
    );
  };
  return (
    // "Progress", not "Step": the column stopped holding a step name the
    // moment the list became one line per spec. It holds the whole
    // workflow as pips on a header line, and how many attempts a phase
    // took on the lines beneath.
    // The blank one LAST: it heads the cell a shut row's one action
    // sits in, and a heading over a control would be a word about the
    // reader rather than the spec. (Spec 124 put it first, for a
    // button COLUMN that pushed the whole table sideways — 2026-08-19.)
    // "Spec" spans TWO columns since spec 165, which gave the row's AI
    // select a column of its own between the phase name and the model.
    // Spanning rather than a blank heading beside it: this row has
    // nothing to put in that column, and a column of its own here
    // would take its width from the spec NAME — leaving the phase
    // names, which are short, floating in a cell as wide as a folder
    // name. Spanning lets the phase names size their own column.
    `<thead><tr>${th("spec", "Spec", "", undefined, ' colspan="2"')}<th>Progress</th>${th("state", "State")}` +
    `${th("started", "Started", "", undefined, ' data-col="started"')}` +
    `${th("cost", "Cost", "num", '<span class="u-usd">Cost</span><span class="u-tok">Tokens</span>', ' data-col="cost"')}` +
    `<th></th></tr></thead>`
  );
}

// Stopping a run is the one thing this form does. It offered Approve
// beside it until spec 149, for a job parked between two steps — there
// is no stop between steps any more, so there is nothing to release and
// nothing to approve.
//
// It says "Cancel" and nothing else. It named the step it would stop
// until 2026-08-21 — "Cancel implement" — on the argument that it
// should read like the Run button beside it; but a row has only ever
// one thing to cancel, the State column beside it already says which
// step is running, and the name added a word without adding an answer.
//
// Drawn only when there IS something to cancel. It used to be in the
// markup whatever the state, greyed out, so the width of the action
// column could not change from row to row (spec 124); that column is
// gone, and a row draws exactly one control now — an inert Cancel
// beside a live Run is the "two controls" this spec removes.
//
// `actionform` is what the page's own code selects on, and
// `data-pending` is what the button says while the request is out —
// written here, beside the label it replaces, rather than as a verb
// table in the script.
function actionForm(r: QueueRowView, token: string | undefined, filter: QueueFilter | undefined): string {
  const hidden = tokenField(token) + filterFields(filter);
  return (
    `<form method="post" action="/api/queue/${esc(r.id)}/cancel" class="actionform">${hidden}` +
    // Primary, like every row's one action (spec 161): `danger` was
    // supposed to set it apart, but in dark mode `--danger` and
    // `--accent` sit close enough in hue that an outlined Cancel and a
    // filled button beside it said nothing different to the eye. And a
    // cancelled run can be started again, so it was never what `danger`
    // is for.
    btn({ label: "Cancel", pending: "cancelling…", variant: "primary" }) +
    `</form>`
  );
}

// Merging was a button here until spec 149, with a long comment about
// what it said and where it said it. It says nothing now, because it is
// not pressed: every step lands the work it produced, `implement` alone
// leaves its branch open on purpose, and `archive` is what lands that.
// `mergeForm`, `mergeReadyLabel` and `isCodeRepo` went with it —
// `isCodeRepo` existed only so the button's own sentence could say
// whether it would land the plan or the code.

// Every repo the spec pushed to, each with its own compare link and its
// own merge state. Never one link standing in for two: the two branches
// share a NAME and nothing else.
function branchList(branches: BranchView[], activity?: string): string {
  if (branches.length === 0) return "";
  // A lead-in, because bare repo names read as words that fell out of
  // something else (asked for 2026-08-19).
  return (
    `<span class="branchlist"><span class="lbl">Repos:</span>` +
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
// Spec 143: the job's own error is NOT written here any more. It is a
// sentence a runner wrote — "the specs tree is dirty: /Users/…" — and
// this cell is sized for a badge, so it went off the right edge of the
// table. The row's panel says it instead (`specNoticeRow`).
const stateCell = (r: QueueRowView, resting: RestingState = {}): string =>
  specStateChip(r, resting);
// The same two-part shape, for a PHASE — whose state is the file's
// answer (`wordPhase`), not the last job's. No badge at all means the
// phase has neither happened nor been attempted. The attempt's own
// error text is NOT repeated here since spec 143: the row's panel says
// it once for the whole row, and the phase's own detail page — which
// this line links to — carries it in Activity, where that phase
// already reports what it did.
const phaseWordCell = (
  w: PhaseWord,
  /** Marks that belong to the phase's STATE but used to be written on
   *  its name cell, beside the model picker: the stale-description
   *  badge and the attempt count. Out there they had no width of their
   *  own, so two lines of free text stretched the name column and took
   *  the whole table sideways with it (seen 2026-08-20). Here they sit
   *  under the badge, which is where every other qualifier already
   *  goes. Whether the State cell is their long-term home is still
   *  open; not stretching the table is not. */
  aside = "",
): string =>
  (w.badge ? badge(w.badge.variant, w.badge.label) : `<span class="muted small">not run yet</span>`) +
  (aside ? `<div class="muted small">${aside}</div>` : "") +
  (w.qualifier ? `<div class="muted small">${esc(w.qualifier)}</div>` : "");
// `blank` because a header with nothing spent still owes the reader a
// dash, while an empty phase line should simply be empty. That
// distinction is the whole reason this takes a parameter the shared
// formatter does not — everything else about the cell is `usdOrTokens`,
// which is where the dollar/token pair is decided for the whole site.
// `unmeasured` marks a figure that includes a stand-in: a stopped step
// is charged its whole budget because a SIGKILLed run prints no usage,
// and a total that says nothing about it reads as money spent (spec
// 152). The same "est." the job page's Steps table has shown per step
// since spec 118.
const costCell = (
  spentUsd: number,
  spentTokens: number | undefined,
  blank: string,
  unmeasured?: boolean,
): string =>
  spentUsd > 0
    ? usdOrTokens(spentUsd, spentTokens) + (unmeasured ? ' <span class="muted small">est.</span>' : "")
    : blank;

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

// What a press would run, if nothing else is ticked. It depends on how
// far the spec has got, and on nothing about which phase is asking.
//
// A spec nothing has ever run pre-ticks `analyze` AND `review-plan`
// together — that pair as one gated job is what every spec here has
// actually been started as, and the two belong together. Any other
// spec pre-ticks the first phase it has not had, which is what you
// almost always came to run.
//
// `g.lead` is the test for "nothing has ever run": it is absent only
// for a spec `emptyGroup` built, which is a spec with no job row at
// all. A spec whose only job ran `explore` has a lead, and keeps the
// ordinary single pre-tick even though its done-set is still empty.
//
// The pair is filtered against the done-set, because the two answer
// different questions. `done` is what the spec's own git history PROVES
// (spec 154): the runner commits every step it finishes, and only such
// a commit puts a step here — a `4-status.md` line naming a step is a
// claim the row reports a disagreement about, never a source. A step
// run at somebody's keyboard counts once it is committed with the same
// subject, which is what the four skills now offer to do; declined,
// the spec reads as still having that phase ahead of it. And a spec
// that has both of them done already falls back to the ordinary rule
// rather than to nothing: the pair exists to tick a spec's two
// STARTING phases, not to leave a spec that is past them with no box
// ticked at all.
//
// It used to live inside the strip of chips the controls line drew
// (`stepBoxes`, retired with that line in spec 124). The boxes are on
// the phase lines now and each asks this the same question, so the
// rule is read once per row and consulted per phase.
function preTicked(g: SpecGroup): Set<string> {
  const done = new Set(g.done);
  // ARCHIVE IS NEVER DONE ON A ROW THAT EXISTS. Archived-ness is a
  // directory (`discover.ts`): a spec the list shows is a spec still in
  // the active root, so whatever the git history says about an archive
  // step having RUN, it did not finish the one thing archiving is.
  //
  // The history is the record of steps that ran (spec 154), and an
  // archive that ran and declined to move the folder leaves a commit
  // behind exactly like one that moved it. Counted as done it left spec
  // 159 with every phase ticked, no next phase to suggest and no button
  // at all — beside a badge reading "archive held back", which was the
  // one thing on that row needing a press. The first fix read the
  // held-back note and dropped that phase; too narrow, and spec 161
  // showed why hours later — with the note cleared the row went to
  // "done — nothing waiting on you" while the spec sat unarchived in
  // the list. The note is a REASON archiving did not happen, not the
  // only evidence that it did not (2026-08-21).
  done.delete("archive");
  const next = QUEUE_STEPS.find((s) => !done.has(s));
  const pair = ["analyze", "review-plan"].filter((s) => !done.has(s));
  const single = next ? [next] : [];
  return new Set(g.lead || pair.length === 0 ? single : pair);
}

// What the row's one button SAYS, built from the same set the boxes are
// ticked from (spec 157). Two things follow from naming it after the
// ticked phases rather than after the state's own suggestion:
//
// A reader can see the two disagree before pressing. The State column
// says what the spec's files make of it — "ready for analyze" — and the
// button says what a press would actually run. Where those differ the
// row reads "ready for analyze · Implement", and the disagreement is in
// the line rather than in the result.
//
// And a press on a SHUT row is legible: its phase boxes are not drawn,
// so the button's own word is the only thing that says what it would
// do.
//
// Several ticked phases name the first and count the rest — "Analyze +
// 1", which is what a fresh spec's `analyze`+`review-plan` pair reads
// as. Naming only the first would hide half of what a press does.
// Nothing ticked names nothing: no button is drawn at all, because a
// disabled one invites a press that cannot do anything.
function actionLabel(g: SpecGroup): string | undefined {
  const ticked = [...preTicked(g)];
  if (ticked.length === 0) return undefined;
  // The FIRST ticked phase, and nothing after it. A "+ 1" suffix said
  // how many more a press would run and was taken out on 2026-08-21:
  // a button label is a name, not a summary, and the phases themselves
  // are one click away on the row the press acts on.
  const first = stepLabel(ticked[0]!);
  return `${first[0]!.toUpperCase()}${first.slice(1)}`;
}

// The run form's own id. It exists for the rarely-set fields' sake
// alone: they are written after the form's closing tag, on the same
// line, and `form="<id>"` is what makes the browser post them with it
// anyway.
const runFormId = (g: SpecGroup): string => `rowrun-${groupKey(g.project, g.specFolder)}`;

// Why the button you just pressed did nothing, and whether it was
// pressed on THIS row. The same key the fold state is written in, so
// no second format for "which spec" is invented.
//
// It is drawn in the row's panel and no longer in the name cell (spec
// 151): the sentence is a whole one — "analyze on 150-… is already
// running (job 03238f57) — cancel that one first if you want to start
// over" — and the name cell is sized for a folder name, so it pushed
// the branch marks and the title around underneath it.
const refusalFor = (g: SpecGroup, opts: QueuePageOptions): string | undefined =>
  opts.errorSpec && opts.errorSpec === groupKey(g.project, g.specFolder) ? opts.error : undefined;

// The row's own anchor. `id`, not `data-folder`: a badge pointing at
// another spec's row needs something `href="#..."` can find with no
// script at all — this page's own rule. Same shape as `runFormId`, so
// "an id that names a spec" stays the one convention it already is.
const rowAnchorId = (g: SpecGroup): string => `spec-${groupKey(g.project, g.specFolder)}`;

// The one thing nobody sets every time — the other repos the job will
// touch. Built here rather than inline in `stateAction` so the
// `form` attribute it needs is written once, beside the id it has to
// match.
//
// It used to have company. The model left for the phase lines in spec
// 123: one shared dropdown could only ever set ONE model for every
// phase a press ticked, and it landed beside the State column by
// accident of content width, tied to nothing around it. The "stop for
// approval between steps" box left altogether in spec 133: its two
// states were "run straight through" and "stop after every step", and
// a reader who wants the second ticks one phase at a time instead.
function extraFields(g: SpecGroup, opts: QueuePageOptions, busy: boolean): string {
  // A field that sets up a job, on a row where no job can be started:
  // while the spec is busy it is disabled, and it carries the same
  // sentence the phase boxes do.
  const why = busy ? busyReason(g) : "";
  const formId = runFormId(g);
  // The row's own project is watched already, so offering it again is an
  // error waiting to be submitted. The row knows which spec it is before
  // it is drawn, so this is a filter at render time — the old shared
  // form had to disable the box from script as the selection changed.
  const others = (opts.projects ?? []).filter((p) => p !== g.project);
  return others.length
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
}

// The one thing the row asks of the reader, beside the sentence that
// says why (spec 157). Run or Cancel — never both, and nothing at all
// when there is nothing to run: the two are never the right press at the
// same time, so a second one in the markup could only ever be a
// greyed-out invitation. There was a third, Resolve, until spec 171
// folded resolving into `archive`.
//
// It sits in the State column now, after the badge, because the badge
// already answers what is happening or what can happen next (spec 132)
// and the button completes that sentence: "archive held back ·
// Implement", "implementing · Cancel". It used to be a stack
// of buttons in a cell of its own — a COLUMN at the front of the table
// in spec 124, which pushed every other column sideways, then the spec
// column's own cell spanning the phase lines (2026-08-19). Both were
// answers to "where do a row's buttons go" while there were still
// several of them.
//
// The same function draws it open or shut. A collapsed row used to have
// a narrower path of its own; what the two differ in now is one branch,
// not two call sites.
//
// The Run form is a carrier and nothing else: it holds the hidden
// fields, and the button that submits it and the boxes that fill it are
// written outside its tags, reaching it by `form="…"` — the trick spec
// 123 introduced for the model select.
function stateAction(g: SpecGroup, opts: QueuePageOptions, open: boolean): string {
  const busy = specBusy(g);
  // A conflict used to draw a Resolve control of its own here, off the
  // job's stored `errorReason`. Spec 171 took it away: `archive`
  // resolves a conflict with the default branch itself, so a conflict
  // that survives to this row is one no machine could settle and there
  // is no press that would settle it either. It shows as the failure's
  // own text — which names the branch — and the row offers what every
  // other failed step's row offers, an ordinary re-run.
  //
  // What a press would run, and therefore what the button says. There
  // is none while a job is in flight: Cancel is the row's control then.
  const label = busy ? undefined : actionLabel(g);
  // The form is a CARRIER: hidden fields only, hidden by CSS, with the
  // button and the phase boxes written outside its tags and reaching
  // it by `form="…"`. So it is drawn wherever something names it — an
  // open row's boxes and model selects always do, and a shut row's
  // button does when there is one. Without it on a busy open row, the
  // page's own script would lose the thread from a press back to the
  // boxes it has to lock with it (`rowControls`, spec 151).
  const runForm =
    open || label
      ? `<form id="${esc(runFormId(g))}" method="post" action="/api/queue" class="rowrun">` +
        `${tokenField(opts.token)}${filterFields(opts.filter)}` +
        `<input type="hidden" name="project" value="${esc(g.project)}">` +
        `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
        // A SHUT row draws no phase boxes, so the phases a press would
        // run have nothing to be read off at submit time: they travel
        // as hidden fields instead. An open row must NOT have them — its
        // boxes are the reader's own, and a hidden field beside them
        // would outvote a phase just unticked.
        (open || !label
          ? ""
          : [...preTicked(g)].map((s) => `<input type="hidden" name="steps" value="${esc(s)}">`).join("")) +
        `</form>`
      : "";
  const primary = (() => {
    if (busy) return actionForm(g.lead!, opts.token, opts.filter);
    if (!label) return "";
    // Primary, like every row's one action (spec 161). It was
    // secondary until then, on the argument that a column of primary
    // buttons says nothing about which row to look at — but a row
    // draws exactly one control now, so there is no column to tell
    // apart and nothing left for the colour to say except that the
    // action is here.
    //
    // Built by hand rather than through `btn()`: it needs `form="…"`,
    // an attribute that helper's signature does not carry — the same
    // reason `modelPicker` builds its own `<select>`.
    return `<button type="submit" form="${esc(runFormId(g))}" class="btn primary" data-pending="starting…">${esc(label)}</button>`;
  })();
  // The one nobody sets every time, quiet and small-text after the
  // button (spec 117's shape). Open rows only, as it has always been:
  // a shut row is about what the spec IS, plus the one press it wants.
  return runForm + primary + (open ? `<span class="row extra">${extraFields(g, opts, busy)}</span>` : "");
}

// The one control on this page that is NOT about a spec that exists:
// every other way in is a form on a spec's own row, and a spec that has
// never been written has no row to put one on.
//
// A link, not a form and not a disclosure (spec 121): the form has a
// page of its own at `NEW_SPEC_ROUTE`, with a Create and a Cancel on
// it. The control keeps the position the panel had — above the table,
// outside `#jobrows` — and the primary-button look spec 113 gave it.
// Not offered at all when no project on this machine may have a spec
// made in it, exactly as the panel was not.
function newSpecLink(opts: QueuePageOptions): string {
  if ((opts.createProjects ?? []).length === 0) return "";
  return `<a class="btn primary" href="${NEW_SPEC_ROUTE}">New spec</a>`;
}

// One line about the spec: what it is, and how far it has got. It has to
// SAY something even when there is nothing recorded — a line that is
// blank on half the rows reads as a page that failed to load.
function specSummary(g: SpecGroup): string {
  const bits: string[] = [];
  // NOT the title, and NOT the phase (2026-08-21), and NOT the
  // percentage (spec 167). The folder name above IS the title in slug
  // form and said it twice; the phase is what the pips and the State
  // column are for. The percentage counted the checkbox rows the
  // implement step ticks, and implement is ONE step — so it read 0
  // until implement finished and 90-something after, never anything
  // between. Two specs on the same day both read "0% done", one with
  // 21 task rows behind it and one with 4. What is left is what
  // neither the pips nor the badge carries.
  //
  // ONE exception, and it is the reason `named` exists: a create job's
  // spec has no folder yet, so the name above is a provisional key that
  // says nothing to anyone. There the title is the only readable thing
  // the row has, and it stays until the spec lands.
  if (!g.named && g.title) bits.push(esc(g.title));
  // By NUMBER since 2026-08-21, not by folder. This line used to match
  // `aide-run-spec`'s dependency refusal word for word, which names the
  // whole folder; the number is what a reader recognises, it is
  // unambiguous because a number is never reused, and the folder name
  // made the line longer than the row it sits in.
  if (g.dependsOn.length) bits.push(`depends on: ${g.dependsOn.map((d) => esc(specNumber(d))).join(", ")}`);
  return bits.length ? bits.join(" · ") : `<span class="muted">no status recorded yet</span>`;
}

/** The leading number of a spec folder — `92-a-spec-can-depend` is 92.
 *  A value that does not open with one is shown whole: a dependency may
 *  be written as a bare number already, and anything else is better
 *  said in full than silently truncated. */
function specNumber(folder: string): string {
  return /^\d+(?=-|$)/.exec(folder)?.[0] ?? folder;
}

// The header line for one spec: what it is, how far it has got, what it
// has cost in total, and — beside the state that says why — the one
// thing that can be done about it (`stateAction`, spec 157). Which
// phases a press would run is said on the phase lines beneath
// (`phaseSubRows`), one box per line, and on the button's own label.
function specHeadRow(
  g: SpecGroup,
  opts: QueuePageOptions,
  now: number,
  opened: Set<string>,
): string {
  // Three answers, not two — and named `run-*` rather than
  // `active`/`archived`, which `site.ts` uses for the unrelated
  // question of whether a spec folder has been archived on disk. The
  // two used to share the words and mean different things.
  const rowClass = !g.lead ? "run-new" : inFlight(g.lead) ? "run-live" : "run-past";
  // The spec name is the way IN, and since spec 150 it opens the SPEC —
  // all four of its files as they stand — rather than whichever job
  // happened to run last. Which means EVERY spec has somewhere to point:
  // the old branch here said "a spec that has never run has no job page
  // to point at, so the name is text", and that is the sentence the spec
  // page invalidates. The phase lines below still link to jobs, because
  // a phase's page is that phase's own run.
  // The diff link sits beside it rather than replacing it — nothing a
  // reader uses today disappears.
  // `.label` so the name can be clamped to one line with an ellipsis
  // (asked for 2026-08-19): a long folder name used to wrap, and its
  // tail landed in front of the branch marks — "refusing, aide-specs,
  // aide" read as a list of three marks.
  // `<project>:<folder>` since 2026-08-21. The project used to open the
  // line under the name, beside the title; it belongs to the NAME — a
  // folder number is only unique within its project — and the line
  // under it now carries what nothing else says.
  const spec =
    `<a class="label" href="${esc(specPagePath(g.project, g.specFolder))}" ` +
    `title="${esc(g.project)}:${esc(g.specFolder)}">` +
    `<span class="muted">${esc(g.project)}:</span>${esc(g.specFolder)}</a>`;
  // The badge is about the branch AND the job that is still writing to
  // it, so the row's lead job comes down with the list.
  const diff = g.branches.length
    ? ` ${branchList(g.branches, g.lead ? branchActivity(g.lead) : undefined)}`
    : "";
  // One pip per phase: green for a phase that has run, blue for the one
  // running now, grey for a phase still ahead. The whole workflow in six
  // millimetres, on the line you are already reading.
  // `create` had no pip from spec 116 until spec 167: the glance was
  // about the four phases a reader can still RUN. The hole made create
  // read as a different kind of thing rather than as the phase already
  // behind you — the same reason the phase line got a box of its own on
  // 2026-08-21 — so it is a pip like the other four now.
  //
  // It cannot go through `wordPhase` with them, though. `g.done` comes
  // from the git history, which counts only the runner's own
  // `Run /aide-<step> for <folder>` commits, and a spec written by hand
  // has no create commit — every one of those would show a grey pip
  // saying the spec had not been made yet. Create gets the BOX's rule
  // instead, and it has only two states: a spec that exists was
  // created, so the pip is past unless a create job is running right
  // now, in which case it is the running one.
  const createRunning = g.phases
    .find((p) => p.step === "create")
    ?.attempts.some(inFlight);
  const progress = pips(
    g.phases.map((p) => ({
      // One rule, one function: what the FILES say, qualified by the
      // most relevant attempt (whatever is in flight, else the latest).
      // The pips used to read the job history alone, so a spec analysed
      // by hand showed four grey pips and a cancelled re-run turned a
      // finished phase grey again.
      kind:
        p.step === "create"
          ? createRunning
            ? "now"
            : "past"
          : wordPhase(
              g.done.includes(p.step),
              p.heldBack,
              p.attempts.find(inFlight) ?? p.attempts[0],
              p.history,
            ).pip,
      title: stepLabel(p.step),
    })),
  );
  // The earliest phase the spec's own files say has not happened — the
  // same one `preTicked` ticks a box for, asked once more for the
  // sentence. Worded for a reader here, so `review-plan` reaches it as
  // "review".
  const nextStep = QUEUE_STEPS.find((s) => !g.done.includes(s));
  const readyPhase = nextStep ? stepLabel(nextStep) : undefined;
  // The other thing the State column is built from: the archive that
  // declined to move.
  const heldBack = g.phases.find((p) => p.step === "archive")?.heldBack?.reason;
  return (
    // `data-folder`, not `data-spec`: the attribute NAME would otherwise
    // end in the same "a-spec" that half the fixtures use as a folder,
    // and a test looking for a spec by name would find the markup.
    `<tr class="spechead ${rowClass}" id="${esc(rowAnchorId(g))}" data-folder="${esc(g.specFolder)}">` +
    // Two columns wide, like its heading: the second is the AI
    // column the phase lines below open up (spec 165), and this row
    // has nothing to say in it.
    `<td colspan="2"><div class="spec-name">${foldControl(g, opts.filter ?? {}, opened)} ${spec}</div>` +
    `<div class="spec-title">${specSummary(g)}</div>` +
    // The repo marks on a line of their own: beside the name they took
    // the width the name needed, and clamping it to "124-…" told the
    // reader nothing (2026-08-19).
    diff +
    `</td>` +
    // The pips alone: a "N runs" count under them said less than they
    // do (it counted phase-runs, not jobs, and the phase lines already
    // say "N attempts" on a re-run). Removed 2026-08-19.
    `<td>${progress}</td>` +
    // The badge says what is happening, or — once nothing is — the
    // resting state and what can happen next (spec 132). The line
    // beneath it is for the states whose badge cannot carry the whole
    // answer. The pips, the badge and the branch marks each answer a
    // narrower question, and a reader had to assemble this from all of
    // them.
    //
    // The row's one button stands beside the badge since spec 157,
    // completing the sentence it starts: "archive held back ·
    // Implement". They share the page's own `row` container, so the
    // gap between them is declared once and the button drops to a line
    // of its own when the column runs out of width, rather than
    // widening the table (`.tablewrap` would scroll instead).
    `<td><span class="row">${
      g.lead
        ? stateCell(g.lead, {
            archiveHeldBack: heldBack,
            readyPhase,
          })
        : notStartedChip()
    }<span class="actionslot">${stateAction(
      g,
      opts,
      opened.has(groupKey(g.project, g.specFolder)),
    )}</span></span>` +
    `<div class="muted small">${esc(
      nextActionHint(g.lead),
    )}</div></td>` +
    `<td data-col="started">${g.latest ? relTime(g.latest.startedAt ?? g.latest.createdAt, now) : "–"}</td>` +
    `<td class="num" data-col="cost">${costCell(g.spentUsd, g.spentTokens, "–", g.costUnmeasured)}</td>` +
    // The spare cell, blank on every row since spec 157: the one
    // action a shut row used to offer here is beside the state now,
    // where the words explaining it already are. Kept rather than
    // removed, because the header declares six columns and a row short
    // of one shifts every column after it.
    `<td></td></tr>`
  );
}

// The picker a phase line carries, and the caption above the list that
// says what the two things on that line are. One `<select>` per phase
// since spec 123: the model is a choice about the PHASE, and a single
// dropdown for the row could only ever set one model for every phase a
// press ticked.
//
// Written outside the Run form's own tags, like the other fields on an
// open row — the `form` attribute is what carries it back, and an id
// that drifts from the form's own silently runs the job on the
// defaults instead.
//
// The figure each model is granted is in the option's TOOLTIP, not its
// label — read out on every option, it was three lines of money on a
// page about work.
//
// The select is PRE-FILLED, never a "default" entry (asked for
// 2026-08-19: "vi trenger jo bare å fylle inn den som er brukt"): a
// phase that has run shows the model it last ran on, one that has not
// shows what the configuration would give it. What is posted is always
// a real name — the queue skips names for steps a job does not run.
function modelPicker(
  g: SpecGroup,
  opts: QueuePageOptions,
  step: string,
  busy: boolean,
  used?: string,
): string {
  const models = opts.modelChoices ?? [];
  if (!models.length) return "";
  const why = busy ? busyReason(g) : "";
  const configured = opts.defaultModels?.[step] ?? opts.defaultModels?.["default"];
  const has = (name?: string) => name !== undefined && models.some((m) => m.name === name);
  // The last resort is the first entry `modelChoices` LISTS, in
  // configuration order. It was the first entry of the row's own AI
  // until spec 169 — spec 141 scoped it to a literal `"claude"` and
  // spec 164 to the tool the row's lead job ran on — but both were
  // there to keep this select agreeing with a row-wide AI picker, and
  // there is no row-wide AI any more. The two branches above it are
  // untouched: a phase that HAS run still shows what it ran on, and an
  // admin's configured default still outranks any of it.
  const chosen = has(used) ? used : has(configured) ? configured : models[0]!.name;
  return (
    `<select name="model.${esc(step)}" form="${esc(runFormId(g))}"` +
    // Whether this select is showing HISTORY or a suggestion, said to
    // the browser (spec 169). "Set all" writes the phases still ahead
    // and leaves a phase that has run at the model it really ran on;
    // this is derived from the same `used` the pre-filled value is, so
    // the two cannot disagree about where the tail starts.
    (used !== undefined ? ` data-ran="1"` : "") +
    (busy ? ` disabled title="${esc(why)}"` : "") +
    `>` +
    modelOptions(models, chosen) +
    `</select>`
  );
}

/** Every configured model, grouped by the CLI it starts (spec 169).
 *
 *  The grouping is what carries the tool while the list is open, and
 *  the model's own name — `queue-config.json`'s own key — while it is
 *  closed. Nothing per-option says it any more: the `(codex)` suffix
 *  went in spec 167, and `data-tool` went with the row-wide AI filter
 *  that was the only thing reading it.
 *
 *  Nothing is HIDDEN here either, which is the whole point. Every
 *  phase's select offers every model, so a row can be run analyze on
 *  one CLI and implement on another — which the runner has always
 *  allowed and the filter is what stopped anyone discovering.
 *
 *  `TOOL_NAMES`'s own key order, not the configuration's: which group
 *  comes first is a fact about the page, not about whichever tool an
 *  admin happened to list first. A tool with nothing configured draws
 *  no group at all. */
function modelOptions(models: NonNullable<QueuePageOptions["modelChoices"]>, chosen?: string): string {
  return Object.keys(TOOL_NAMES)
    .map((tool) => {
      const group = models.filter((m) => (m.tool ?? "claude") === tool);
      if (!group.length) return "";
      return (
        `<optgroup label="${esc(TOOL_NAMES[tool]!)}">` +
        group
          .map(
            (m) =>
              `<option value="${esc(m.name)}" title="$${m.budgetUsd} per step"` +
              `${m.name === chosen ? " selected" : ""}>${esc(m.name)}</option>`,
          )
          .join("") +
        `</optgroup>`
      );
    })
    .join("");
}

// What the phase columns under this line are. Three of them mattered
// enough to name, and the three were flex children of ONE cell until
// spec 165 — pinned to fixed widths so every select started at the same
// x, which is bookkeeping a real table column does for free. They are
// real columns now: the phase's name, the row's set-all control, and
// the model with the phase's box beside it.
//
// The caption's cells, WITHOUT the row tag: `phaseSubRows` opens each
// sub-row itself, so the caption can lead whichever row comes first.
//
// The set-all column is the one it leaves EMPTY. That control is one
// for the whole group and hangs in a spanning cell that starts on the
// first phase line, so it sits at the height of the phases rather than
// up on a heading — and this line still writes the cell, because a row
// short of one shifts every column after it.
//
// The model column's word says "AI - Model" when two tools are
// configured (spec 169): the select under it holds both now, grouped
// by the CLI each model starts, so the column is about the tool as
// much as about the model. With one tool there is nothing for "AI" to
// tell apart, and it stays the one word — the same restraint the
// removed AI picker drew itself under.
function phaseCaptionCells(opts: QueuePageOptions): string {
  const tools = new Set((opts.modelChoices ?? []).map((m) => m.tool ?? "claude"));
  return (
    `<td class="phasecell"><span class="muted small">Phase</span></td>` +
    `<td class="toolcell"></td>` +
    `<td class="modelcell"><span class="row">` +
    `<span class="muted small">${tools.size > 1 ? "AI - Model" : "Model"}</span>` +
    `<span class="muted small">Select</span>` +
    `</span></td><td></td><td data-col="started"></td>` +
    `<td class="num" data-col="cost"></td><td></td>`
  );
}

/** What each CLI is called on the page. The config's own word is the
 *  short one the runner uses; this is the one a reader picks by. */
const TOOL_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

// One action instead of five (spec 169): a control that SETS every
// phase select on the row, in the browser, on change.
//
// Its slot was the row's AI select's (spec 127), which posted nothing
// and chose nothing — all it did was HIDE the other tool's models from
// the five selects, and that is exactly what stopped anyone
// discovering that a row can run analyze on one CLI and implement on
// another. The convenience it was standing in for was real; this is
// that convenience done the way round that takes nothing away.
//
// It POSTS NOTHING either — no `name`, so the request is still the
// same five `model.<step>` fields it always was. The `form` attribute
// is how it finds the selects it writes: they are written outside the
// form's own tags and tied to it by that id alone.
//
// Drawn only when there are two MODELS to choose between, not two
// tools: two Claude entries and no Codex one is still a row worth
// setting in one action, and one entry is nothing to set.
//
// The first option is a PLACEHOLDER, and the control goes back to it
// after every write. It is an action, not a statement about the row:
// left resting on the last model picked it would claim the row is on
// that model, which is the claim the removed AI select made and could
// not keep.
//
// The `<noscript>` rule beside it is this page's no-JS floor. Every
// other control here works without a script; this one cannot — writing
// five selects IS the script — so with scripting off it must simply
// not be there. It carries no resting value of its own to be
// informative about, so a control that looks pressable and silently
// does nothing would be worse than the AI select's inert degradation
// ever was. The five phase selects underneath are untouched by any of
// this and stay exactly as usable with a script as without one.
function setAllControl(g: SpecGroup, opts: QueuePageOptions, busy: boolean): string {
  const models = opts.modelChoices ?? [];
  if (models.length < 2) return "";
  const why = busy ? busyReason(g) : "";
  return (
    `<select data-set-all form="${esc(runFormId(g))}"` +
    (busy ? ` disabled title="${esc(why)}"` : "") +
    `>` +
    `<option value="" selected disabled hidden>Set all…</option>` +
    modelOptions(models) +
    `</select>` +
    `<noscript><style>[data-set-all]{display:none}</style></noscript>`
  );
}

// One line per phase, in the workflow's own order, whether or not it has
// happened. A phase nobody has run yet is the point of the fixed order:
// it says what is still ahead without anyone counting rows.
//
// The line is where a phase is TICKED since spec 124 — the box the
// header's strip of chips used to carry, on the phase's own line,
// beside the picker for the next run of it. What it does NOT carry is
// a Run button: one press runs whatever is ticked, from the row's one
// action beside the state.
//
// The box is built without `done`: the phase's own State column, the
// next cell along, already says "done", and a checkmark here said it a
// second time, in a second alphabet. It stays tickable — rerunning a
// finished phase is the same submission it always was.
//
// The leading cell is the phase's NAME, hard left and alone (spec
// 165). It was the action column's, reserved and never filled, until
// spec 157 moved the row's one button beside the state.
function phaseSubRows(g: SpecGroup, opts: QueuePageOptions, now: number): string {
  const busy = specBusy(g);
  // Row-level, all three: which phases a press would run and why the
  // row will not take a click. Row-level facts, so they are asked once
  // and consulted per phase — the same shape `busy` itself already had.
  // Which step is being worked was a fourth until spec 168, read by
  // nothing but the spinner that used to sit on that phase's box.
  const ticked = preTicked(g);
  const why = busy ? busyReason(g) : "";
  // Spec 160: the phases this run can still be given or relieved of.
  // The server worked it out from the job as it stands — the row does
  // not re-derive it, so a live box and the route that takes its tick
  // can never disagree about where the tail starts. Empty for every
  // job that is not running, which is what keeps the brief `queued`
  // window between two steps looking exactly as it does today.
  const editable = new Set(g.lead?.editableSteps ?? []);
  // Every sub-row's tag and its cells, kept apart because the tag
  // carries the step and the cells carry the line. There is no cell
  // spanning them any more: the row's one action moved beside the
  // state (spec 157), and the phase lines took the left edge it left
  // — which is where "left of the phases" always meant.
  const lines: { tag: string; cells: string }[] = [];
  if ((opts.modelChoices ?? []).length) {
    lines.push({
      tag: `<tr class="subrow" data-caption="1">`,
      cells: phaseCaptionCells(opts),
    });
  }
  g.phases
    .forEach((p, index) => {
      const latest = p.attempts[0];
      const word = wordPhase(g.done.includes(p.step), p.heldBack, latest, p.history);
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
        p.attempts.length > 1 ? `<span class="muted small">${p.attempts.length} attempts</span>` : "";
      // Live although the row is busy (spec 160): a phase this run has
      // not reached, which the reader may add to it or drop from it as
      // the run goes.
      const live = editable.has(p.step);
      // What the last run used is not spelled out in text any more —
      // it IS the picker's pre-filled value, in the column the caption
      // calls "Model".
      // `create` gets a box that is ticked and cannot be untucked: the
      // folder being on disk IS its answer, and a spec that exists
      // cannot be created again. It had no box at all until
      // 2026-08-21, and the hole where the other four have one made
      // the line read as a different KIND of thing rather than as the
      // one phase already behind you. It carries no `name`, so no
      // press can ever post `steps=create` — a disabled input is not
      // submitted either, and this is the belt as well as the braces.
      const box = QUEUE_STEPS.includes(p.step)
        ? phaseChip({
            // `data-phase`, not `data-step`: the line already carries
            // `data-step`, and one attribute per question keeps a test
            // that enumerates boxes from finding the lines too.
            dataAttr: "data-phase",
            value: p.step,
            // No visible label — the phase's own name leads the line
            // and the caption calls this column "Select". The
            // accessible one is given outright, since a wrapper with
            // no text has no name to offer.
            label: "",
            ariaLabel: stepLabel(p.step),
            // An editable box is never posted with the Run form: while
            // a job runs, that form asks for a SECOND job and the
            // queue refuses it as a clash. It still NAMES the form,
            // because that is how a press finds every control on the
            // row to lock — and a field with no name is submitted by
            // nobody, whatever it names.
            name: live ? "" : "steps",
            form: runFormId(g),
            postTo: live ? `/api/queue/${esc(g.lead!.id)}/steps` : undefined,
            // While busy this says what the RUNNING job will do with
            // the step, not what a fresh press would pre-tick
            // (`ticked`) — a step queued behind the running one is
            // still one this job named, and still reads as ticked.
            checked: busy ? !!g.lead?.steps.includes(p.step) : ticked.has(p.step),
            // The step being run had a carve-out here until spec 168,
            // because its box was drawn as a spinner instead. It falls
            // under the ordinary rule now and lands in the same place:
            // a running step is never `live` — `live` names a step the
            // run has NOT reached — so `busy && !live` disables it
            // exactly as the carve-out did.
            disabled: busy && !live,
            // Inert, but not padlocked: the tick already says whether
            // this job will get to the step (spec 145).
            plain: true,
            // A box the reader can still act on says what the tick
            // WOULD do; the rest say why the row will not take a
            // click.
            title: live
              ? `not started yet — ${g.lead?.steps.includes(p.step) ? "untick to drop it from this run" : "tick to add it to this run"}`
              : busy
                ? why
                : undefined,
          })
        : phaseChip({
            dataAttr: "data-phase",
            value: p.step,
            label: "",
            ariaLabel: `${stepLabel(p.step)} — already done, and not a step you can run`,
            // No name: nothing to post, whatever a browser decides to
            // do with a disabled field.
            name: "",
            checked: true,
            disabled: true,
            // Inert, not padlocked — the same reason spec 145 gives for
            // a phase queued behind the running one: the tick says what
            // there is to say.
            plain: true,
          });
      // The row's set-all control, in a column of its own between the
      // name and the model, drawn ONCE and spanning every phase line
      // (spec 165, spec 169).
      // `g.phases.length`, never a literal five: a spec whose past
      // jobs touched a step outside the usual set has that step
      // appended as a line of its own (`jobGroup`), and a span short
      // of the rows beneath it leaves a hole in the column.
      // The cell is written whether the control draws anything or not
      // — one configured model is nothing to set, and a column that
      // came and went would move every column after it.
      const toolCell =
        index === 0
          ? `<td class="toolcell" rowspan="${g.phases.length}">${setAllControl(g, opts, busy)}</td>`
          : "";
      lines.push({
        tag: `<tr class="subrow" data-step="${esc(p.step)}">`,
        cells:
          // The name alone, hard left: it is what the eye lands on
          // first, and it started 2.5rem in behind the box until spec
          // 165 moved the box to the model's column.
          `<td class="phasecell">${name}</td>` +
          toolCell +
          // The Progress column is the head row's pips, and a phase
          // line had nothing to say there — a hand's width of nothing
          // between the model select and the state word. The model
          // select and the phase's box live in it now, so the line has
          // real content all the way across.
          `<td class="modelcell"><span class="row">` +
          `${modelPicker(g, opts, p.step, busy, latest?.model)}${box}</span></td>` +
          `<td>${phaseWordCell(word, `${stale}${tries}`)}</td>` +
          `<td data-col="started">${latest ? relTime(latest.startedAt ?? latest.createdAt, now) : ""}</td>` +
          `<td class="num" data-col="cost">${latest ? costCell(latest.spentUsd, latest.spentTokens, "", anyCostUnmeasured(latest.results)) : ""}</td>` +
          `<td></td>`,
      });
    });
  return lines.map((l) => `${l.tag}${l.cells}</tr>`).join("");
}

/** How many columns the list has. Two rows span the whole table — the
 *  "no spec matches" line and a row's message panel — and a count
 *  written twice is a count that drifts the next time a column moves. */
const LIST_COLUMNS = 7;

// The panel a row's long messages go into (spec 143): a row of its own,
// spanning the table, wrapping rather than overflowing. Everything the
// State column used to hold and could not — the runner's refusal, the
// spec's own reason for an archive that declined — is said here, once
// for the whole row, in the message component the page already has.
//
// Nothing to say draws nothing at all: an empty `.rowmsg` is invisible,
// but an empty `<tr>` is still a row of padding.
function specNoticeRow(g: SpecGroup, refusal: string | undefined): string {
  const notice = specNotice(
    g.lead,
    g.phases.find((p) => p.step === "archive")?.heldBack?.reason,
    refusal,
  );
  if (!notice) return "";
  return (
    `<tr class="specnotice" data-folder="${esc(g.specFolder)}">` +
    `<td colspan="${LIST_COLUMNS}">${rowMessage(notice.variant, notice.text, { hook: notice.hook })}</td></tr>`
  );
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
): string {
  return groups
    .map((g) => {
      // The panel belongs to the row, not to the phase lines: a
      // collapsed row is told what went wrong without being opened.
      const head = specHeadRow(g, opts, now, opened) + specNoticeRow(g, refusalFor(g, opts));
      return opened.has(groupKey(g.project, g.specFolder))
        ? head + phaseSubRows(g, opts, now)
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
      groupRows(matched.slice(0, SHOWN), opts, now, openedSet(f))
    : `<tr><td colspan="${LIST_COLUMNS}" class="empty muted">` +
      // Two different emptinesses. "Nothing matches what you asked for"
      // is answered by changing the filter; "there is no spec here at
      // all" is not, and telling that reader to pick one above is
      // pointing at an empty dropdown.
      (groups.length
        ? "No spec matches this filter."
        : "No spec to show — no project on this machine has one to run.") +
      `</td></tr>`;
  return (
    filterBar(groups, f, opts) +
    `<div class="tablewrap"><table class="list">${sortableHead(f)}<tbody>${body}</tbody></table></div>` +
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
    // shown in that spec's own panel (`specNoticeRow`) — the page lists up
    // to 25 of them, so the banner said nothing about which button was
    // pressed. One that names no spec has nowhere else to go, and
    // dropping it silently is worse than a banner.
    (opts.error && !opts.errorSpec
      ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) + "\n"
      : "") +
    // The New spec link rides on the filter row now (right-hand end,
    // after the (?)): it is a plain link since spec 121, so the
    // five-second swap of `#jobrows` holds no half-typed state to lose.
    table;
  // The front page IS the board: the tab says only that — and the
  // heading said it a second time right under the Specs tab, so it is
  // gone (2026-08-19). The title still names the page for the shell.
  return pageShell("Specs", entries, "/", body, generatedAt, 10, {
    docTitle: "aide -board",
    hideHeading: true,
    refreshInNoscript: !!opts.script,
    script: opts.script,
  });
}
