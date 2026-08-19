// The dashboard's Projects page: the listing every reader came for, and
// the two controls that change it.
//
// The listing is `site.ts`'s, unchanged — the generated overview drew
// exactly these rows until spec 115, and draws a redirect here now. What
// is new is that the page is SERVED, which is what the controls needed:
// adding and removing a project is a mutating action behind the queue's
// token, and a token has to be checked per request by a server. A
// generated file has none, which is why spec 112 put the panel on `/`
// instead — the one page that already had the guard, the refusal shape
// and the `postForm` machinery. `/projects` has all three now, and it is
// the page that LISTS what the panel changes.

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

export interface ProjectsPageOptions {
  /** Carried into every form on the page, for a browser that got here
   *  with the token in the address rather than in a cookie. */
  token?: string;
  /** Every project the queue may run — the RAW allowlist, which is what
   *  this page exists to change. Each one gets a Remove of its own. */
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

// The Projects panel (spec 112, moved here by spec 115). Adding a
// project used to be four hand steps on the serving host, one of which —
// the queue's allowlist — meant re-rendering the launchd plist and
// restarting the server.
//
// Shut by default: the reader came for the list, and changing it is the
// rarer errand.
function projectAdminPanel(opts: ProjectsPageOptions): string {
  // The RAW allowlist, exactly as the New-spec dropdown uses it: this
  // panel is about which projects the queue may run, which is what that
  // list IS. A project with no spec yet appears in no other list here.
  const projects = opts.createProjects ?? [];
  const add =
    `<form method="post" action="/api/queue/projects" class="newspecform addprojectform">` +
    tokenField(opts.token) +
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
    field(
      "Description",
      `<textarea name="description" rows="2" maxlength="500" ` +
        `placeholder="one line: what the project is"></textarea>`,
      { wide: true },
    ) +
    // The copy 1-description.md asks for, in the form itself rather
    // than in a doc nobody has open: what is written here is the least
    // a manifest can be, and the rest is a separate job.
    rowMessage(
      "info",
      "A minimal .aide/project.yaml is written — the name and this description, nothing else. " +
        "Run /aide-manifest in the project afterwards to fill in the stack, deployment and docs.",
      { tag: "p" },
    ) +
    btn({ label: "Add project", variant: "primary", pending: "adding…" }) +
    // Its refusal has no row to land on — the project was never added —
    // so it goes beside the form that was refused, like New spec's.
    messageSlot("refused") +
    `</form>`;
  const rows = projects
    .map(
      (name) =>
        `<form method="post" action="/api/queue/projects/${esc(name)}/remove" class="removeform">` +
        tokenField(opts.token) +
        `<span class="label">${esc(name)}</span>` +
        // What removal MEANS, before the field that does it — the
        // reader should not have to know the answer to read the form.
        rowMessage(
          "info",
          `Removing ${name} takes it off the allowlist and off this dashboard. ` +
            `Its checkout and its specs stay on disk, untouched.`,
          { tag: "p" },
        ) +
        typedConfirm({ target: name, label: "Type the name to remove it", button: "Remove", pending: "removing…" }) +
        messageSlot("refused") +
        `</form>`,
    )
    .join("");
  return (
    `<details class="newspec projectadmin"><summary>Projects</summary>` +
    add +
    rows +
    `</details>`
  );
}

export function renderProjectsPage(
  projects: ProjectView[],
  generatedAt: string,
  entries: NavEntry[],
  opts: ProjectsPageOptions,
): string {
  const body =
    // A refusal first, or it is read after the thing it refused.
    (opts.error ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    projectListBody(projects) +
    "\n" +
    projectAdminPanel(opts);
  // No meta refresh: this page carries forms, and a blunt refresh wipes
  // a half-typed git URL. The tagline rides on the tab here, the way it
  // did on the generated overview — this is still the page that is about
  // aide itself.
  return pageShell("Projects", entries, "/projects", body, generatedAt, undefined, {
    docTitle: "aide — from spec to merge",
    script: opts.script,
  });
}
