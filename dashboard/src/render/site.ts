// The static half of the dashboard: index.html (the overview) and one
// page per project. Every populated manifest key is shown on the
// project page; a project whose manifest failed to parse gets an error
// page and an error row on the overview.

import type { SpecRef } from "../discover.ts";
import type { StatusInfo } from "../parse-status.ts";
import type { ManifestData, ManifestResult } from "../parse-manifest.ts";
import { esc, linkOrText } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";

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
  // `index` and `about` are ours: a project called either would
  // otherwise overwrite a page the nav links to by name.
  const used = new Set(["index", "about"]);
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

/** The one generated page that is not a project. The server's fallback
 *  nav reads the site directory and would otherwise list it as one. */
export const ABOUT_PAGE = "about.html";

function aboutBody(): string {
  return (
    `<p class="intro">aide-dashboard is the read-only overview of ` +
    `AI-assisted development across the projects on this machine: every ` +
    `project with an <code>.aide/project.yaml</code> manifest gets a page ` +
    `showing what the project IS (stack, deployment, logging, statistics, ` +
    `docs) and where its specs stand (phase and progress, active and ` +
    `archived). The site is static — regenerate and publish with ` +
    `<code>make publish</code>.</p>`
  );
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
  const entries = navEntries(projects);

  const totalActive = projects.reduce(
    (n, p) => n + p.specs.filter((s) => !s.archived).length,
    0,
  );
  const totalArchived = projects.reduce(
    (n, p) => n + p.specs.filter((s) => s.archived).length,
    0,
  );
  // The counts, and nothing else. Read on a phone the explanation
  // filled the screen before anything the reader came for; it is
  // documentation, and documentation has its own page in the menu.
  const intro =
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
  pages.push({
    path: ABOUT_PAGE,
    html: pageShell("About", entries, ABOUT_PAGE, aboutBody(), generatedAt),
  });
  for (const p of ordered) {
    const path = `${slugs.get(p)!}.html`;
    pages.push({
      path,
      html: pageShell(p.name, entries, path, projectBody(p), generatedAt),
    });
  }
  return pages;
}
