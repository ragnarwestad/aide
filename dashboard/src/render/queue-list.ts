// /specs: the form that starts a run, and the one list of every spec
// this machine has run — cut and ordered on demand, one line per spec
// with its workflow phases beneath it, each phase runnable from where
// it sits.
//
// The page carries browser code (compiled from queue-client.ts) so the
// list can refresh without reloading a form someone is half-way through
// filling in. Everything the code does also works without it: the
// filters and the sort are ordinary links.

import { esc, relTime } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { stateChip, unmergedBadge, type QueueRowView } from "./job-state.ts";

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
}

// --- the form ---------------------------------------------------------------

const QUEUE_STEPS = ["analyze", "review-plan", "implement", "archive"];

// Every form on this page posts to the guarded surface, so every one of
// them carries the token when the page has one. Written once: a form
// that forgot it would be refused with a 401 the reader cannot act on.
const tokenField = (token?: string): string =>
  token ? `<input type="hidden" name="token" value="${esc(token)}">` : "";

// A step the spec has already had is marked done and left unticked;
// the first one it has NOT had is ticked, because that is what you
// almost always came to run. Nothing is disabled: re-analyzing after
// the code moved on is a legitimate thing to want.
export function stepBoxes(target: QueueTarget | undefined): string {
  const done = new Set(target?.done ?? []);
  const next = QUEUE_STEPS.find((s) => !done.has(s));
  return QUEUE_STEPS.map((s) => {
    const isDone = done.has(s);
    return (
      `<label class="stepbox${isDone ? " isdone" : ""}" data-step="${esc(s)}">` +
      `<input type="checkbox" name="steps" value="${esc(s)}"${s === next ? " checked" : ""}> ` +
      `${esc(s)}${isDone ? ' <span class="tick" title="already done">✓</span>' : ""}</label>`
    );
  }).join("");
}

// One line about the chosen spec: what it is, and how far it has got.
export function specSummary(t: QueueTarget): string {
  const bits: string[] = [];
  if (t.title) bits.push(esc(t.title));
  if (t.phase) bits.push(`<span class="chip">${esc(t.phase)}</span>`);
  if (typeof t.percent === "number") bits.push(`${t.percent}% done`);
  return bits.length ? bits.join(" · ") : `<span class="muted">no status recorded yet</span>`;
}

function enqueueForm(opts: QueuePageOptions): string {
  if (opts.targets.length === 0) {
    return `<p class="muted">No project on this machine has both a manifest and permission to run.</p>`;
  }
  const hidden = tokenField(opts.token);
  const options = opts.targets
    .map((t) => {
      const value = `${t.project}/${t.specFolder}`;
      const done = t.percent === 100 ? " ✓" : typeof t.percent === "number" ? ` — ${t.percent}%` : "";
      return `<option value="${esc(value)}">${esc(t.specFolder)}${done}</option>`;
    })
    .join("");
  const boxes = stepBoxes(opts.targets[0]);
  // The heavy model is worth reserving for heavy work, so the choice is
  // explicit and the default is "whatever the config says per step".
  // Each option carries what it is granted per step, because that is
  // the number that decides whether the job can finish.
  // The default carries its figure too. Without one it was the only
  // option on the list without a number, which read as the cheap or the
  // unknown choice — while it was in fact the most generous: picking
  // `opus` granted $15 for the same model the default ran at $35.
  const models = opts.modelChoices ?? [];
  const asConfigured =
    typeof opts.defaultBudgetUsd === "number"
      ? `as configured per step — $${opts.defaultBudgetUsd} per step`
      : "as configured per step";
  const modelField = models.length
    ? `<label class="field"><span class="fieldlabel">Model</span>` +
      `<select name="model" id="model">` +
      `<option value="">${esc(asConfigured)}</option>` +
      models
        .map((m) => `<option value="${esc(m.name)}">${esc(m.name)} — $${m.budgetUsd} per step</option>`)
        .join("") +
      `</select></label>`
    : "";
  // The gate choice is SHOWN and off by default. Hiding it made the
  // button quietly create a job that stops for approval after every
  // step — the opposite of what pressing it looks like it does.
  // The selection has to SHOW something. A dropdown that changes
  // nothing visible reads as broken, however correct it is.
  const first = opts.targets[0];
  const refusal = opts.error ? `<p class="refusal">${esc(opts.error)}</p>` : "";
  // Only worth asking when there is more than one repo to choose from.
  // The box for the spec's own project is disabled from script as the
  // selection changes — it is already watched.
  const others = opts.projects ?? [];
  const extraField =
    others.length > 1
      ? `<span class="field"><span class="fieldlabel">Also touches</span>` +
        `<span class="steps" id="extraprojects">` +
        others
          .map(
            (p) =>
              `<label class="stepbox" data-project="${esc(p)}">` +
              `<input type="checkbox" name="extraProjects" value="${esc(p)}"> ${esc(p)}</label>`,
          )
          .join("") +
        `</span></span>`
      : "";
  return (
    `<section class="panel">` +
    `<h2>Run a spec</h2>\n` +
    refusal +
    `<form method="post" action="/api/queue" class="enqueue">${hidden}` +
    `<label class="field"><span class="fieldlabel">Spec</span>` +
    `<select name="target" id="target">${options}</select></label>` +
    `<span class="field"><span class="fieldlabel">Steps, in order</span>` +
    `<span class="steps" id="steps">${boxes}</span></span>` +
    modelField +
    extraField +
    `<label class="stepbox gate"><input type="checkbox" name="gate"> ` +
    `stop for approval between steps</label>` +
    `<button type="submit">Run it</button></form>` +
    `<p class="specinfo" id="specinfo">${first ? specSummary(first) : ""}</p>` +
    // Without the descriptions: this blob only feeds the one-line spec
    // summary, and every spec's full prose would be several pages of
    // markup nobody on this page reads.
    `<script type="application/json" id="targetdata">${JSON.stringify(
      opts.targets.map(({ description: _drop, ...t }) => t),
    ).replace(/</g, "\\u003c")}</script>` +
    `</section>`
  );
}

