// Split out of projects-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderAddProjectPage,
  renderRemoveProjectPage,
  type ProjectsPageOptions,
} from "../../../src/render.ts";
import { AT, NAV, page, project } from "./projects-page-fixtures.ts";

// --- the Add and Remove controls (2026-08-19: pages of their own) ------------
//
// The panel used to be a fold at the bottom of this page, whose opener
// was the bare word "Projects". Now Add is a real button at the top
// right of the list opening a page with Save and Cancel, and each
// allowlisted row carries its own Remove linking to a confirm page.

describe("the Add button and the Remove links on /projects", () => {
  test("the project link marks the whole row while Remove stays a separate anchor", () => {
    const html = page([project("aide")], { createProjects: ["aide"] });
    expect(html).toContain('<a class="proj-row-link" href="/projects/aide">aide</a>');
    expect(html).toContain('<a class="btn small proj-row-action" href="/projects/aide/remove">Remove</a>');
  });

  test("Add is a button above the list, at the right — like New spec", () => {
    const html = page([project("aide")], { createProjects: ["aide"] });
    // One line above the list: the counts on the left, Add on the right
    // — the shape the spec list's filter row has. Add stood alone here
    // until 2026-08-21, between an <h1> and an <h2> that both said
    // "Projects", and read as floating between two titles.
    expect(html).toMatch(
      /<div class="listtop"><span class="summary">[^<]*<\/span><a class="btn primary" href="\/projects\/new">Add<\/a><\/div>/,
    );
    expect(html.indexOf('href="/projects/new"')).toBeLessThan(html.indexOf('class="proj-row"'));
    // The old fold is gone with its bare-word opener.
    expect(html).not.toContain('<details class="newspec projectadmin">');
    expect(html).not.toContain('action="/api/queue/projects"');
  });

  test("it is offered before there is a single project to list", () => {
    expect(page([], { createProjects: [] })).toContain('href="/projects/new"');
  });

  test("every allowlisted project's row carries its own Remove, at the right", () => {
    const html = page([project("aide"), project("atlasaurus")], {
      createProjects: ["aide", "atlasaurus"],
    });
    expect(html).toContain('href="/projects/aide/remove"');
    expect(html).toContain('href="/projects/atlasaurus/remove"');
    // On the row, after the row's own text.
    expect(html).toMatch(/atlasaurus[\s\S]*?<a class="btn small proj-row-action" href="\/projects\/atlasaurus\/remove">Remove<\/a>/);
  });

  test("a discovered project the allowlist does not know gets no Remove", () => {
    const html = page([project("aide"), project("stranger")], { createProjects: ["aide"] });
    expect(html).toContain('href="/projects/aide/remove"');
    expect(html).not.toContain('href="/projects/stranger/remove"');
  });
});

describe("the Add page", () => {
  const add = (opts: Partial<ProjectsPageOptions> = {}) =>
    renderAddProjectPage(NAV, AT, opts);

  test("the form asks for what cannot be derived, and posts to the project route", () => {
    const html = add();
    expect(html).toContain('action="/api/queue/projects"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="gitUrl"');
    expect(html).toContain('name="existingPath"');
    expect(html).toContain('name="specsPath"');
    expect(html).toContain('name="description"');
    // The same refusal slot the New-spec form has, and for the same
    // reason: a project that was never added has no row to land on.
    expect(html).toContain('class="refused rowmsg err"');
  });

  // Spec 252: the bottom Cancel beside Save is gone — the top-left
  // "← Back" is the one way out, at the destination Cancel used to be
  // hardcoded to (this page is reached only from the query-param-free
  // Projects list, so there is no state a dynamic Referer read would add).
  test("Save posts, and Back — not a bottom Cancel — is the one way out", () => {
    const html = add();
    expect(html).toContain(">Save</button>");
    expect(html).toContain('<a class="btn" href="/projects">← Back</a>');
    expect(html).not.toContain(">Cancel<");
  });

  test("it says the manifest it writes is minimal", () => {
    const html = add();
    expect(html).toContain("/aide-manifest");
    expect(html.toLowerCase()).toContain("minimal");
  });

  test("a refusal carried back in the query string is shown here", () => {
    expect(add({ error: "the name is already taken" })).toContain("the name is already taken");
  });

  // Spec 131: "…or a path on this host" asked for a path the reader had
  // no way to know — the server accepts exactly one, and it follows from
  // the projects root and the name. It picks from the host's own
  // manifest-less directories now, and it is still a real form control,
  // because this page works with no script at all.
  // Criterion 3.
  test("the checkouts already on the host are picked, not typed", () => {
    const html = add({ existingCheckouts: ["atlasaurus", "scratch"] });
    expect(html).toContain('<select name="existingPath">');
    expect(html).toContain('<option value="atlasaurus">atlasaurus</option>');
    expect(html).toContain('<option value="scratch">scratch</option>');
    expect(html).not.toContain('name="existingPath" maxlength');
    // Nothing picked stays representable, the way an empty box was.
    expect(html).toContain('<option value=""></option>');
  });

  // Criterion 4.
  test("no checkouts to offer is said in words, on a control that is still there", () => {
    const html = add({ existingCheckouts: [] });
    expect(html).toContain('name="existingPath"');
    expect(html).toContain("<select");
    expect(html).toContain("disabled");
    expect(html).toContain("no checkouts found under the projects root");
  });

  // Picking a checkout with Name left blank is a whole submission on its
  // own — a `required` Name would let no browser send it.
  test("Name is not required, because a pick settles it", () => {
    expect(add()).not.toContain('name="name" required');
  });
});

