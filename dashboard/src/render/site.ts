// The static half of the dashboard: projects.html (the overview) and one
// page per project. Every populated manifest key is shown on the
// project page; a project whose manifest failed to parse gets an error
// page and an error row on the overview.
//
// Since spec 185 the project's page has a SERVED variant too
// (`renderProjectPage`, `/projects/<name>`), which is the same body
// plus what the config file and a live readiness check say. The static
// page keeps exactly what it always had: the generator runs only after
// a merge lands somewhere in the queue, and a settings section written
// then would be describing a config file as it stood days ago.

import type { SpecRef } from "../discover.ts";
import type { StatusInfo } from "../parse-status.ts";
import type { ManifestData, ManifestResult } from "../parse-manifest.ts";
import type { ProjectReadiness } from "../project-admin.ts";
import type { ProjectSettingsView, SettingRow } from "../project-settings.ts";
import { rowMessage } from "./components.ts";
import { esc, linkOrText } from "./html.ts";
import { pageShell, type NavEntry, aboutProse, buildStampLine } from "./shell.ts";

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
  return `<div class="fact"><span class="label">${label}</span><ul>${lis}</ul></div>`;
}

function textRow(label: string, value: string | undefined): string {
  if (!value) return "";
  return `<div class="fact"><span class="label">${label}</span><span>${linkOrText(value)}</span></div>`;
}

