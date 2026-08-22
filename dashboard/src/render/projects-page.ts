// The dashboard's Projects page: the listing every reader came for, an
// Add button above it, and a Remove on every row.
//
// The listing is `site.ts`'s, unchanged — the generated overview drew
// exactly these rows until spec 115, and draws a redirect here now. What
// is new is that the page is SERVED, which is what the controls needed:
// adding and removing a project is a mutating action behind the queue's
// token, and a token has to be checked per request by a server.
//
// The controls follow the New-spec pattern (2026-08-19): Add is a real
// button at the top right of the list that opens a page of its own with
// Save and Cancel, and each project row carries its own Remove — the
// old fold at the bottom of the page, whose opener was the bare word
// "Projects", hid both.

import {
  btn,
  field,
  messageSlot,
  rowMessage,
  tokenField,
  typedConfirm,
} from "./components.ts";
import { esc } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { projectListBody, projectPagePath, projectSummary, type ProjectView } from "./site.ts";

/** Where a project is added (its own page, like `/new`), and where one
 *  is removed — the confirm page each row's Remove links to. */
export const ADD_PROJECT_ROUTE = "/projects/new";
export const removeProjectRoute = (name: string): string =>
  `/projects/${encodeURIComponent(name)}/remove`;
/** And where its two settings are CHANGED (spec 184). Until this page
 *  existed the fields were on the Add form and nowhere else, so a
 *  project added without them could only be fixed by removing it and
 *  adding it again, or by editing a file in a terminal. */
export const projectSettingsRoute = (name: string): string =>
  `/projects/${encodeURIComponent(name)}/settings`;

export interface ProjectsPageOptions {
  /** Carried into every form on the page, for a browser that got here
   *  with the token in the address rather than in a cookie. */
  token?: string;
  /** Every project the queue may run — the RAW allowlist, which is what
   *  the Add and Remove pages exist to change. */
  createProjects?: string[];
  /** The page's browser code, compiled from `queue-client.ts` by the
   *  server: the typed-confirmation gate and the inline refusals. Every
   *  control works without it, one page load at a time. */
  script?: string;
  /** The directories under the projects root that carry no manifest yet
   *  — what "…or a path on this host" picks from (spec 131). Bare
   *  names: the pick settles the project's name as well as where it is,
   *  and the server resolves it against the same root. */
  existingCheckouts?: string[];
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
  /** How many commits each project's checkout is behind origin, for the
   *  ones that are (spec 142). A project merged from a laptop, the
   *  GitHub web UI or another machine ran no `AIDE_INSTALL_CMD`, so the
   *  serving host is still serving the old code — and until this said
   *  so, nothing did. Absent, empty, or naming a project by no key at
   *  all all mean the same thing: no banner. */
  driftByProject?: Record<string, number>;
  /** Whether a run could start in each project, recomputed per request
   *  (spec 184). The Add flow used to say this exactly once, in the
   *  query string of the redirect it landed on, and never again — so an
   *  operator who did not act on it there had no way to rediscover what
   *  was missing except by starting a run and having it refused. A
   *  project named by no key here gets no note, which is what the
   *  generated page (no server, no git) shows. */
  readinessByProject?: Record<string, { canRun: boolean; note: string }>;
  /** What the project is configured with today — the Settings page's
   *  two fields, pre-filled. Empty means empty: this page never guesses
   *  on a configured project's behalf. */
  specsPath?: string;
  worktreeLinks?: string;
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
  proposalsByCheckout?: Record<string, { specsPath: string; worktreeLinks: string }>;
}

/** What the row says. Spelled out here rather than at the call site so
 *  the count and its wording cannot drift apart. */
const driftNote = (behind: number): string =>
  `${behind} ${behind === 1 ? "commit" : "commits"} behind origin — deploy is a hand step`;

