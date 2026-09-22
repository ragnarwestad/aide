// The dashboard's Projects page: the listing every reader came for, an
// Add button above it, and a Remove on every row — plus, still in this
// same file, the two build-time pages left of the old static
// generator: the `projects.html` redirect and the About page
// (`renderSite`).
//
// The listing (`projects-page/overview-list.ts`) is served now, not
// generated — the generated overview drew exactly these rows until
// spec 115, and draws a redirect here now, because adding and removing
// a project is a mutating action, which needs a server
// behind it. The controls follow the New-spec pattern
// (2026-08-19): Add is a real button at the top right of the list that
// opens a page of its own with Save and Cancel, and each project row
// carries its own Remove.
//
// Split by theme into projects-page/: types.ts (the view types),
// routes.ts (nav and paths), overview-list.ts (the `/projects` list
// rows), settings-table.ts (the project page's unified settings table)
// and project-page.ts (drift/deploy, readiness, schedule, and
// `renderProjectPage` itself — the served page that carries what a
// generated file could not: the config and readiness answer, without
// repeating the manifest, spec 238). `renderSite` — what is left of the
// static generator — stays here, beside the CRUD functions above.

import {
  backLink,
  btn,
  field,
  messageSlot,
  rowMessage,
  } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { t, type Language } from "../../../i18n";
import { navEntries, OVERVIEW_PAGE, PROJECTS_ROUTE, NEW_SPEC_ROUTE, projectPagePath } from "./routes.ts";
import { projectListBody, projectSummary } from "./overview-list.ts";
import { driftPrefix, renderProjectPage } from "./project-page.ts";
import {
  type ProjectDrift,
  type ProjectView,
  type Page,
  type SpecView,
  type ProjectPageOptions,
} from "./types.ts";
import { codeLandingChoices } from "./settings-table.ts";

export type { SpecView, ProjectView, Page, ProjectDrift, ProjectPageOptions };
export {
  navEntries,
  OVERVIEW_PAGE,
  PROJECTS_ROUTE,
  NEW_SPEC_ROUTE,
  projectPagePath,
  projectListBody,
  projectSummary,
  driftPrefix,
  renderProjectPage,
};

export function renderSite(_projects: ProjectView[], generatedAt: string): Page[] {
  const entries = navEntries();

  // The overview is served now (spec 115), because the controls that
  // change the project list need a server behind them and a file
  // has none. What is written HERE is the way
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
        // The query string comes along, so a bookmarked filter survives.
        script: `location.replace('${PROJECTS_ROUTE}' + location.search);`,
        // No request exists at generate time to read a language from
        // (spec 408) — this page is static output, permanently English.
        lang: "en",
      }),
    },
  ];
  // A page per project was written here until 2026-08-22. The server
  // serves one now (spec 185) — the one with the settings and the
  // readiness answer on it, reached from the Projects page — and a
  // frozen copy beside it was a second page with the same name, one
  // tab away from the live one and always a little out of date. The
  // overview above went the same way at spec 115 and is a redirect.
  return pages;
}

/** Where a project is added (its own page, like `/new`), and where one
 *  is removed — the confirm page each row's Remove links to. */
export const ADD_PROJECT_ROUTE = "/projects/new";
export const removeProjectRoute = (name: string): string =>
  `/projects/${encodeURIComponent(name)}/remove`;