function manifestBlock(data: ManifestData): string {
  const parts: string[] = [];
  if (data.description) parts.push(`<p class="desc">${esc(data.description)}</p>`);
  if (data.stack) {
    const entries = Object.entries(data.stack)
      .filter(([, v]) => v && v !== "none")
      .map(([k, v]) => `<li><span class="label">${esc(k)}</span> ${esc(v)}</li>`);
    if (entries.length > 0) {
      parts.push(`<div class="fact"><span class="label">stack</span><ul>${entries.join("")}</ul></div>`);
    }
  }
  parts.push(listRow("dependencies", data.dependencies));
  if (data.deployment) {
    const d = data.deployment;
    const bits = [d.host, d.command, d.note].filter((x): x is string => !!x).map(esc);
    if (d.url) bits.unshift(`<a href="${esc(d.url)}">${esc(d.url)}</a>`);
    parts.push(`<div class="fact"><span class="label">deployment</span><span>${bits.join(" — ")}</span></div>`);
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
    parts.push(`<div class="fact"><span class="label">reports</span><ul>${lis.join("")}</ul></div>`);
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
    // Whether the spec's FOLDER has been archived on disk. It used to
    // be `archived`/`active` — the same two words the spec list uses
    // for the unrelated question of whether a job is in flight, which
    // meant one class name stood for two things. Named for the question
    // it answers now.
    const state = s.archived ? "archived" : "active";
    return (
      `<tr class="${s.archived ? "spec-archived" : "spec-open"}"><td>${esc(s.folder)}</td>` +
      `<td>${esc(s.title ?? "")}</td>` +
      `<td>${esc(phase)}</td><td>${esc(progress)}</td><td>${state}</td></tr>`
    );
  });
  // Five columns, one of them a whole title: the box scrolls rather
  // than the page (spec 155).
  return (
    `<div class="tablewrap"><table class="list"><thead><tr><th>Spec</th><th>Title</th><th>Phase</th>` +
    `<th>Progress</th><th>State</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
  );
}

// Slug assignment: lowercase, non-alphanumeric runs -> one hyphen,
// trimmed. `projects` is pre-reserved (the overview owns
// projects.html); a taken or empty slug gets -2, -3, ... — never a
// silent overwrite.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function assignSlugs(projects: ProjectView[]): Map<ProjectView, string> {
  // `projects` and `about` are ours: a project called either would
  // otherwise overwrite a page the nav links to by name. `index` stays
  // reserved too, defensively — the overview moved off it (spec 100),
  // and nothing should quietly move back in.
  const used = new Set(["index", "about", "projects"]);
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
// live server when it was started with a `--root` of its own.
//
// The Projects entry points at the SERVED page (spec 115), not at the
// generated file: the page that lists the projects is the page that adds
// and removes them, and that needs a server behind it. `navFromSite()`
// in serve.ts is the no-`--root` fallback and deliberately still names
// the file — it has no project set to link the served page's contents
// from.
export function navEntries(
  projects: ProjectView[],
  opts: {
    /** A server with a project root of its own serves each project's
     *  page itself (spec 185), and that page is the one with the
     *  settings and the readiness answer on it. The generator has no
     *  such server behind it and keeps naming the file it writes. */
    live?: boolean;
  } = {},
): NavEntry[] {
  const slugs = assignSlugs(projects);
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  return [
    { label: "Projects", path: PROJECTS_ROUTE },
    // Spec 163. It sits among the project pages rather than beside
    // Projects because the FIRST entry is what the tab bar reads as the
    // Projects tab; what makes it a tab of its own instead of a project
    // is its absolute path, which no project page has.
    { label: "Archive", path: ARCHIVE_ROUTE },
    // The generated site has no server, so its nav is the only way
    // between its pages and every project has to be in it. The served
    // one does not: a project is reached from the Projects page, which
    // lists every one of them with its counts, its warnings and its
    // controls. Repeating them as top-level tabs put each project in
    // the bar twice over — asked for by nobody, and it grows with the
    // machine's project count (2026-08-22).
    ...(opts.live
      ? []
      : ordered.map((p) => ({ label: p.name, path: `${slugs.get(p)!}.html` }))),
  ];
}

/** The generated pages that are not projects. The server's fallback
 *  nav reads the site directory and would otherwise list them as ones. */
export const ABOUT_PAGE = "about.html";

/** The project overview. It answered `/` until spec 100 gave the root to
 *  the spec list, so it needs a filename of its own — and the Bun server
 *  never reaches `serveStatic` for `/` any more.
 *
 *  Since spec 115 the file itself is a redirect: the overview is SERVED,
 *  at `PROJECTS_ROUTE`. The filename stays because people bookmarked it
 *  and because `deploy/rsync-publish.sh` will not publish a site without
 *  it. */
export const OVERVIEW_PAGE = "projects.html";

/** Where the overview actually lives (spec 115): a served route, so the
 *  Add and Remove controls on it have a token to be checked against. */
export const PROJECTS_ROUTE = "/projects";

/** Where a spec is made (spec 121). It was a disclosure folded into the
 *  spec list until the button that opened it became a link to here. */
export const NEW_SPEC_ROUTE = "/new";

/** Where the archive is read (spec 163). An archived spec's own page
 *  has worked since spec 150 — `specDir()` resolves an archived folder
 *  and the four files render — but nothing linked to one, so the pages
 *  existed and could not be found. This is the way in. */
export const ARCHIVE_ROUTE = "/archive";

// The prose itself lives in shell.ts, where the About DIALOG on every
// page shows the same words — this page is the no-JS fallback the menu
// item's href still points at.
function aboutBody(generatedAt: string): string {
  return aboutProse() + buildStampLine(generatedAt);
}

// `removeHref` only on the served page: a generated file has no token
// behind it, so its rows carry no control (asked for 2026-08-19 —
// Remove lives ON the row, at the right of the description).
function overviewRow(
  p: ProjectView,
  path: string,
  removeHref?: string,
  note?: string,
  settingsHref?: string,
): string {
  const settings = settingsHref ? `<a class="btn small" href="${esc(settingsHref)}">Settings</a>` : "";
  const remove = removeHref ? `<a class="btn small" href="${esc(removeHref)}">Remove</a>` : "";
  // Spec 142: on the row, not floating above the list — a reader should
  // not have to work out which project a warning is about. An error row
  // gets it too: a checkout whose manifest will not parse is still a
  // checkout that can fall behind, and it is the one being worked on.
  const drift = note ? rowMessage("warn", note, { tag: "p" }) : "";
  if (!p.manifest.ok) {
    return (
      `<div class="proj-row error"><div><a href="${esc(path)}">${esc(p.name)}</a>` +
      `<p class="error-text">Manifest failed to parse: ${esc(p.manifest.error)}</p>${drift}</div>${settings}${remove}</div>`
    );
  }
  const active = p.specs.filter((s) => !s.archived).length;
  const archived = p.specs.length - active;
  const desc = p.manifest.data.description
    ? `<p class="desc">${esc(p.manifest.data.description)}</p>`
    : "";
  return (
    `<div class="proj-row"><div><a href="${esc(path)}">${esc(p.name)}</a>` +
    `<span class="counts">${active} active · ${archived} archived</span>` +
    desc +
    drift +
    `</div>${settings}${remove}</div>`
  );
}

function projectBody(p: ProjectView): string {
  if (!p.manifest.ok) {
    return `<p class="error-text">Manifest failed to parse: ${esc(p.manifest.error)}</p>`;
  }
  return manifestBlock(p.manifest.data) + `<h3>Specs</h3>` + specTable(p.specs);
}

/** Where a setting's value came from, in the words the page uses (spec
 *  185). The derived case carries a hedge on purpose: the table in
 *  `core/skills/tools-and-scripts/SKILL.md` calls its commands "the
 *  usual defaults, not a promise" — a project whose `package.json`
 *  names its scripts differently would be shown a command that does not
 *  work, and a reader has to be able to see that it was worked out
 *  rather than checked. Nothing on this page is ever executed. */
function originText(r: SettingRow): string {
  if (r.origin === "configured") return "configured";
  if (r.origin === "unset") return "not set";
  return `worked out from ${esc(r.source ?? "")} — the usual ${esc(r.toolchain ?? "")} default, not a verified command`;
}

function settingsTable(settings: ProjectSettingsView): string {
  const rows = settings.rows.map((r) => {
    // A value that does not resolve is marked where it is shown, in
    // readiness's own sentence — never a second wording of the same
    // fact (`project-settings.ts` reads it verbatim).
    const problem = r.problem ? rowMessage("warn", r.problem) : "";
    return (
      `<tr><td>${esc(r.key)} <span class="muted">${esc(r.purpose)}</span></td>` +
      `<td>${r.value === null ? `<span class="muted">–</span>` : esc(r.value)}</td>` +
      `<td>${originText(r)}${problem}</td></tr>`
    );
  });
  return (
    `<div class="tablewrap"><table class="list"><thead><tr><th>Setting</th><th>Value</th>` +
    `<th>Where from</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
  );
}