// --- the list ---------------------------------------------------------------

const SHOWN = 25;

// The four questions actually asked of this list. "Problems" holds
// everything that did not simply finish — a cap-stop and a crash are
// different, but both are things you go looking for on purpose.
const STATE_FILTERS: { key: string; label: string; states?: string[] }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active", states: ["queued", "running", "awaiting-approval"] },
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

/** Which states mean "still going". Read off the "Active" filter rather
 *  than written out a second time: a state added to one and forgotten in
 *  the other is exactly the drift this page cannot afford. */
const IN_FLIGHT = STATE_FILTERS.find((f) => f.key === "active")!.states!;

const inFlight = (r: QueueRowView): boolean => IN_FLIGHT.includes(r.state);

/** The step a job is on, or — once it has stopped — the last one it
 *  reached. The same expression the flat list used per row. */
function currentStep(r: QueueRowView): string {
  return r.steps[r.stepIndex] ?? r.steps[r.steps.length - 1] ?? "–";
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
   *  that the most recently active one. */
  lead: QueueRowView;
  /** The most recently active job, in flight or not. The "Started"
   *  column shows ITS time, so the column and the sort answer the same
   *  question: when did anything last happen to this spec? */
  latest: QueueRowView;
  state: QueueRowView["state"];
  spentUsd: number;
  activityAt: number;
  branchOf?: QueueRowView;
  phases: Phase[];
}

