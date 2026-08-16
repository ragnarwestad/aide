// /queue: the form that queues a job, and the one list of every job
// this machine has run — cut and ordered on demand.
//
// The page carries browser code (compiled from queue-client.ts) so the
// list can refresh without reloading a form someone is half-way through
// filling in. Everything the code does also works without it: the
// filters and the sort are ordinary links.

import { esc, relTime } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { stateChip, type QueueRowView } from "./job-state.ts";

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
    return `<p class="muted">No project on this machine has both a manifest and the queue's permission.</p>`;
  }
  const hidden = opts.token ? `<input type="hidden" name="token" value="${esc(opts.token)}">` : "";
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
  const models = opts.modelChoices ?? [];
  const modelField = models.length
    ? `<label class="field"><span class="fieldlabel">Model</span>` +
      `<select name="model" id="model">` +
      `<option value="">as configured per step</option>` +
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
    `<h2>Queue a job</h2>\n` +
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
    `<button type="submit">Queue it</button></form>` +
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

function applyFilter(rows: QueueRowView[], f: QueueFilter): QueueRowView[] {
  const states = stateFilter(f.state).states;
  return rows.filter(
    (r) => (!states || states.includes(r.state)) && (!f.project || r.project === f.project),
  );
}

function sortRows(rows: QueueRowView[], f: QueueFilter): QueueRowView[] {
  const sort = SORTS.includes(f.sort ?? "") ? f.sort! : "started";
  const dir = f.dir === "asc" || f.dir === "desc" ? f.dir : SORT_DEFAULT_DIR[sort]!;
  const sign = dir === "asc" ? 1 : -1;
  const key = (r: QueueRowView): number | string =>
    sort === "cost" ? r.spentUsd
    : sort === "spec" ? r.specFolder
    : sort === "state" ? r.state
    : Date.parse(r.startedAt ?? r.createdAt) || 0;
  return [...rows].sort((a, b) => {
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
  return esc(q ? `/queue?${q}` : "/queue");
}

function filterBar(rows: QueueRowView[], f: QueueFilter): string {
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
  // nobody asked for.
  const byProject = rows.filter((r) => !f.project || r.project === f.project);
  const states = chips(
    "state",
    "Show",
    STATE_FILTERS.map((s) => ({
      key: s.key,
      label: s.label,
      count: byProject.filter((r) => !s.states || s.states.includes(r.state)).length,
      on: s.key === current,
      patch: { state: s.key === "all" ? "" : s.key },
    })),
  );

  const names = [...new Set(rows.map((r) => r.project))].sort();
  if (names.length < 2) return `<div class="listcontrols">${states}</div>`;
  const byState = applyFilter(rows, { state: f.state });
  const projects = chips("project", "Project", [
    { key: "", label: "All", count: byState.length, on: !f.project, patch: { project: "" } },
    ...names.map((p) => ({
      key: p,
      label: p,
      count: byState.filter((r) => r.project === p).length,
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
    `<thead><tr>${th("spec", "Spec")}<th>Step</th>${th("state", "State")}` +
    `${th("started", "Started")}${th("cost", "Cost", "num")}<th></th></tr></thead>`
  );
}

function actionForm(r: QueueRowView, token?: string): string {
  const action =
    r.state === "awaiting-approval" ? "approve" : r.state === "queued" || r.state === "running" ? "cancel" : null;
  if (!action) return "–";
  const hidden = token ? `<input type="hidden" name="token" value="${esc(token)}">` : "";
  return (
    `<form method="post" action="/api/queue/${esc(r.id)}/${action}">${hidden}` +
    `<button type="submit">${action === "approve" ? "Approve" : "Cancel"}</button></form>`
  );
}

function jobRows(rows: QueueRowView[], opts: QueuePageOptions, now: number): string {
  return rows
    .map((r) => {
      const done = ["done", "cancelled", "stopped", "failed", "interrupted"].includes(r.state);
      // The spec name is the way IN to the job: what it is, every step it
      // has run, and what it is doing now. The diff link moves beside it
      // rather than being replaced by it — nothing a reader uses today
      // disappears.
      const spec = `<a href="/queue/${esc(r.id)}">${esc(r.specFolder)}</a>`;
      const diff = r.branchUrl ? ` <a class="small" href="${esc(r.branchUrl)}">diff</a>` : "";
      const step = r.steps[r.stepIndex] ?? r.steps[r.steps.length - 1] ?? "–";
      const steps = r.steps
        .map((s, i) => {
          const cls = i < r.stepIndex ? "past" : i === r.stepIndex ? "now" : "todo";
          return `<span class="pip ${cls}" title="${esc(s)}"></span>`;
        })
        .join("");
      return (
        `<tr class="${done ? "archived" : "active"}">` +
        `<td><div class="speccell">${spec}${diff}</div><div class="muted small">${esc(r.project)}</div></td>` +
        `<td><div>${esc(step)}</div><div class="pips">${steps}</div>` +
        (r.model ? `<div class="muted small">${esc(r.model)}</div>` : "") +
        `</td>` +
        `<td>${stateChip(r)}${r.error ? `<div class="muted small">${esc(r.error)}</div>` : ""}</td>` +
        `<td>${relTime(r.startedAt ?? r.createdAt, now)}</td>` +
        `<td class="num">${r.spentUsd > 0 ? `$${r.spentUsd.toFixed(2)}` : "–"}</td>` +
        `<td>${actionForm(r, opts.token)}</td></tr>`
      );
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
export function renderQueueRows(rows: QueueRowView[], opts: QueuePageOptions, now = Date.now()): string {
  const f = opts.filter ?? {};
  const matched = sortRows(applyFilter(rows, f), f);
  const hidden = Math.max(0, matched.length - SHOWN);
  const body = matched.length
    ? jobRows(matched.slice(0, SHOWN), opts, now)
    : `<tr><td colspan="6" class="empty muted">` +
      (rows.length
        ? "No job matches this filter."
        : "Nothing has run yet. Pick a spec above and press “Queue it”.") +
      `</td></tr>`;
  return (
    filterBar(rows, f) +
    `<table class="jobs">${sortableHead(f)}<tbody>${body}</tbody></table>` +
    (hidden ? `<p class="muted small listnote">${hidden} older ${hidden === 1 ? "run" : "runs"} not shown.</p>` : "")
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
    `<p class="intro">Queued aide runs: one job at a time, every step bounded by ` +
    `its own budget and a wall clock. A job that hits a cap is <em>stopped</em>, ` +
    `not failed.</p>\n` +
    enqueueForm(opts) +
    `\n` +
    table;
  return pageShell("Queue", entries, "/queue", body, generatedAt, 10, {
    refreshInNoscript: !!opts.script,
    script: opts.script,
  });
}