/** The settings the config file decides, and whether a run could start
 *  here at all — the two things a project's page never said (spec 185).
 *
 *  `readiness` is `null` where git could not be asked. The section then
 *  says nothing rather than guessing: the reader came for the project's
 *  page, and an unreachable git is no reason to withhold the half of it
 *  that needs no git. */
function runConfigurationBlock(
  settings: ProjectSettingsView,
  readiness: ProjectReadiness | null,
): string {
  // "No file" and "a file that sets nothing" are different states, and
  // the first is the ordinary one for a project cloned onto a second
  // machine — said plainly, above the rows, so seven "not set" lines
  // have an explanation rather than reading as seven separate
  // omissions.
  const noFile = settings.hasConfigFile
    ? ""
    : rowMessage("info", "There is no .aide/config in this checkout, so nothing below was configured on this machine.");
  const checks = !readiness
    ? ""
    : `<h3>Can a run start here?</h3>` +
      rowMessage(
        readiness.canRun ? "info" : "err",
        readiness.canRun
          ? "Nothing stops a run: this checkout is ready to run."
          : "A run cannot run here yet.",
      ) +
      readiness.checks
        .map((c) =>
          c.blocking
            ? rowMessage("err", c.detail)
            : c.ok
              ? `<p class="muted">${esc(c.detail)}</p>`
              : rowMessage("warn", c.detail),
        )
        .join("");
  return `<h3>Settings</h3>` + noFile + settingsTable(settings) + checks;
}

/** Where a project's own page is SERVED (spec 185). The generated
 *  `<slug>.html` is still written and still reachable; this is the one
 *  a live server links to, because it is the one that can answer what
 *  the config file says right now. */
export const projectPagePath = (name: string): string => `/projects/${encodeURIComponent(name)}`;

/** The served project page: the static body, plus the settings and the
 *  readiness answer. */
