// Render data -> ONE self-contained HTML page: inline CSS, no JS, no
// external references. Every populated manifest key is shown; a
// project whose manifest failed to parse gets an error card while the
// rest render fully.

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

function projectCard(p: ProjectView): string {
  if (!p.manifest.ok) {
    return (
      `<section class="card error"><h2>${esc(p.name)}</h2>` +
      `<p class="error-text">Manifest failed to parse: ${esc(p.manifest.error)}</p></section>`
    );
  }
  return (
    `<section class="card"><h2>${esc(p.name)}</h2>` +
    manifestBlock(p.manifest.data) +
    `<h3>Specs</h3>` +
    specTable(p.specs) +
    `</section>`
  );
}

const CSS = `
:root { color-scheme: light dark; }
body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0 auto;
       max-width: 60rem; padding: 1rem; }
header { display: flex; justify-content: space-between; align-items: baseline;
         flex-wrap: wrap; gap: 0.5rem; }
.stamp { color: #777; font-size: 0.85rem; }
.card { border: 1px solid #8884; border-radius: 8px; padding: 1rem;
        margin: 1rem 0; }
.card.error { border-color: #c0392b; }
.error-text { color: #c0392b; }
.desc { margin-top: 0; }
.row { margin: 0.3rem 0; }
.row ul { margin: 0.1rem 0 0.4rem; padding-left: 1.4rem; }
.label { font-weight: 600; margin-right: 0.4rem; }
.muted { color: #777; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.25rem 0.6rem 0.25rem 0; vertical-align: top; }
thead th { border-bottom: 1px solid #8886; }
tr.archived td { color: #999; }
`;

export function renderPage(projects: ProjectView[], generatedAt: string): string {
  const cards = projects.map(projectCard).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>aide dashboard</title>
<style>${CSS}</style>
</head>
<body>
<header><h1>aide dashboard</h1><span class="stamp">Generated ${esc(generatedAt)}</span></header>
${cards}
</body>
</html>
`;
}