export interface ProjectsPageOptions {
  /** Every project the queue may run — the RAW allowlist, which is what
   *  the Add and Remove pages exist to change. */
  createProjects?: string[];
  /** The page's browser code, compiled from `specs-client.ts` by the
   *  server: the typed-confirmation gate and the inline refusals. Every
   *  control works without it, one page load at a time. */
  script?: string;
  /** The directories under the projects root that carry no manifest yet
   *  — what "…or a path on this host" picks from (spec 131). Bare
   *  names: the pick settles the project's name as well as where it is,
   *  and the server resolves it against the same root. */
  /** Gitignored paths read off those checkouts' own `.gitignore` files
   *  (spec 140) — what the Worktree links field suggests. The union
   *  across every offered checkout, deduped: the field is filled in
   *  before anything is picked, so scoping the list to one of them
   *  would mean knowing which, and that is what script would be for. */
  worktreeLinkCandidates?: string[];
  /** Why the last attempt was refused, carried back in the query string
   *  after a no-JS form POST. Nothing on this page has a row for it to
   *  land on — an Add names a project that was never added — so it goes
   *  at the top, the way `/`'s spec-less refusals do. */
  error?: string;
  /** What an Add that SUCCEEDED had to say: whether a run can start in
   *  the project just added, and every reason it cannot (spec 138).
   *  Carried in the query string the same way a refusal is, because a
   *  browser with no script gets this answer by redirect and it would
   *  otherwise die in a response body nobody sees. */
  notice?: string;
  /** And whether that answer was a yes. It decides the look and nothing
   *  else: a project that CAN run must not be reported in the same
   *  colour as one that cannot. */
  noticeOk?: boolean;
  /** Whether a run could start in each project, recomputed per request
   *  (spec 184). The Add flow used to say this exactly once, in the
   *  query string of the redirect it landed on, and never again — so an
   *  operator who did not act on it there had no way to rediscover what
   *  was missing except by starting a run and having it refused. A
   *  project named by no key here gets no mark, which is what the
   *  generated page (no server, no git) shows.
   *
   *  Spec 369: the full sentence lives on the project's own Config tab
   *  — the list needs only whether a run can start, to gate the mark. */
  readinessByProject?: Record<string, boolean>;
  /** What the project is configured with today — the Settings page's
   *  two fields, pre-filled. Empty means empty: this page never guesses
   *  on a configured project's behalf. */
  specsPath?: string;
  worktreeLinks?: string;
  /** Whether this project's archived code merges into its default branch
   *  or waits on a pull request (spec 220). The third field on the same
   *  form, and the one whose answer is a policy rather than a path —
   *  which is why it is a picker with two named options and not a text
   *  box: there is no third answer to type. */
  codeLanding?: "merge" | "pr";
  /** What each offered checkout's two fields would be, worked out by the
   *  server (spec 184): its own lockfile for the links, the other
   *  projects' layout for the specs root. An empty string is a proposal
   *  that could not be made, and is rendered as a blank field rather
   *  than a guess.
   *
   *  Keyed by checkout because nothing is picked at the moment this page
   *  is drawn. With exactly one on offer the answer is unambiguous and
   *  goes straight into the fields, which is what makes the help work
   *  with no script at all; with several, the map rides on the form and
   *  the pick fills them in. */
  /** Spec 408. Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
}

export function renderProjectsPage(
  projects: ProjectView[],
  generatedAt: string,
  entries: NavEntry[],
  opts: ProjectsPageOptions,
): string {
  const allowed = new Set(opts.createProjects ?? []);
  const lang = opts.lang ?? "en";
  const body =
    // A refusal first, or it is read after the thing it refused.
    (opts.error ? rowMessage("failed", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    // And what a successful Add had to say. Never `failed`: the project IS
    // added either way, and the colour says only whether a run can
    // start — `waiting` where something still has to be done about it.
    (opts.notice
      ? rowMessage(opts.noticeOk ? "info" : "waiting", opts.notice, { hook: "notice", tag: "p" }) + "\n"
      : "") +
    // One line above the list: the counts on the left, Add on the right
    // — the same shape the spec list's filter row has, where its own
    // count sits beside New spec. Add used to stand alone here, between
    // an <h1> and an <h2> that both said "Projects", and read as
    // floating between two titles rather than sitting on the list
    // (2026-08-21).
    `<div class="listtop">${projectSummary(projects, lang)}` +
    `<a class="btn primary" href="${ADD_PROJECT_ROUTE}">${t(lang, "project.add")}</a></div>\n` +
    // Remove rides on each row the allowlist knows — a discovered
    // project that was never allowlisted has nothing to be removed FROM.
    projectListBody(projects, {
      pageHref: (name) => projectPagePath(name),
      removeHref: (name) => (allowed.has(name) ? removeProjectRoute(name) : undefined),
      lang,
      // Spec 369: the sentence itself lives on the Config tab now (moved
      // off the Health tab by spec 378) — the list carries only a link
      // to it, gated on the same answer the sentence used to be gated
      // on.
      warnHref: (name) =>
        opts.readinessByProject?.[name] === false ? `${projectPagePath(name)}?tab=config` : undefined,
    });
  // No meta refresh: a served page a reader may leave mid-thought needs
  // no blunt reload. The tagline rides on the tab here, the way it did
  // on the generated overview — this is still the page that is about
  // aide itself.
  // No heading: the tab says "Projects" and the page said it twice more
  // — an <h1> from the shell and an <h2> over the list (2026-08-21).
  // The spec list has hidden its own for the same reason since
  // 2026-08-19.
  return pageShell("Projects", entries, "/projects", body, generatedAt, undefined, {
    hideHeading: true,
    docTitle: "aide -board — from spec to merge",
    script: opts.script,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}

// The Add form, on a page of its own (asked for 2026-08-19, New spec as
// the pattern): Save queues the add and returns to the list, Cancel
// returns having done nothing. Both work with no script at all.
export function renderAddProjectPage(
  entries: NavEntry[],
  generatedAt: string,
  opts: ProjectsPageOptions,
): string {
  const body =
    backLink("/projects", "Add project") +
    (opts.error ? rowMessage("failed", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    // Where what this form collects is kept, before the form rather
    // than in a doc nobody has open. It says nothing about a project's
    // stack, deployment or docs: the dashboard neither asks for those
    // nor shows them anywhere, and a line sending a reader off to fill
    // them in belongs where something reads them.
    rowMessage(
      "info",
      "The dashboard keeps the name and the description in its own settings file — nothing is written " +
        "into the project's repository.",
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue/projects" class="newspecform addprojectform">` +
    `<span class="frow">` +
    field(
      "Name",
      // A project's name IS its directory name (spec 140), and here it
      // names the directory the clone is about to make.
      `<input type="text" name="name" maxlength="64" required ` +
        `pattern="[A-Za-z0-9][A-Za-z0-9._-]*" ` +
        `placeholder="the directory the clone makes under the projects root">`,
      { wide: true },
    ) +
    field(
      "Git URL",
      `<input type="text" name="gitUrl" maxlength="300" required placeholder="cloned under the projects root">`,
      { wide: true },
    ) +
    `</span>` +
    `<span class="frow">` +
    field(
      "Specs root",
      `<input type="text" name="specsPath" maxlength="300" ` +
        `placeholder="optional — its own specs/ otherwise">`,
      { wide: true },
    ) +
    // The same choice the project page's Edit offers, asked here so a
    // project that must never merge straight in does not spend its
    // first specs doing exactly that. Nothing is pre-selected: whether
    // code is reviewed before it lands is how a team works, and the
    // dashboard cannot know it. The server refuses an Add without it.
    field(
      "Code landing",
      `<select name="codeLanding" required>` +
        `<option value="" selected>Choose how code lands…</option>` +
        // `null`: the project is not cloned yet, so it HAS no branch
        // name to show. The project page names the real one.
        codeLandingChoices(null)
          .map((o) => `<option value="${o.value}">${esc(o.label)}</option>`)
          .join("") +
        `</select>`,
      { wide: true },
    ) +
    `</span>` +
    `<span class="frow">` +
    field(
      // Spec 138: a run works in a `git worktree`, which carries
      // TRACKED files only — so a project whose test command lives
      // behind a gitignored path fails in every run for a reason that
      // has nothing to do with its change. Nothing can derive which
      // paths those are, so the form asks.
      "Worktree links",
      // No suggestion list here, unlike the project page's own Edit: the
      // candidates are read from a checkout's `.gitignore`, and the
      // project being added has no checkout on this host yet.
      `<input type="text" name="worktreeLinks" maxlength="300" ` +
        `placeholder="optional — gitignored paths a run must link in: node_modules .venv">`,
      { wide: true },
    ) +
    `</span>` +
    `<span class="frow">` +
    field(
      "Description",
      `<textarea name="description" rows="2" maxlength="500" ` +
        `placeholder="one line: what the project is"></textarea>`,
      { wide: true },
    ) +
    `<span class="factions">` +
    btn({ label: "Save", variant: "primary", pending: "saving…" }) +
    `</span></span>` +
    messageSlot("refused") +
    `</form>`;
  return pageShell("Add project", entries, "/projects", body, generatedAt, undefined, {
    docTitle: "aide -board — add project",
    script: opts.script,
    hideHeading: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}

// The Remove confirmation, on a page of its own: what removal means,
// the typed confirmation, and a Cancel that does nothing. The server
// refuses a mismatched name either way — the page is the half that
// means nobody has to be refused to find out.
export function renderRemoveProjectPage(
  name: string,
  entries: NavEntry[],
  generatedAt: string,
  opts: ProjectsPageOptions,
): string {
  const body =
    backLink("/projects", `Remove ${name}`) +
    (opts.error ? rowMessage("failed", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    rowMessage(
      "info",
      `Removing ${name} takes it off the allowlist and off this dashboard. ` +
        `Its checkout and its specs stay on disk, untouched.`,
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/remove" class="newspecform removeform" ` +
      `data-overlay="${t(opts.lang ?? "en", "shell.overlayRemoving")}">` +
    rowMessage("waiting", `Are you sure you want to remove ${name}? This cannot be undone.`, {
      tag: "p",
    }) +
    `<span class="factions">` +
    btn({ label: "Remove", variant: "danger", pending: "removing…" }) +
    `<a class="btn" href="/projects">Cancel</a>` +
    `</span>` +
    messageSlot("refused") +
    `</form>`;
  return pageShell(`Remove ${name}`, entries, "/projects", body, generatedAt, undefined, {
    docTitle: `aide -board — remove ${name}`,
    script: opts.script,
    hideHeading: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}