export function renderProjectPage(
  p: ProjectView,
  settings: ProjectSettingsView,
  readiness: ProjectReadiness | null,
  generatedAt: string,
  nav: NavEntry[],
): string {
  // The settings are added to `projectBody` rather than replacing any
  // of it, and that holds for a project whose manifest will not parse
  // too: `projectBody` is then a single error paragraph, and the
  // config is the rest of what the page has to say.
  const body = projectBody(p) + runConfigurationBlock(settings, readiness);
  return pageShell(p.name, nav, projectPagePath(p.name), body, generatedAt);
}

/** The listing itself: the counts, then one row per project, linking to
 *  each project's generated page. Exported because the served
 *  `/projects` page draws exactly this (spec 115) — same rows, same
 *  data, one function, so "the same page plus two controls" is true by
 *  construction rather than by convention. */
/** The counts, and nothing else. Read on a phone the explanation filled
 *  the screen before anything the reader came for; it is documentation,
 *  and documentation has its own page in the menu.
 *
 *  Separate from the list since 2026-08-21: it rides on the list's own
 *  top line beside the Add button, the way the spec list's count and
 *  its New spec link share the filter row. The list itself then starts
 *  with a row, and the word "Projects" is said once — in the tab. */
export function projectSummary(projects: ProjectView[]): string {
  const active = projects.reduce((n, p) => n + p.specs.filter((s) => !s.archived).length, 0);
  const archived = projects.reduce((n, p) => n + p.specs.filter((s) => s.archived).length, 0);
  return (
    `<span class="summary">${projects.length} projects · ` +
    `${active} active · ${archived} archived</span>`
  );
}

export function projectListBody(
  projects: ProjectView[],
  opts: {
    /** Where a project's NAME goes. The generated site links the file
     *  it writes; a server links the page it serves, which is the one
     *  carrying the settings and the readiness answer (spec 185). Two
     *  links reading "woodstack" on one page, going to two different
     *  pages, is what this replaced (2026-08-22). */
    pageHref?: (name: string) => string | undefined;
    removeHref?: (name: string) => string | undefined;
    /** Spec 142: what to say on a project's row about its checkout, if
     *  anything. A callback like `removeHref`, and for the same reason:
     *  `ProjectView` is a pure disk scan the static generator shares,
     *  and a live git answer does not belong on it. */
    note?: (name: string) => string | undefined;
    /** Where the project's own settings are changed (spec 184).
     *  Alongside `removeHref` and for the same reason: a generated page
     *  has no server behind it to check a token against, so it carries
     *  no control at all. */
    settingsHref?: (name: string) => string | undefined;
  } = {},
): string {
  const slugs = assignSlugs(projects);
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  return (
    ordered
      .map((p) =>
        overviewRow(
          p,
          opts.pageHref?.(p.name) ?? `${slugs.get(p)!}.html`,
          opts.removeHref?.(p.name),
          opts.note?.(p.name),
          opts.settingsHref?.(p.name),
        ),
      )
      .join("\n")
  );
}

export function renderSite(projects: ProjectView[], generatedAt: string): Page[] {
  const slugs = assignSlugs(projects);
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const entries = navEntries(projects);

  // The overview is served now (spec 115), because the controls that
  // change the project list need a token checked per request and a file
  // has no server behind it to do that. What is written HERE is the way
  // on: the script for a browser, the link for everything else. Both are
  // in the generated content rather than in the server, so a site
  // rsynced behind a plain file server sends the reader on too.
  const moved =
    `<p>This page has moved to <a href="${PROJECTS_ROUTE}">${PROJECTS_ROUTE}</a>.</p>`;
  const pages: Page[] = [
    {
      path: OVERVIEW_PAGE,
      // The tab always leads with aide; the tagline rides on the
      // overview, the one page that is about aide itself.
      html: pageShell("Projects", entries, PROJECTS_ROUTE, moved, generatedAt, undefined, {
        docTitle: "aide -board — from spec to merge",
        // The query string comes along: a bookmark that carried the
        // token is how a reader arrives here with one.
        script: `location.replace('${PROJECTS_ROUTE}' + location.search);`,
      }),
    },
  ];
  pages.push({
    path: ABOUT_PAGE,
    html: pageShell("About", entries, ABOUT_PAGE, aboutBody(generatedAt), generatedAt, undefined, {
      buildStamp: generatedAt,
    }),
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
