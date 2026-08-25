// The project pages. Two of the three are SERVED: the rows of the
// `/projects` list (`projectListBody`/`overviewRow`), and a project's
// own page (`renderProjectPage`, `/projects/<name>`, spec 185). The
// third, `renderSite`, is what is left of the static half — the
// redirect projects.html became (spec 115) and the About page. The
// page per project went on 2026-08-22; the comment on `renderSite`
// says why.
//
// A project's own page carries what a generated file could not answer:
// what its `.aide/config` says, and whether a run could start there.
// It does not repeat the manifest (spec 238) — that was a frozen copy
// of a file nothing on the page could act on, and a manifest that
// fails to parse says so on the project's row in the list.

import type { SpecRef } from "../discover.ts";
import type { StatusInfo } from "../parse-status.ts";
import type { ManifestResult } from "../parse-manifest.ts";
import type { ProjectReadiness } from "../project-admin.ts";
import type { ProjectSettingsView, SettingRow } from "../project-settings.ts";
import { btn, field, messageSlot, rowMessage, tokenField } from "./components.ts";
import { esc } from "./html.ts";
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

// Slug assignment: lowercase, non-alphanumeric runs -> one hyphen,
// trimmed. `projects` is pre-reserved (the overview owns
// projects.html); a taken or empty slug gets -2, -3, ... — never a
// silent overwrite.