function groupBySpec(rows: QueueRowView[]): SpecGroup[] {
  const byKey = new Map<string, QueueRowView[]>();
  for (const r of rows) {
    const key = `${r.project}/${r.specFolder}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }
  return [...byKey.values()].map((all) => {
    const recent = [...all].sort((a, b) => activityMs(b) - activityMs(a));
    const lead = recent.find(inFlight) ?? recent[0]!;
    // The four the form offers, always, in order — a phase nobody has
    // run yet still holds its place, which is what makes progress
    // readable at a glance. A step outside them (explore, create,
    // manifest) is appended rather than dropped: a job that ran is
    // never invisible.
    const extra = [...new Set(all.map(currentStep))].filter((s) => !QUEUE_STEPS.includes(s));
    return {
      project: lead.project,
      specFolder: lead.specFolder,
      lead,
      latest: recent[0]!,
      state: lead.state,
      spentUsd: all.reduce((sum, r) => sum + r.spentUsd, 0),
      activityAt: activityMs(recent[0]!),
      branchOf: recent.find((r) => r.branchUrl),
      phases: [...QUEUE_STEPS, ...extra].map((step) => ({
        step,
        attempts: recent.filter((r) => currentStep(r) === step),
      })),
    };
  });
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
    return (typeof x === "string" ? String(x).localeCompare(String(y)) : (x as number) - (y as number)) * sign;
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

function actionForm(r: QueueRowView, token?: string): string {
  const action =
    r.state === "awaiting-approval" ? "approve" : r.state === "queued" || r.state === "running" ? "cancel" : null;
  if (!action) return "–";
  const hidden = tokenField(token);
  return (
    `<form method="post" action="/api/queue/${esc(r.id)}/${action}">${hidden}` +
    `<button type="submit">${action === "approve" ? "Approve" : "Cancel"}</button></form>`
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

// The header line for one spec: what it is, how far it has got, what it
// has cost in total, and the one action there is to take on it.
function specHeadRow(g: SpecGroup, opts: QueuePageOptions, now: number): string {
  const done = !inFlight(g.lead);
  // The spec name is the way IN: the job it points at is whatever is
  // running, or the last thing that happened. The diff link sits beside
  // it rather than replacing it — nothing a reader uses today disappears.
  const spec = `<a href="/specs/${esc(g.lead.id)}">${esc(g.specFolder)}</a>`;
  const branch = g.branchOf;
  const diff = branch
    ? ` <a class="small" href="${esc(branch.branchUrl!)}">diff</a>${unmergedBadge(branch)}`
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
  return (
    // `data-folder`, not `data-spec`: the attribute NAME would otherwise
    // end in the same "a-spec" that half the fixtures use as a folder,
    // and a test looking for a spec by name would find the markup.
    `<tr class="spechead ${done ? "archived" : "active"}" data-folder="${esc(g.specFolder)}">` +
    `<td><div class="speccell">${spec}${diff}</div><div class="muted small">${esc(g.project)}</div></td>` +
    `<td><div class="pips">${pips}</div>` +
    `<div class="muted small">${jobs} ${jobs === 1 ? "run" : "runs"}</div></td>` +
    `<td>${stateCell(g.lead)}</td>` +
    `<td>${relTime(g.latest.startedAt ?? g.latest.createdAt, now)}</td>` +
    `<td class="num">${costCell(g.spentUsd, "–")}</td>` +
    `<td>${actionForm(g.lead, opts.token)}</td></tr>`
  );
}

// One line per phase, in the workflow's own order, whether or not it has
// happened. A phase nobody has run yet is the point of the fixed order:
// it says what is still ahead without anyone counting rows.
function phaseSubRows(g: SpecGroup, opts: QueuePageOptions, now: number): string {
  return g.phases
    .map((p) => {
      const latest = p.attempts[0];
      const name = latest
        ? `<a href="/specs/${esc(latest.id)}">${esc(p.step)}</a>`
        : `<span class="muted">${esc(p.step)}</span>`;
      // The latest attempt, with a count when there have been more —
      // three archive runs on one spec is a real history, not a row to
      // repeat three times.
      const tries =
        p.attempts.length > 1
          ? `<div class="muted small">${p.attempts.length} attempts</div>`
          : latest?.model
            ? `<div class="muted small">${esc(latest.model)}</div>`
            : "";
      return (
        `<tr class="subrow${latest ? "" : " untried"}" data-step="${esc(p.step)}">` +
        `<td class="phasecell">${name}</td>` +
        `<td>${tries}</td>` +
        `<td>${latest ? stateCell(latest) : `<span class="muted small">not run yet</span>`}</td>` +
        `<td>${latest ? relTime(latest.startedAt ?? latest.createdAt, now) : ""}</td>` +
        `<td class="num">${latest ? costCell(latest.spentUsd, "") : ""}</td>` +
        `<td>${runForm(g, p, opts)}</td></tr>`
      );
    })
    .join("");
}

// The line where you can SEE that review-plan has not run is the line
// where you run it. One step, one job, posted to the endpoint the form
// at the top already posts to — nothing new on the server.
//
// Model only. A gate cannot mean anything for a single-step job (the
// runner only parks BETWEEN steps), and a run needing extra projects or
// a tightened cap is a deliberate job, which is what the form is for.
function runForm(g: SpecGroup, p: Phase, opts: QueuePageOptions): string {
  // The backend refuses a step that is already queued or running; the
  // button says so BEFORE the press rather than answering with a
  // refusal. The 5-second refresh redraws these rows, so a phase that
  // finishes gets its button back without anything else happening.
  const busy = p.attempts.some(inFlight);
  const off = busy ? " disabled" : "";
  const hidden = tokenField(opts.token);
  const models = opts.modelChoices ?? [];
  const select = models.length
    ? `<select name="model"${off}>` +
      `<option value="">as configured</option>` +
      models.map((m) => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("") +
      `</select>`
    : "";
  return (
    `<form method="post" action="/api/queue" class="rowrun">${hidden}` +
    `<input type="hidden" name="project" value="${esc(g.project)}">` +
    `<input type="hidden" name="specFolder" value="${esc(g.specFolder)}">` +
    `<input type="hidden" name="steps" value="${esc(p.step)}">` +
    select +
    `<button type="submit"${off}>${p.attempts.length ? "Rerun" : "Run"}</button></form>`
  );
}

function groupRows(groups: SpecGroup[], opts: QueuePageOptions, now: number): string {
  return groups.map((g) => specHeadRow(g, opts, now) + phaseSubRows(g, opts, now)).join("");
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
  const groups = groupBySpec(rows);
  const matched = sortGroups(applyFilter(groups, f), f);
  const hidden = Math.max(0, matched.length - SHOWN);
  const body = matched.length
    ? groupRows(matched.slice(0, SHOWN), opts, now)
    : `<tr><td colspan="6" class="empty muted">` +
      (rows.length
        ? "No job matches this filter."
        : "Nothing has run yet. Pick a spec above and press “Run it”.") +
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
    `<p class="intro">aide runs on this machine: one job at a time, every step ` +
    `bounded by its own budget and a wall clock. A job that hits a cap is ` +
    `<em>stopped</em>, not failed.</p>\n` +
    enqueueForm(opts) +
    `\n` +
    table;
  return pageShell("Specs", entries, "/specs", body, generatedAt, 10, {
    refreshInNoscript: !!opts.script,
    script: opts.script,
  });
}
