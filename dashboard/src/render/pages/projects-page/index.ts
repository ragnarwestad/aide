// The dashboard's Projects page: the listing every reader came for, and
// an Add button above it.
//
// The listing (`projects-page/overview-list.ts`) is served, not
// generated — adding a project is a mutating action, which needs a
// server behind it. Add follows the New-spec pattern (2026-08-19): a real
// button at the top right of the list that opens a page of its own with
// Save and Cancel. Remove project is on the project's own Config tab.
//
// Split by theme into projects-page/: types.ts (the view types),
// routes.ts (nav and paths), overview-list.ts (the `/projects` list
// rows), settings-table.ts (the project page's unified settings table)
// and project-page.ts (drift/deploy, readiness, schedule, and
// `renderProjectPage` itself — the served page that carries the config
// and readiness answer, without repeating the manifest, spec 238).

import {
  backLink,
  btn,
  btnLink,
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
  type SpecView,
  type ProjectPageOptions,
} from "./types.ts";
import { SETTING_LABELS } from "../../../project/setting-labels.ts";
import { codeLandingChoices, previewFromChoices } from "./settings-table.ts";

export type { SpecView, ProjectView, ProjectDrift, ProjectPageOptions };
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

/** Where a project is added: its own page, like `/new`. */
export const ADD_PROJECT_ROUTE = "/projects/new";

export interface ProjectsPageOptions {
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
  /** Why the list has nothing to show: a board started with no projects
   *  root. Drawn at the top of the list. */
  error?: string;
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
  const lang = opts.lang ?? "en";
  const body =
    (opts.error ? rowMessage("failed", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    // One line above the list: the counts on the left, Add on the right
    // — the same shape the spec list's filter row has, where its own
    // count sits beside New spec. Add used to stand alone here, between
    // an <h1> and an <h2> that both said "Projects", and read as
    // floating between two titles rather than sitting on the list
    // (2026-08-21).
    `<div class="listtop">${projectSummary(projects, lang)}` +
    `${btnLink({ href: ADD_PROJECT_ROUTE, label: t(lang, "project.add"), variant: "primary" })}</div>\n` +
    // Remove project is on each project's own Config tab.
    projectListBody(projects, {
      pageHref: (name) => projectPagePath(name),
      lang,
      // Spec 369: the sentence itself lives on the Config tab now (moved
      // off the Health tab by spec 378) — the list carries only a link
      // to it, gated on the same answer the sentence used to be gated
      // on.
      warnHref: (name) =>
        opts.readinessByProject?.[name] === false ? `${projectPagePath(name)}?tab=config` : undefined,
    });
  // No reload of its own: a served page a reader may leave mid-thought needs
  // no blunt reload. The tagline rides on the tab here, the way it did
  // on the generated overview — this is still the page that is about
  // aide itself.
  // No heading: the tab says "Projects" and the page said it twice more
  // — an <h1> from the shell and an <h2> over the list (2026-08-21).
  // The spec list has hidden its own for the same reason since
  // 2026-08-19.
  return pageShell("Projects", entries, "/projects", body, generatedAt, {
    hideHeading: true,
    docTitle: "aide -board — from spec to merge",
    script: opts.script,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}

// The Add form, on a page of its own (asked for 2026-08-19, New spec as
// the pattern): Save adds the project and goes to its Config tab, Cancel
// returns having done nothing.
export function renderAddProjectPage(
  entries: NavEntry[],
  generatedAt: string,
  opts: ProjectsPageOptions,
): string {
  const body =
    backLink("/projects", "Add project") +
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
    `<form method="post" action="/api/queue/projects" class="pageform addprojectform">` +
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
      SETTING_LABELS.AIDE_SPECS_PATH,
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
    // How a spec's branch can be tried before it is merged. Starts on
    // `none`, what a manifest without the key already means; the Config
    // tab changes it later.
    field(
      "Try a branch",
      `<select name="previewFrom">` +
        previewFromChoices()
          .map((o) => `<option value="${o.value}"${o.value === "none" ? " selected" : ""}>${esc(o.label)}</option>`)
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
  return pageShell("Add project", entries, "/projects", body, generatedAt, {
    docTitle: "aide -board — add project",
    script: opts.script,
    hideHeading: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}