// The nav entries for a project set — shared by the generator and the
// live server when it was started with a `--root` of its own.
//
// The Projects entry points at the SERVED page (spec 115), not at the
// generated file: the page that lists the projects is the page that adds
// and removes them, and that needs a server behind it. `navFromSite()`
// in serve.ts is the no-`--root` fallback and deliberately still names
// the file — it has no project set to link the served page's contents
// from.
export function navEntries(): NavEntry[] {
  return [
    { label: "Projects", path: PROJECTS_ROUTE },
    // An Archive tab stood here from spec 163 until spec 221. Every
    // archived spec is a row on the Specs list now, one chip away, with
    // its date, its description, its "not landed" mark and the same
    // search the tab had — so a second place to read the same thing was
    // a second place to keep in step with it.
    // A tab per project stood here, from the days this was a generated
    // site with a page per project and no server (aide-dashboard spec
    // 01). A project is reached from the Projects page now, which lists
    // every one with its counts, its warnings and its controls, so the
    // tabs said each project twice and the bar grew with the machine's
    // project count (2026-08-22).
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
): string {
  const remove = removeHref ? `<a class="btn small proj-row-action" href="${esc(removeHref)}">Remove</a>` : "";
  const projectLink = `<a class="proj-row-link" href="${esc(path)}">${esc(p.name)}</a>`;
  // Spec 142: on the row, not floating above the list — a reader should
  // not have to work out which project a warning is about. An error row
  // gets it too: a checkout whose manifest will not parse is still a
  // checkout that can fall behind, and it is the one being worked on.
  const drift = note ? rowMessage("warn", note, { tag: "p" }) : "";
  if (!p.manifest.ok) {
    return (
      `<div class="proj-row error"><div>${projectLink}` +
      `<p class="error-text">Manifest failed to parse: ${esc(p.manifest.error)}</p>${drift}</div>${remove}</div>`
    );
  }
  const active = p.specs.filter((s) => !s.archived).length;
  const archived = p.specs.length - active;
  const desc = p.manifest.data.description
    ? `<p class="desc">${esc(p.manifest.data.description)}</p>`
    : "";
  return (
    `<div class="proj-row"><div>${projectLink}` +
    `<span class="counts">${active} active · ${archived} archived</span>` +
    desc +
    drift +
    `</div>${remove}</div>`
  );
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
  name: string,
  opts: ProjectPageOptions,
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
  const codeLanding = opts.codeLanding ?? "merge";
  const path = projectPagePath(name);
  const choices: { value: "merge" | "pr"; label: string }[] = [
    { value: "merge", label: "Merge into the default branch" },
    { value: "pr", label: "Leave it for a pull request" },
  ];
  const editable =
    `<div class="project-settings-values">` +
    `<p><span class="label">Specs root</span> ${esc(opts.specsPath || "its own specs/")} ` +
    `<span class="muted">This machine's .aide/config.</span></p>` +
    `<p><span class="label">Worktree links</span> ${esc(opts.worktreeLinks || "–")} ` +
    `<span class="muted">Gitignored paths linked into each run's worktree.</span></p>` +
    `<p><span class="label">Code landing</span> ${esc(choices.find((o) => o.value === codeLanding)!.label)} ` +
    `<span class="muted">What happens to code when a spec is archived.</span></p></div>`;
  const editor =
    `<details class="project-settings-editor"${opts.error ? " open" : ""}>` +
    `<summary class="btn primary">Edit</summary>` +
    (opts.error ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) : "") +
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/settings" class="newspecform">` +
    tokenField(opts.token) +
    `<span class="frow">` +
    field("Specs root", `<input type="text" name="specsPath" maxlength="300" value="${esc(opts.specsPath ?? "")}" placeholder="its own specs/ when empty">`, { wide: true }) +
    `</span><span class="frow">` +
    field(
      "Worktree links",
      `<input type="text" name="worktreeLinks" maxlength="300" value="${esc(opts.worktreeLinks ?? "")}" ` +
        (opts.worktreeLinkCandidates.length ? `list="wtlinks" ` : "") +
        `placeholder="gitignored paths a run must link in: node_modules .venv">` +
        (opts.worktreeLinkCandidates.length
          ? `<datalist id="wtlinks">${opts.worktreeLinkCandidates.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>`
          : ""),
      { wide: true },
    ) +
    `</span><span class="frow">` +
    field(
      "Code landing",
      `<select name="codeLanding">${choices.map((o) => `<option value="${o.value}"${codeLanding === o.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`,
      { wide: true },
    ) +
    `<span class="factions">${btn({ label: "Save", variant: "primary", pending: "saving…" })}` +
    `<a class="btn" href="${esc(path)}">Cancel</a></span></span>` +
    messageSlot("refused") +
    `</form></details>`;
  return `<h3>Settings</h3>` + noFile + editable + editor + settingsTable(settings) + checks;
}

export interface ProjectPageOptions {
  token?: string;
  script?: string;
  specsPath?: string;
  worktreeLinks?: string;
  codeLanding?: "merge" | "pr";
  worktreeLinkCandidates: string[];
  error?: string;
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
  opts: ProjectPageOptions,
): string {
  const actions = `<div class="project-actions"><a class="btn" href="${PROJECTS_ROUTE}">← Back</a></div>`;
  const body = actions + runConfigurationBlock(settings, readiness, p.name, opts);
  return pageShell(p.name, nav, projectPagePath(p.name), body, generatedAt, undefined, { script: opts.script });
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
    /** Where a project's NAME goes: the page the server serves for it,
     *  which is the one carrying the settings and the readiness answer
     *  (spec 185). There is no other project page to link — the
     *  generated per-project files went on 2026-08-22. */
    pageHref: (name: string) => string;
    removeHref?: (name: string) => string | undefined;
    /** Spec 142: what to say on a project's row about its checkout, if
     *  anything. A callback like `removeHref`, and for the same reason:
     *  `ProjectView` is a pure disk scan the static generator shares,
     *  and a live git answer does not belong on it. */
    note?: (name: string) => string | undefined;
  },
): string {
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  return (
    ordered
      .map((p) =>
        overviewRow(
          p,
          opts.pageHref(p.name),
          opts.removeHref?.(p.name),
          opts.note?.(p.name),
        ),
      )
      .join("\n")
  );
}

export function renderSite(_projects: ProjectView[], generatedAt: string): Page[] {
  const entries = navEntries();

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
  // A page per project was written here until 2026-08-22. The server
  // serves one now (spec 185) — the one with the settings and the
  // readiness answer on it, reached from the Projects page — and a
  // frozen copy beside it was a second page with the same name, one
  // tab away from the live one and always a little out of date. The
  // overview above went the same way at spec 115 and is a redirect.
  return pages;
}
