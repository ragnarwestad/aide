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
.enqueue { margin: 0.8rem 0; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.enqueue .steps { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.enqueue .stepbox { font-size: 0.9rem; }
.enqueue .field { display: flex; flex-direction: column; gap: 0.15rem; }
.enqueue .fieldlabel { font-size: 0.75rem; font-weight: 600; color: #777;
  text-transform: uppercase; letter-spacing: 0.04em; }
.enqueue .gate { align-self: end; }
main h2 { font-size: 1.05rem; margin: 1.4rem 0 0.2rem; }
td form { margin: 0; }
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
  const script = opts.script ? `\n<script>${opts.script}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${refresh}
<title>${esc(title)}</title>
<style>${CSS}</style>${script}
</head>
<body>
<div class="layout">
${nav(entries, currentPath)}
<main>
<div class="pagehead"><h1>${esc(title)}</h1><span class="stamp">Generated ${esc(generatedAt)}</span></div>
${body}
</main>
</div>
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
              `<td>${esc(r.spec ?? "–")}</td><td>${esc(r.command)}</td>` +
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
}

export interface QueuePageOptions {
  /** 81a ships no runner: the page says so rather than leaving jobs in
   *  "queued" with no explanation. */
  runnerAvailable: boolean;
  targets: { project: string; specFolder: string }[];
  token?: string;
  /** Browser code for this page, compiled from `queue-client.ts` by the
   *  server. Nothing is hardcoded as a string here: page code is
   *  TypeScript like everything else, and the compiler checks it. */
  script?: string;
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

function enqueueForm(opts: QueuePageOptions): string {
  if (opts.targets.length === 0) {
    return `<p class="muted">No project on this machine has both a manifest and the queue's permission.</p>`;
  }
  const hidden = opts.token ? `<input type="hidden" name="token" value="${esc(opts.token)}">` : "";
  const options = opts.targets
    .map((t) => {
      const value = `${t.project}/${t.specFolder}`;
      return `<option value="${esc(value)}">${esc(value)}</option>`;
    })
    .join("");
  const boxes = QUEUE_STEPS.map(
    (s) =>
      `<label class="stepbox"><input type="checkbox" name="steps" value="${esc(s)}"` +
      `${s === "analyze" ? " checked" : ""}> ${esc(s)}</label>`,
  ).join("");
  // The gate choice is SHOWN and off by default. Hiding it made the
  // button quietly create a job that stops for approval after every
  // step — the opposite of what pressing it looks like it does.
  return (
    `<h2>Queue a job</h2>\n` +
    `<form method="post" action="/api/queue" class="enqueue">${hidden}` +
    `<label class="field"><span class="fieldlabel">Spec</span>` +
    `<select name="target">${options}</select></label>` +
    `<span class="field"><span class="fieldlabel">Steps, in order</span>` +
    `<span class="steps">${boxes}</span></span>` +
    `<label class="stepbox gate"><input type="checkbox" name="gate"> ` +
    `stop for approval between steps</label>` +
    `<button type="submit">Queue it</button></form>`
  );
}

// The rows alone, so the page can refresh its table from script
// without touching a form someone is half-way through filling in.
export function renderQueueRows(rows: QueueRowView[], opts: QueuePageOptions): string {
  if (rows.length === 0) return `<tr><td colspan="7" class="muted">No jobs queued yet.</td></tr>`;
  return rows
    .map((r) => {
      const done = ["done", "cancelled", "stopped", "failed", "interrupted"].includes(r.state);
      const spec = r.branchUrl ? `<a href="${esc(r.branchUrl)}">${esc(r.specFolder)}</a>` : esc(r.specFolder);
      const step = r.steps[r.stepIndex] ?? r.steps[r.steps.length - 1] ?? "–";
      return (
        `<tr class="${done ? "archived" : "active"}">` +
        `<td>${spec}</td><td>${esc(r.project)}</td>` +
        `<td>${esc(step)} <span class="muted">(${r.stepIndex + 1} of ${r.steps.length})</span></td>` +
        `<td>${esc(stateLabel(r))}${r.error ? ` <span class="muted">${esc(r.error)}</span>` : ""}</td>` +
        `<td>${esc(r.createdAt)}</td><td>$${r.spentUsd.toFixed(2)}</td>` +
        `<td>${actionForm(r, opts.token)}</td></tr>`
      );
    })
    .join("");
}

// Server-rendered /queue page in the site's layout (spec 81). No JS:
// plain forms and a meta refresh.
export function renderQueuePage(
  rows: QueueRowView[],
  generatedAt: string,
  entries: NavEntry[],
  opts: QueuePageOptions,
): string {
  const table =
    `<table><thead><tr><th>Spec</th><th>Project</th><th>Step</th><th>State</th>` +
    `<th>Queued</th><th>Cost</th><th>Action</th></tr></thead>` +
    `<tbody id="jobrows">${renderQueueRows(rows, opts)}</tbody></table>`;
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
    `\n<h2>Jobs</h2>\n` +
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