export function renderProjectsPage(
  projects: ProjectView[],
  generatedAt: string,
  entries: NavEntry[],
  opts: ProjectsPageOptions,
): string {
  const allowed = new Set(opts.createProjects ?? []);
  const body =
    // A refusal first, or it is read after the thing it refused.
    (opts.error ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    // And what a successful Add had to say. Never `err`: the project IS
    // added either way, and the colour says only whether a run can
    // start — `warn` where something still has to be done about it.
    (opts.notice
      ? rowMessage(opts.noticeOk ? "info" : "warn", opts.notice, { hook: "notice", tag: "p" }) + "\n"
      : "") +
    // One line above the list: the counts on the left, Add on the right
    // — the same shape the spec list's filter row has, where its own
    // count sits beside New spec. Add used to stand alone here, between
    // an <h1> and an <h2> that both said "Projects", and read as
    // floating between two titles rather than sitting on the list
    // (2026-08-21).
    `<div class="listtop">${projectSummary(projects)}` +
    `<a class="btn primary" href="${ADD_PROJECT_ROUTE}">Add</a></div>\n` +
    // Remove rides on each row the allowlist knows — a discovered
    // project that was never allowlisted has nothing to be removed FROM.
    projectListBody(projects, {
      pageHref: (name) => projectPagePath(name),
      removeHref: (name) => (allowed.has(name) ? removeProjectRoute(name) : undefined),
      // Settings on every row the served page draws, whether or not
      // anything is wrong: it is where the two fields live now, and a
      // control that appears only on a broken project is one nobody
      // knows is there.
      settingsHref: (name) => (opts.readinessByProject ? projectSettingsRoute(name) : undefined),
      note: (name) => {
        const behind = opts.driftByProject?.[name];
        const readiness = opts.readinessByProject?.[name];
        return [readiness && !readiness.canRun ? readiness.note : undefined, behind ? driftNote(behind) : undefined]
          .filter(Boolean)
          .join(" — ") || undefined;
      },
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
  // With exactly one checkout on offer the proposals are unambiguous and
  // go into the fields themselves — the one case a browser with no
  // script gets the help too. With several, nothing has been picked yet
  // and a value filled in for one of them would be a claim about which.
  const offered = opts.existingCheckouts ?? [];
  const proposals = opts.proposalsByCheckout ?? {};
  const only = offered.length === 1 ? proposals[offered[0]!] : undefined;
  const prefill = (field: "specsPath" | "worktreeLinks"): string => {
    const proposed = only?.[field] ?? "";
    return proposed ? `value="${esc(proposed)}" ` : "";
  };
  const body =
    (opts.error ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    // The copy 1-description.md asks for, before the form rather than
    // in a doc nobody has open: what is written here is the least a
    // manifest can be, and the rest is a separate job.
    rowMessage(
      "info",
      "A minimal .aide/project.yaml is written — the name and the description, nothing else. " +
        "Run /aide-manifest in the project afterwards to fill in the stack, deployment and docs.",
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue/projects" class="newspecform addprojectform"` +
    (Object.keys(proposals).length ? ` data-proposals="${esc(JSON.stringify(proposals))}"` : "") +
    `>` +
    tokenField(opts.token) +
    `<span class="frow">` +
    field(
      "Name",
      // Not `required`: picking a checkout with Name left blank is a
      // whole submission on its own, and a browser with no script would
      // refuse to send it. `pattern` does not gate an empty value on
      // its own, so nothing the pattern rejected is admitted here —
      // only the empty string, which the server still refuses when
      // nothing was picked either.
      `<input type="text" name="name" maxlength="64" ` +
        `pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" ` +
        // Spec 140: a project's name IS its directory name, so a Name
        // typed beside a picked checkout settles nothing — the pick
        // wins. The field carries a real choice on the clone path
        // alone, where it names the directory about to be made, and it
        // says so rather than letting a reader type a name that gets
        // quietly replaced.
        `placeholder="only when cloning from a Git URL — a picked checkout names itself">`,
    ) +
    field(
      "Git URL",
      `<input type="text" name="gitUrl" maxlength="300" placeholder="cloned under the projects root">`,
    ) +
    `</span>` +
    `<span class="frow">` +
    field(
      // Picked, never typed (spec 131): the server accepts exactly one
      // path for a given name, and it is the one it worked out itself.
      // A real `<select>`, because this page works with no script.
      "…or a path on this host",
      opts.existingCheckouts?.length
        ? `<select name="existingPath"><option value=""></option>` +
          opts.existingCheckouts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("") +
          `</select>`
        : `<select name="existingPath" disabled>` +
          `<option value="">no checkouts found under the projects root</option></select>`,
    ) +
    field(
      "Specs root",
      `<input type="text" name="specsPath" maxlength="300" ` +
        prefill("specsPath") +
        `placeholder="optional — its own specs/ otherwise">`,
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
      `<input type="text" name="worktreeLinks" maxlength="300" ` +
        prefill("worktreeLinks") +
        // Spec 140: nothing can derive WHICH gitignored paths a project's
        // commands need — but the checkout's own `.gitignore` names the
        // candidates, and the reader had to go and open it. A
        // `<datalist>` is a suggestion the browser offers and the reader
        // may ignore, and it needs no script, which every control on
        // this page manages without. Absent when there is nothing to
        // suggest: an empty list is a control that opens onto nothing.
        (opts.worktreeLinkCandidates?.length ? `list="wtlinks" ` : "") +
        `placeholder="optional — gitignored paths a run must link in: node_modules .venv">` +
        (opts.worktreeLinkCandidates?.length
          ? `<datalist id="wtlinks">` +
            opts.worktreeLinkCandidates.map((c) => `<option value="${esc(c)}">`).join("") +
            `</datalist>`
          : ""),
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
    `<a class="btn" href="/projects">Cancel</a>` +
    `</span></span>` +
    messageSlot("refused") +
    `</form>`;
  return pageShell("Add project", entries, "/projects", body, generatedAt, undefined, {
    docTitle: "aide -board — add project",
    script: opts.script,
  });
}

/** The Settings page (spec 184): the same two fields the Add form has,
 *  pre-filled with what the project is configured with, on a page a
 *  reader can reach at any time rather than only in the seconds after
 *  Add.
 *
 *  Deliberately the Add page's own shape — the same `field()` calls, the
 *  same `<datalist>` help, the same Save/Cancel pair — because it is
 *  literally the same two questions, asked of a project that already
 *  exists. Every control works with no script, as everything on these
 *  pages does. */
export function renderProjectSettingsPage(
  name: string,
  entries: NavEntry[],
  generatedAt: string,
  opts: ProjectsPageOptions,
): string {
  const body =
    (opts.error ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    rowMessage(
      "info",
      "The specs root is this machine's own and stays in .aide/config. The worktree links are the " +
        "project's, on any machine, and are written to .aide/project.yaml — which is committed, so a " +
        "clone on the next machine arrives already knowing them.",
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/settings" ` +
    `class="newspecform addprojectform">` +
    tokenField(opts.token) +
    `<span class="frow">` +
    field(
      "Specs root",
      `<input type="text" name="specsPath" maxlength="300" ` +
        `value="${esc(opts.specsPath ?? "")}" ` +
        `placeholder="its own specs/ when empty">`,
      { wide: true },
    ) +
    `</span>` +
    `<span class="frow">` +
    field(
      "Worktree links",
      `<input type="text" name="worktreeLinks" maxlength="300" ` +
        `value="${esc(opts.worktreeLinks ?? "")}" ` +
        (opts.worktreeLinkCandidates?.length ? `list="wtlinks" ` : "") +
        `placeholder="gitignored paths a run must link in: node_modules .venv">` +
        (opts.worktreeLinkCandidates?.length
          ? `<datalist id="wtlinks">` +
            opts.worktreeLinkCandidates.map((c) => `<option value="${esc(c)}">`).join("") +
            `</datalist>`
          : ""),
      { wide: true },
    ) +
    `<span class="factions">` +
    btn({ label: "Save", variant: "primary", pending: "saving…" }) +
    `<a class="btn" href="/projects">Cancel</a>` +
    `</span></span>` +
    messageSlot("refused") +
    `</form>`;
  return pageShell(`${name} settings`, entries, "/projects", body, generatedAt, undefined, {
    docTitle: `aide -board — ${name} settings`,
    script: opts.script,
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
    (opts.error ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    rowMessage(
      "info",
      `Removing ${name} takes it off the allowlist and off this dashboard. ` +
        `Its checkout and its specs stay on disk, untouched.`,
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue/projects/${esc(encodeURIComponent(name))}/remove" class="newspecform removeform">` +
    tokenField(opts.token) +
    `<span class="frow">` +
    typedConfirm({ target: name, label: "Type the name to remove it", button: "Remove", pending: "removing…" }) +
    `<a class="btn" href="/projects">Cancel</a>` +
    `</span>` +
    messageSlot("refused") +
    `</form>`;
  return pageShell(`Remove ${name}`, entries, "/projects", body, generatedAt, undefined, {
    docTitle: `aide -board — remove ${name}`,
    script: opts.script,
  });
}
