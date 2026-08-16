// Render data -> a small static site: index.html (overview) + one
// page per project, every page self-contained (inline CSS, no JS, no
// external references) and carrying the shared left-column nav.
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
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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

export function renderSite(projects: ProjectView[], generatedAt: string): Page[] {
  const slugs = assignSlugs(projects);
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const entries: NavEntry[] = [
    { label: "Overview", path: "index.html" },
    ...ordered.map((p) => ({ label: p.name, path: `${slugs.get(p)!}.html` })),
  ];

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