describe("the Remove page", () => {
  const remove = (name: string, opts: Partial<ProjectsPageOptions> = {}) =>
    renderRemoveProjectPage(name, NAV, AT, opts);

  test("it says what removal does and does not do, before the confirmation field", () => {
    // The form and the copy above it — not the shell, whose stylesheet
    // contains ":disabled" selectors of its own.
    const html = remove("atlasaurus").split("</style>").pop()!;
    const copy = html.slice(0, html.indexOf('name="confirm"'));
    expect(copy).toContain("allowlist");
    expect(copy.toLowerCase()).toContain("checkout");
    expect(copy.toLowerCase()).toContain("specs");
    // The typed confirmation is a real gate: the name has to be typed
    // back, the browser turns the button off until it matches
    // (`data-confirm`), and the server refuses a mismatch either way.
    // The button is rendered ENABLED on purpose — one the server
    // disabled could never be enabled again with script off.
    expect(html).toContain('data-confirm="atlasaurus"');
    expect(html).toContain('action="/api/queue/projects/atlasaurus/remove"');
    expect(html).not.toContain("disabled");
    // Spec 252: the bottom Cancel beside Remove is gone — the top-left
    // "← Back" is the one way out.
    expect(html).toContain('<a class="btn" href="/projects">← Back</a>');
    expect(html).not.toContain(">Cancel<");
  });

  // Spec 161 made every row action on the queue primary, Cancel
  // included, and left `danger` meaning exactly one thing on the whole
  // dashboard: an action a mistake cannot undo. Remove is that one, and
  // this is the guard that it was not swept up in the change.
  test("Remove keeps danger — it is the one thing that cannot be undone (spec 161)", () => {
    const html = remove("atlasaurus").split("</style>").pop()!;
    expect(html).toMatch(/<button[^>]*class="btn danger"[^>]*>/);
  });

  // Without the page's own code the typed confirmation is server-side
  // only and every refusal costs a page load.
  test("the pages carry the browser code the controls need", () => {
    expect(remove("aide", { script: "/*code*/" })).toContain("<script>/*code*/</script>");
    expect(renderAddProjectPage(NAV, AT, { script: "/*code*/" })).toContain("<script>/*code*/</script>");
  });

  // A no-JS form POST is answered with a redirect back here carrying the
  // reason. Nothing else on this page can show it: an Add names a
  // project that was never added, so there is no row for it to land on.
  test("a refusal carried back in the query string is shown", () => {
    const html = page([project("aide")], { createProjects: ["aide"], error: "the name is already taken" });
    expect(html).toContain("the name is already taken");
    expect(html).toContain('class="refusal rowmsg err"');
  });

  test("no banner when nothing was refused", () => {
    expect(page([project("aide")], { createProjects: ["aide"] })).not.toContain('class="refusal rowmsg err"');
  });
});
