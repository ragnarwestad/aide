// Render data -> a small static site: index.html (overview) + one
// page per project, every page self-contained (inline CSS, no external
// references) and carrying the shared left-column nav. These pages
// carry no page code because they need none; /queue does, and gets it
// (compiled from queue-client.ts).
// Every populated manifest key is shown on the project page; a
// project whose manifest failed to parse gets an error page and an
// error row on the overview.

import type { SpecRef } from "./discover.ts";
import type { StatusInfo } from "./parse-status.ts";
import type { ManifestData, ManifestResult } from "./parse-manifest.ts";

export interface SpecView extends SpecRef {
  status: StatusInfo | null;
}

export interface ProjectView {
  name: string;
  manifest: ManifestResult;
  specs: SpecView[];
}

export interface Page {
  path: string;
  html: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkOrText(s: string): string {
  return /^https?:\/\/\S+$/.test(s)
    ? `<a href="${esc(s)}">${esc(s)}</a>`
    : esc(s);
}

function listRow(label: string, items: string[] | undefined): string {
  if (!items || items.length === 0) return "";
  const lis = items.map((i) => `<li>${linkOrText(i)}</li>`).join("");
  return `<div class="row"><span class="label">${label}</span><ul>${lis}</ul></div>`;
}

function textRow(label: string, value: string | undefined): string {
  if (!value) return "";
  return `<div class="row"><span class="label">${label}</span><span>${linkOrText(value)}</span></div>`;
}

function manifestBlock(data: ManifestData): string {
  const parts: string[] = [];
  if (data.description) parts.push(`<p class="desc">${esc(data.description)}</p>`);
  if (data.stack) {
    const entries = Object.entries(data.stack)
      .filter(([, v]) => v && v !== "none")
      .map(([k, v]) => `<li><span class="label">${esc(k)}</span> ${esc(v)}</li>`);
    if (entries.length > 0) {
      parts.push(`<div class="row"><span class="label">stack</span><ul>${entries.join("")}</ul></div>`);
    }
  }
  parts.push(listRow("dependencies", data.dependencies));
  if (data.deployment) {
    const d = data.deployment;
    const bits = [d.host, d.command, d.note].filter((x): x is string => !!x).map(esc);
    if (d.url) bits.unshift(`<a href="${esc(d.url)}">${esc(d.url)}</a>`);
    parts.push(`<div class="row"><span class="label">deployment</span><span>${bits.join(" — ")}</span></div>`);
  }
  parts.push(listRow("logging", data.logging?.where));
  parts.push(listRow("statistics", data.statistics));
  if (data.reports && data.reports.length > 0) {
    const lis = data.reports.map((rep) => {
      const title = esc(rep.title ?? rep.url ?? "report");
      const main = rep.url ? `<a href="${esc(rep.url)}">${title}</a>` : title;
      const recipe = rep.recipe ? ` <span class="muted">(${esc(rep.recipe)})</span>` : "";
      return `<li>${main}${recipe}</li>`;
    });
    parts.push(`<div class="row"><span class="label">reports</span><ul>${lis.join("")}</ul></div>`);
  }
  parts.push(listRow("docs", data.docs));
  parts.push(textRow("manifest generated", data.generated));
  return parts.filter(Boolean).join("\n");
}

function specTable(specs: SpecView[]): string {
  if (specs.length === 0) return `<p class="muted">No specs found.</p>`;
  const rows = specs.map((s) => {
    const progress = s.status?.progress
      ? `${s.status.progress.percent}% (${s.status.progress.done} of ${s.status.progress.total})`
      : "–";
    const phase = s.status?.phase ?? "–";
    const state = s.archived ? "archived" : "active";
    return (
      `<tr class="${state}"><td>${esc(s.folder)}</td>` +
      `<td>${esc(s.title ?? "")}</td>` +
      `<td>${esc(phase)}</td><td>${esc(progress)}</td><td>${state}</td></tr>`
    );
  });
  return (
    `<table><thead><tr><th>Spec</th><th>Title</th><th>Phase</th>` +
    `<th>Progress</th><th>State</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
  );
}

// Slug assignment: lowercase, non-alphanumeric runs -> one hyphen,
// trimmed. `index` is pre-reserved (the overview owns index.html);
// a taken or empty slug gets -2, -3, ... — never a silent overwrite.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function assignSlugs(projects: ProjectView[]): Map<ProjectView, string> {
  const used = new Set(["index"]);
  const slugs = new Map<ProjectView, string>();
  for (const p of [...projects].sort((a, b) => a.name.localeCompare(b.name))) {
    const base = slugify(p.name) || "project";
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    slugs.set(p, slug);
  }
  return slugs;
}

interface NavEntry {
  label: string;
  path: string;
}

function nav(entries: NavEntry[], currentPath: string): string {
  const link = (e: NavEntry) => {
    const cls = e.path === currentPath ? ' class="current"' : "";
    return `<li><a${cls} href="${esc(e.path)}">${esc(e.label)}</a></li>`;
  };
  const [overview, ...projects] = entries;
  const lis = [
    link(overview),
    link({ label: "Live", path: "/live" }),
    link({ label: "Queue", path: "/queue" }),
    `<li class="nav-label">Projects</li>`,
    ...projects.map(link),
  ];
  return `<nav><ul>${lis.join("")}</ul></nav>`;
}

const CSS = `
:root { color-scheme: light dark; }
body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; }
.layout { display: flex; min-height: 100vh; }
.layout > nav { flex: 0 0 14rem; padding: 1rem; border-right: 1px solid #8884; }
.layout > nav ul { list-style: none; margin: 0; padding: 0; }
.layout > nav li { margin: 0.3rem 0; }
.layout > nav a { text-decoration: none; }
.layout > nav a.current { font-weight: 700; }
.layout > nav .nav-label { margin-top: 0.9rem; font-size: 0.8rem;
  font-weight: 600; color: #777; text-transform: uppercase;
  letter-spacing: 0.05em; }
main { flex: 1; padding: 1rem 1.5rem; max-width: 60rem; }
.pagehead { display: flex; justify-content: space-between; align-items: baseline;
            flex-wrap: wrap; gap: 0.5rem; }
.stamp { color: #777; font-size: 0.85rem; }
.proj-row { border: 1px solid #8884; border-radius: 8px; padding: 0.8rem 1rem;
            margin: 0.8rem 0; }
.proj-row.error { border-color: #c0392b; }
.error-text { color: #c0392b; }
.counts { color: #777; margin-left: 0.6rem; font-size: 0.9rem; }
.summary { color: #777; font-size: 0.9rem; }
.desc { margin-top: 0; }
.row { margin: 0.3rem 0; }
.row ul { margin: 0.1rem 0 0.4rem; padding-left: 1.4rem; }
.label { font-weight: 600; margin-right: 0.4rem; }
.muted { color: #777; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.25rem 0.6rem 0.25rem 0; vertical-align: top; }
thead th { border-bottom: 1px solid #8886; }
tr.archived td { color: #999; }
main h2 { font-size: 1rem; margin: 1.6rem 0 0.4rem; letter-spacing: 0.01em; }
.small { font-size: 0.82rem; }

/* The form is a panel, not three controls loose on the page. */
.panel { border: 1px solid #8884; border-radius: 10px; padding: 0.9rem 1.1rem 1rem;
  margin: 1rem 0 1.6rem; background: #8881; }
.panel h2 { margin-top: 0; }
.enqueue { display: flex; flex-wrap: wrap; gap: 0.9rem 1.2rem; align-items: end; }
.enqueue .field { display: flex; flex-direction: column; gap: 0.25rem; }
.enqueue .fieldlabel { font-size: 0.72rem; font-weight: 600; color: #888;
  text-transform: uppercase; letter-spacing: 0.06em; }
.enqueue select { font: inherit; padding: 0.35rem 0.5rem; border-radius: 6px;
  border: 1px solid #8886; background: transparent; color: inherit; min-width: 15rem; }
.enqueue .steps { display: flex; gap: 0.7rem; flex-wrap: wrap; padding-bottom: 0.35rem; }
.enqueue .stepbox { font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.3rem; }
.enqueue .gate { color: #888; padding-bottom: 0.35rem; }
.enqueue .stepbox.isdone { color: #888; }
.enqueue .tick { color: #22c55e; font-weight: 700; }
.enqueue button { font: inherit; font-weight: 600; padding: 0.4rem 0.9rem;
  border-radius: 6px; border: 1px solid #8886; background: #8882; color: inherit;
  cursor: pointer; }
.enqueue button:hover { background: #8883; }
.listhead { font-size: 0.78rem; font-weight: 700; color: #888; margin: 1.6rem 0 0.4rem;
  text-transform: uppercase; letter-spacing: 0.07em; }
.listnote { margin: 0.4rem 0 0; }
.refusal { margin: 0 0 0.9rem; padding: 0.5rem 0.8rem; border-radius: 6px;
  background: #f59e0b22; border: 1px solid #f59e0b88; font-size: 0.9rem; }
.specinfo { margin: 0.9rem 0 0; padding-top: 0.7rem; border-top: 1px solid #8883;
  font-size: 0.9rem; }

/* State carries colour, but the word is always there too. */
.chip, .state { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 999px;
  font-size: 0.8rem; border: 1px solid #8886; }
.state { font-weight: 600; }
.s-running { background: #3b82f622; border-color: #3b82f688; }
.s-queued { background: #8881; }
.s-awaiting-approval { background: #a855f722; border-color: #a855f788; }
.s-done { background: #22c55e22; border-color: #22c55e88; }
.s-stopped { background: #f59e0b22; border-color: #f59e0b88; }
.s-failed, .s-interrupted { background: #ef444422; border-color: #ef444488; }
.s-cancelled { background: #8881; color: #888; }

table.jobs td { padding: 0.5rem 0.8rem 0.5rem 0; border-bottom: 1px solid #8882; }
table.jobs .speccell { font-weight: 600; }
table.jobs .num { text-align: right; font-variant-numeric: tabular-nums; }
table.jobs .empty { padding: 1.2rem 0; }
/* One job, in full: facts on the left, values on the right. */
table.facts { width: auto; margin: 0.6rem 0 1rem; }
table.facts td { padding: 0.15rem 1rem 0.15rem 0; }
table.facts .label { color: #777; font-weight: 600; white-space: nowrap; }
table.facts .pips { display: inline-flex; margin: 0 0 0 0.5rem; vertical-align: middle; }
.specdesc { white-space: pre-wrap; max-width: 46rem; }
ul.activity { list-style: none; margin: 0.3rem 0; padding: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; }
ul.activity li { padding: 0.12rem 0; border-bottom: 1px solid #8882;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* One job says four different things. Under plain headings they ran
   together and a reader scrolled past the one they came for. */
.tabs { display: flex; flex-wrap: wrap; gap: 0.2rem; margin: 1rem 0 0;
  border-bottom: 1px solid #8884; }
.tabs a { text-decoration: none; color: inherit; font-size: 0.92rem;
  padding: 0.45rem 0.9rem; margin-bottom: -1px; border: 1px solid transparent;
  border-bottom: none; border-radius: 8px 8px 0 0; }
.tabs a:hover { background: #8881; }
.tabs a[aria-current] { font-weight: 700; background: #8881; border-color: #8884; }
.tabcount { display: inline-block; margin-left: 0.35rem; padding: 0 0.4rem;
  border-radius: 999px; background: #8883; font-size: 0.75rem; font-weight: 600;
  color: #666; }
.tabpanel { padding-top: 0.8rem; }
.tabpanel > h2:first-child { margin-top: 0.4rem; }
.pips { display: flex; gap: 3px; margin-top: 0.3rem; }
.pip { width: 14px; height: 4px; border-radius: 2px; background: #8884; }
.pip.past { background: #22c55e99; }
.pip.now { background: #3b82f6; }
td form { margin: 0; }
td button { font: inherit; font-size: 0.85rem; padding: 0.2rem 0.6rem; border-radius: 5px;
  border: 1px solid #8886; background: transparent; color: inherit; cursor: pointer; }
@media (max-width: 40rem) {
  .layout { flex-direction: column; }
  .layout > nav { flex: none; border-right: none; border-bottom: 1px solid #8884; }
  .layout > nav li { display: inline-block; margin-right: 0.8rem; }
}
`;

function pageShell(
  title: string,
  entries: NavEntry[],
  currentPath: string,
  body: string,
  generatedAt: string,
  refreshSeconds?: number,
  opts: { refreshInNoscript?: boolean; script?: string } = {},
): string {
  // A meta refresh is fine on a page you only read. On a page with a
  // FORM it is hostile: it wipes what you were half-way through
  // filling in. /queue therefore refreshes its table from script and
  // keeps the blunt refresh as the fallback for a browser that did not
  // run it.
  const meta = refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : "";
  const refresh = !meta ? "" : opts.refreshInNoscript ? `\n<noscript>${meta}</noscript>` : `\n${meta}`;
  // At the END of the body, never in <head>: an inline script in the
  // head runs before the elements exist, so every listener it tries to
  // attach silently attaches to nothing. (Which is exactly what
  // happened: the table still refreshed on its timer, so it looked
  // like the code was running.)
  const script = opts.script ? `\n<script>${opts.script}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${refresh}
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
${nav(entries, currentPath)}
<main>
<div class="pagehead"><h1>${esc(title)}</h1><span class="stamp">Generated ${esc(generatedAt)}</span></div>
${body}
</main>
</div>${script}
</body>
</html>
`;
}

function overviewRow(p: ProjectView, path: string): string {
  if (!p.manifest.ok) {
    return (
      `<div class="proj-row error"><a href="${esc(path)}">${esc(p.name)}</a>` +
      `<p class="error-text">Manifest failed to parse: ${esc(p.manifest.error)}</p></div>`
    );
  }
  const active = p.specs.filter((s) => !s.archived).length;
  const archived = p.specs.length - active;
  const desc = p.manifest.data.description
    ? `<p class="desc">${esc(p.manifest.data.description)}</p>`
    : "";
  return (
    `<div class="proj-row"><a href="${esc(path)}">${esc(p.name)}</a>` +
    `<span class="counts">${active} active · ${archived} archived</span>` +
    desc +
    `</div>`
  );
}

function projectBody(p: ProjectView): string {
  if (!p.manifest.ok) {
    return `<p class="error-text">Manifest failed to parse: ${esc(p.manifest.error)}</p>`;
  }
  return manifestBlock(p.manifest.data) + `<h3>Specs</h3>` + specTable(p.specs);
}

export type { NavEntry };

// The nav entries for a project set — shared by the generator and the
// server (which renders /live through the same layout).
export function navEntries(projects: ProjectView[]): NavEntry[] {
  const slugs = assignSlugs(projects);
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  return [
    { label: "Overview", path: "index.html" },
    ...ordered.map((p) => ({ label: p.name, path: `${slugs.get(p)!}.html` })),
  ];
}

export interface LiveRowView {
  spec?: string;
  command: string;
  /** The TDD phase an implement run last reported, when it reported
   *  one (spec 81 §2). */
  phase?: string;
  project?: string;
  sessionId: string;
  receivedAt: string;
  live: string;
  subagents: number | null;
  costUsd: number | null;
}

// Server-rendered /live page in the site's layout (spec 80). No JS:
// a meta refresh keeps it current.
export function renderLivePage(
  rows: LiveRowView[],
  notice: string | null,
  generatedAt: string,
  entries: NavEntry[],
): string {
  const table =
    rows.length === 0
      ? `<p class="muted">No aide runs received yet.</p>`
      : `<table><thead><tr><th>Spec</th><th>Phase</th><th>Project</th><th>Session</th>` +
        `<th>Started</th><th>Live</th><th>Subagents</th><th>Cost so far</th></tr></thead><tbody>` +
        rows
          .map(
            (r) =>
              `<tr class="${esc(r.live === "not-live" ? "archived" : "active")}">` +
              `<td>${esc(r.spec ?? "–")}</td>` +
              `<td>${esc(r.phase ? `${r.command} · ${r.phase}` : r.command)}</td>` +
              `<td>${esc(r.project ?? "–")}</td><td>${esc(r.sessionId.slice(0, 8))}</td>` +
              `<td>${esc(r.receivedAt)}</td><td>${esc(r.live)}</td>` +
              `<td>${r.subagents === null ? "–" : r.subagents}</td>` +
              `<td>${r.costUsd === null ? "–" : `$${r.costUsd.toFixed(2)}`}</td></tr>`,
          )
          .join("") +
        `</tbody></table>`;
  const body =
    (notice ? `<p class="muted">${esc(notice)}</p>\n` : "") +
    `<p class="intro">aide runs linked to their sessions — liveness, subagents and ` +
    `cost so far come from claude-usage and lag a little for remote machines.</p>\n` +
    table;
  return pageShell("Live", entries, "/live", body, generatedAt, 10);
}

export interface QueueRowView {
  id: string;
  project: string;
  specFolder: string;
  steps: string[];
  stepIndex: number;
  state:
    | "queued" | "running" | "awaiting-approval" | "done"
    | "stopped" | "failed" | "cancelled" | "interrupted";
  spentUsd: number;
  timeoutSec: number;
  createdAt: string;
  startedAt?: string;
  stopReason?: "budget" | "timeout";
  branchUrl?: string;
  error?: string;
  /** What this job ran on. Shown next to the cost, because a figure
   *  without its model cannot be compared with the next one. */
  model?: string;
}

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
}

// A stopped job is NOT a failed one, and the two must never render as
// the same string: with tight caps a cap-stop is a common, healthy
// outcome, and a reader who cannot tell them apart ignores both.
function stateLabel(r: QueueRowView): string {
  if (r.state === "awaiting-approval") return "waiting for approval";
  if (r.state === "stopped") {
    return r.stopReason === "timeout"
      ? `stopped — ${Math.round(r.timeoutSec / 60)} min`
      : "stopped — budget";
  }
  return r.state;
}

// A wall of identical grey rows hides the one thing you came to see.
// Colour carries the state; the label still says it in words, so the
// colour is never the only signal.
function stateChip(r: QueueRowView): string {
  return `<span class="state s-${esc(r.state)}">${esc(stateLabel(r))}</span>`;
}

// "4 min ago" beats an ISO timestamp for the question actually being
// asked, which is "is this recent?". The exact stamp stays in the
// tooltip.
function relTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return esc(iso);
  const secs = Math.max(0, Math.round((now - then) / 1000));
  const label =
    secs < 45 ? "just now"
    : secs < 5400 ? `${Math.round(secs / 60)} min ago`
    : secs < 172800 ? `${Math.round(secs / 3600)} h ago`
    : `${Math.round(secs / 86400)} d ago`;
  return `<span title="${esc(iso)}">${label}</span>`;
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

const QUEUE_STEPS = ["analyze", "review-plan", "implement", "archive"];

// A step the spec has already had is marked done and left unticked;
// the first one it has NOT had is ticked, because that is what you
// almost always came to run. Nothing is disabled: re-analysing after
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

// One line about the chosen spec: what it is, and how far it has got.
export function specSummary(t: QueueTarget): string {
  const bits: string[] = [];
  if (t.title) bits.push(esc(t.title));
  if (t.phase) bits.push(`<span class="chip">${esc(t.phase)}</span>`);
  if (typeof t.percent === "number") bits.push(`${t.percent}% done`);
  return bits.length ? bits.join(" · ") : `<span class="muted">no status recorded yet</span>`;
}

const ACTIVE_STATES = new Set(["queued", "running", "awaiting-approval"]);
const RECENT_SHOWN = 10;

// The rows alone, so the page can refresh its table from script
// without touching a form someone is half-way through filling in.
//
// Split in two, because one list answering both "is anything running?"
// and "what has this machine ever done?" answers neither: the two rows
// for spec 84 sat side by side, one done and one cancelled, and the
// question you actually had was whether anything was running.
export function renderQueueRows(rows: QueueRowView[], opts: QueuePageOptions, now = Date.now()): string {
  const active = rows.filter((r) => ACTIVE_STATES.has(r.state));
  const finished = rows.filter((r) => !ACTIVE_STATES.has(r.state));
  const hidden = Math.max(0, finished.length - RECENT_SHOWN);

  const table = (heading: string, body: string, note = "") =>
    `<h3 class="listhead">${heading}</h3>${note}` +
    `<table class="jobs"><thead><tr><th>Spec</th><th>Step</th><th>State</th>` +
    `<th>Started</th><th class="num">Cost</th><th></th></tr></thead><tbody>${body}</tbody></table>`;

  const empty = (text: string) => `<tr><td colspan="6" class="empty muted">${text}</td></tr>`;

  return (
    table(
      "Active",
      active.length ? jobRows(active, opts, now) : empty("Nothing running. Pick a spec above and press “Queue it”."),
    ) +
    table(
      "Recent",
      finished.length ? jobRows(finished.slice(0, RECENT_SHOWN), opts, now) : empty("Nothing has finished yet."),
      hidden ? `<p class="muted small listnote">${hidden} older ${hidden === 1 ? "run" : "runs"} not shown.</p>` : "",
    )
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

// --- one job, in full (spec 02) ---------------------------------------------

export interface JobStepResultView {
  step?: string;
  ok: boolean;
  costUsd: number;
  costMeasured: boolean;
  terminalReason: string;
  subtype?: string;
  sessionId?: string;
  at: string;
}

export interface JobLiveView {
  state: string;
  subagents: number | null;
  costUsd: number | null;
  /** False when claude-usage could not be reached at all — the page says
   *  "unknown" rather than pretending the run is idle. */
  enriched: boolean;
}

export interface JobDetailView extends QueueRowView {
  /** The spec's H1 and its `## Description` prose. */
  title?: string;
  description?: string;
  finishedAt?: string;
  sessionId?: string;
  results: JobStepResultView[];
  /** The running step's session, when there is one to look up. */
  live?: JobLiveView | null;
  /** Already-escaped lines from `parse-stream.ts`. */
  activity?: string[];
}

function labelled(rows: [string, string][]): string {
  return (
    `<table class="facts"><tbody>` +
    rows.map(([k, v]) => `<tr><td class="label">${esc(k)}</td><td>${v}</td></tr>`).join("") +
    `</tbody></table>`
  );
}

function money(n: number | null | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "–";
}

function stepResults(results: JobStepResultView[]): string {
  // /queue shows one row per JOB, so a three-step job shows one line and
  // its finished steps are invisible — even though every one of them is
  // recorded with its cost, its session and how it ended.
  if (results.length === 0) return `<p class="muted">No step has finished yet.</p>`;
  const rows = results
    .map(
      (r) =>
        `<tr><td>${esc(r.step ?? "–")}</td>` +
        `<td>${r.ok ? "ok" : esc(r.terminalReason || "failed")}</td>` +
        `<td class="num">${money(r.costUsd)}${r.costMeasured ? "" : ' <span class="muted small">est.</span>'}</td>` +
        `<td>${esc(r.terminalReason)}</td>` +
        `<td class="muted small">${esc(r.sessionId ? r.sessionId.slice(0, 8) : "–")}</td>` +
        `<td class="muted small">${esc(r.at)}</td></tr>`,
    )
    .join("");
  return (
    `<table><thead><tr><th>Step</th><th>Outcome</th><th class="num">Cost</th>` +
    `<th>Ended as</th><th>Session</th><th>At</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

// The page's tabs. The choice lives in the URL, not in script: the page
// reloads itself every 10 seconds, and a tab held only in memory would
// snap back to the first one on every reload.
const JOB_TABS = ["overview", "activity", "steps"] as const;
export type JobTab = (typeof JOB_TABS)[number];

// While a step is running, what it is DOING is what the page was
// opened for; a job that has stopped has nothing running, so its facts
// open instead.
function jobTab(name: string | undefined, job: JobDetailView): JobTab {
  if ((JOB_TABS as readonly string[]).includes(name ?? "")) return name as JobTab;
  return job.state === "running" ? "activity" : "overview";
}

function tabBar(job: JobDetailView, current: JobTab): string {
  const counts: Record<string, number> = {
    activity: job.activity?.length ?? 0,
    steps: job.results.length,
  };
  const links = JOB_TABS.map((t) => {
    const label = t[0]!.toUpperCase() + t.slice(1);
    const n = counts[t] ?? 0;
    const count = n > 0 ? ` <span class="tabcount">${n}</span>` : "";
    const mark = t === current ? ` aria-current="page"` : "";
    return `<a href="/queue/${esc(job.id)}?tab=${t}"${mark}>${label}${count}</a>`;
  });
  return `<nav class="tabs">${links.join("")}</nav>`;
}

// Server-rendered /queue/<id> in the site's layout. Poll-and-refresh
// like every other page here — no new transport for one panel.
export function renderJobDetailPage(
  job: JobDetailView,
  generatedAt: string,
  entries: NavEntry[],
  opts: { tab?: string; now?: number } = {},
): string {
  const now = opts.now ?? Date.now();
  const tab = jobTab(opts.tab, job);
  const pips = job.steps
    .map((s, i) => {
      const cls = i < job.stepIndex ? "past" : i === job.stepIndex ? "now" : "todo";
      return `<span class="pip ${cls}" title="${esc(s)}"></span>`;
    })
    .join("");
  const step = job.steps[job.stepIndex] ?? job.steps[job.steps.length - 1] ?? "–";

  // State and title stay ABOVE the tabs: whichever tab is open, the
  // reader still needs to know which job this is and how it is doing.
  const banner =
    `<p class="pagehead">${stateChip(job)}` +
    (job.error ? ` <span class="muted small">${esc(job.error)}</span>` : "") +
    `</p>` +
    (job.title ? `<p class="desc"><strong>${esc(job.title)}</strong></p>` : "");

  const head =
    (job.description ? `<p class="desc specdesc">${esc(job.description)}</p>` : "") +
    labelled([
      ["Project", esc(job.project)],
      ["Spec", esc(job.specFolder)],
      ["Step", `${esc(step)}<span class="pips">${pips}</span>`],
      ["Model", esc(job.model ?? "as configured")],
      ["Cost so far", money(job.spentUsd)],
      ["Started", relTime(job.startedAt ?? job.createdAt, now)],
      ...(job.branchUrl
        ? ([["Work", `<a href="${esc(job.branchUrl)}">${esc(job.branchUrl)}</a>`]] as [string, string][])
        : []),
    ]);

  // Only while a step is actually running: a finished job has no session
  // to follow, and a panel that still showed one would read as "working".
  const live =
    job.state !== "running"
      ? ""
      : `<h2>Live right now</h2>` +
        (job.live
          ? labelled([
              ["State", esc(job.live.state)],
              ["Subagents", job.live.subagents === null ? "–" : String(job.live.subagents)],
              ["Cost so far", money(job.live.costUsd)],
              ["Session", esc(job.sessionId ? job.sessionId.slice(0, 8) : "–")],
            ]) +
            (job.live.enriched
              ? ""
              : `<p class="muted small">claude-usage is unreachable — liveness, subagents and cost are unknown right now.</p>`)
          : `<p class="muted">unknown — no session is linked to this step yet.</p>`);

  const activity =
    job.activity && job.activity.length > 0
      ? `<ul class="activity">${job.activity.map((a) => `<li>${a}</li>`).join("")}</ul>`
      : `<p class="muted">Nothing has been captured from this run yet.</p>`;

  const panel =
    tab === "activity" ? activity : tab === "steps" ? stepResults(job.results) : head + live;

  const body =
    `<p class="intro"><a href="/queue">← all jobs</a></p>\n` +
    banner +
    tabBar(job, tab) +
    `<div class="tabpanel">${panel}</div>`;

  return pageShell(job.specFolder, entries, "/queue", body, generatedAt, 10);
}

// Server-rendered /queue page in the site's layout (spec 81). No JS:
// plain forms and a meta refresh.
export function renderQueuePage(
  rows: QueueRowView[],
  generatedAt: string,
  entries: NavEntry[],
  opts: QueuePageOptions,
): string {
  // One container, two tables inside it: the script swaps the
  // container's contents, so a refresh can never drop a section.
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

export function renderSite(projects: ProjectView[], generatedAt: string): Page[] {
  const slugs = assignSlugs(projects);
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const entries = navEntries(projects);

  const totalActive = projects.reduce(
    (n, p) => n + p.specs.filter((s) => !s.archived).length,
    0,
  );
  const totalArchived = projects.reduce(
    (n, p) => n + p.specs.filter((s) => s.archived).length,
    0,
  );
  const intro =
    `<p class="intro">aide-dashboard is the read-only overview of ` +
    `AI-assisted development across the projects on this machine: every ` +
    `project with an <code>.aide/project.yaml</code> manifest gets a page ` +
    `showing what the project IS (stack, deployment, logging, statistics, ` +
    `docs) and where its specs stand (phase and progress, active and ` +
    `archived). The site is static — regenerate and publish with ` +
    `<code>make publish</code>.</p>\n` +
    `<p class="summary">${projects.length} projects · ` +
    `${totalActive} active · ${totalArchived} archived</p>`;
  const overview =
    intro +
    `\n<h2>Projects</h2>\n` +
    ordered.map((p) => overviewRow(p, `${slugs.get(p)!}.html`)).join("\n");
  const pages: Page[] = [
    {
      path: "index.html",
      html: pageShell("aide dashboard", entries, "index.html", overview, generatedAt),
    },
  ];
  for (const p of ordered) {
    const path = `${slugs.get(p)!}.html`;
    pages.push({
      path,
      html: pageShell(p.name, entries, path, projectBody(p), generatedAt),
    });
  }
  return pages;
}
