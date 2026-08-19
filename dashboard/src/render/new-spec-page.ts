// `/new`: the form that makes a spec, and nothing else on the page.
//
// It used to be a disclosure folded into the spec list — press "New
// spec" and the page unfolded under the button (spec 113 gave that
// summary the primary-button look). Pressing a primary button and
// having the page grow under it reads oddly, and there was no way out
// of the open form but pressing the same button again: no Cancel
// existed, because a toggle needs none.
//
// A page of its own answers both. The control on `/` is a plain link,
// this page is the whole form, and it has the two actions a form on its
// own page has to have: Create, which queues the job and returns to the
// list where the new spec's row shows its progress, and Cancel, which
// returns having done nothing. Both work with no script at all — a
// link and a form POST — and there is no `#jobrows` here for the
// five-second swap to reach for.
//
// Modelled on `projects-page.ts`, which is the other served page with
// real forms on it: same shell, same guard, same top-of-page refusal.

import { btn, field, messageSlot, phaseChip, phases, rowMessage, tokenField } from "./components.ts";
import { esc } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import type { QueueTarget } from "./queue-list.ts";

export interface NewSpecPageOptions {
  /** Carried into the form, for a browser that got here with the token
   *  in the address rather than in a cookie. */
  token?: string;
  /** Every project a spec may be CREATED in — the raw allowlist, not
   *  the discovered set. A project whose first spec this form exists to
   *  make has nothing on disk to be discovered from. Empty or absent
   *  and the page says so instead of drawing a form with an empty
   *  dropdown. */
  createProjects?: string[];
  /** Every active spec, across every project: what the new one may be
   *  made to build on. */
  targets?: QueueTarget[];
  /** The page's browser code, compiled from `queue-client.ts` by the
   *  server: the inline refusal and the Depends-on scoping. Everything
   *  here works without it, one page load at a time. */
  script?: string;
  /** Why the last attempt was refused, carried back in the query string
   *  after a no-JS form POST. It goes at the top: the spec it named was
   *  never made, so there is no row for it to land on. */
  error?: string;
}

// What the new spec builds on (spec 110). One chip per active spec,
// newest first — the number is the order a reader thinks in, and it is
// the reverse of `discoverProjects`'s ascending sort.
//
// The chip's own project rides on a WRAPPER, not on the chip: `phaseChip`
// ties its `data-` attribute to its form value, and the value here has
// to be the folder. A bare `<span>` with a data attribute needs no class,
// so the closed component vocabulary (`css-token-guard.test.ts`) is
// untouched.
//
// Every project's chips are rendered, and the browser scopes them to the
// chosen one (`queue-client.ts`). Without script they are all offered,
// and a cross-project pick is caught by the same server refusal that
// catches it from the API — the convenience is lost, the guard is not.
function dependsOnField(opts: NewSpecPageOptions): string {
  const specs = [...(opts.targets ?? [])].sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      -a.specFolder.localeCompare(b.specFolder, "en", { numeric: true }),
  );
  if (specs.length === 0) return "";
  return field(
    "Depends on",
    phases(
      specs
        .map(
          (t) =>
            `<span data-project="${esc(t.project)}">` +
            phaseChip({
              dataAttr: "data-depends",
              value: t.specFolder,
              label: t.specFolder,
              name: "dependsOn",
            }) +
            `</span>`,
        )
        .join(""),
    ),
    { group: true },
  );
}

// Three fields and nothing else. Everything a job can be tuned with —
// the model, the other repos, whether to stop for approval — belongs to
// running a spec, and this form does not run one: it makes a spec, which
// then appears as a row and is run from there like all the others.
//
// It posts a project NAME, a title and a description. What the spec ends
// up being CALLED is decided by `/aide-create` alone: nothing here, and
// nothing in `aide-run-spec`, computes a spec number or a folder slug.
function newSpecForm(opts: NewSpecPageOptions, projects: string[]): string {
  // Three lines, read top to bottom (asked for 2026-08-19): Project and
  // Depends on side by side, Title on a line of its own, Description
  // right under it with Create and Cancel at its right-hand side. Each
  // `.frow` is a full-width row inside the same wrapping flex the Add
  // form shares, so the shared `.newspecform` look is untouched.
  return (
    `<form method="post" action="/api/queue/create" class="newspecform">${tokenField(opts.token)}` +
    `<span class="frow">` +
    field(
      "Project",
      `<select name="project">` +
        projects.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("") +
        `</select>`,
    ) +
    dependsOnField(opts) +
    `</span>` +
    field(
      "Title",
      `<input type="text" name="title" maxlength="120" required ` +
        `placeholder="what the spec is about, in a few words">`,
      { wide: true },
    ) +
    `<span class="frow">` +
    field(
      "Description",
      `<textarea name="description" rows="4" maxlength="2000" required ` +
        `placeholder="the problem, and what you want instead"></textarea>`,
      { wide: true },
    ) +
    `<span class="factions">` +
    btn({ label: "Create", variant: "primary", pending: "creating…" }) +
    // Out, having done nothing. A plain link, so it needs no script and
    // cannot post: there is nothing for a Cancel to send.
    `<a class="btn" href="/">Cancel</a>` +
    `</span></span>` +
    // The slot a refusal is written into. A rejected create names a spec
    // that was never made, so there is no row for the reason to land on
    // the way there is for every other action. Empty until something
    // fills it (`.refused:empty` draws nothing).
    messageSlot("refused") +
    `</form>`
  );
}

export function renderNewSpecPage(
  entries: NavEntry[],
  generatedAt: string,
  opts: NewSpecPageOptions,
): string {
  const projects = opts.createProjects ?? [];
  const body =
    // A refusal first, or it is read after the thing it refused.
    (opts.error ? rowMessage("err", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    (projects.length
      ? newSpecForm(opts, projects)
      : // The link on `/` is simply not offered when there is nothing to
        // create in, but this page has an address of its own and can be
        // reached anyway — and an empty form with an empty dropdown
        // reads as a page that failed to load.
        `<p class="muted">No project on this machine may have a spec made in it yet. ` +
        `Add one on the Projects page first.</p>`);
  // `/` as the current path, not this page's own: the tab bar names the
  // two AREAS of the site, and making a spec is part of the spec list's
  // — the same answer `job-page.ts` gives for a job's detail page.
  //
  // No meta refresh, for the reason `/projects` has none: this page is
  // a form, and a blunt refresh wipes a half-typed description.
  return pageShell("New spec", entries, "/", body, generatedAt, undefined, {
    docTitle: "aide — new spec",
    script: opts.script,
  });
}
