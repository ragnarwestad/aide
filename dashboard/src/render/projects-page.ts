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
import { projectListBody, type ProjectView } from "./site.ts";

/** Where a project is added (its own page, like `/new`), and where one
 *  is removed — the confirm page each row's Remove links to. */
export const ADD_PROJECT_ROUTE = "/projects/new";
export const removeProjectRoute = (name: string): string =>
  `/projects/${encodeURIComponent(name)}/remove`;

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
  /** Why the last attempt was refused, carried back in the query string
   *  after a no-JS form POST. Nothing on this page has a row for it to
   *  land on — an Add names a project that was never added — so it goes
   *  at the top, the way `/`'s spec-less refusals do. */
  error?: string;
}

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
    // The Add button above the list, at the right — the same place and
    // shape as New spec on the spec list.
    `<div class="listtop"><a class="btn primary" href="${ADD_PROJECT_ROUTE}">Add</a></div>\n` +
    // Remove rides on each row the allowlist knows — a discovered
    // project that was never allowlisted has nothing to be removed FROM.
    projectListBody(projects, {
      removeHref: (name) => (allowed.has(name) ? removeProjectRoute(name) : undefined),
    });
  // No meta refresh: a served page a reader may leave mid-thought needs
  // no blunt reload. The tagline rides on the tab here, the way it did
  // on the generated overview — this is still the page that is about
  // aide itself.
  return pageShell("Projects", entries, "/projects", body, generatedAt, undefined, {
    docTitle: "aide — from spec to merge",
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
    `<form method="post" action="/api/queue/projects" class="newspecform addprojectform">` +
    tokenField(opts.token) +
    `<span class="frow">` +
    field(
      "Name",
      `<input type="text" name="name" required maxlength="64" ` +
        `pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" ` +
        `placeholder="the directory it gets under the projects root">`,
    ) +
    field(
      "Git URL",
      `<input type="text" name="gitUrl" maxlength="300" placeholder="cloned under the projects root">`,
    ) +
    `</span>` +
    `<span class="frow">` +
    field(
      "…or a path on this host",
      `<input type="text" name="existingPath" maxlength="300" ` +
        `placeholder="a checkout that is already there">`,
    ) +
    field(
      "Specs root",
      `<input type="text" name="specsPath" maxlength="300" ` +
        `placeholder="optional — its own specs/ otherwise">`,
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
    docTitle: "aide — add project",
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
    docTitle: `aide — remove ${name}`,
    script: opts.script,
  });
}
