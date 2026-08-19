// Spec 115: `/projects` is a served page, and the Projects panel lives
// there. Spec 112 put the panel on `/` because the overview was a
// generated file with no server behind it to check a token against —
// once the overview IS served, that reason is gone, and the page that
// LISTS the projects is the page that changes the list.
//
// The panel's own tests moved here from render.test.ts with the panel:
// same markup, same questions, one page further along.
import { describe, expect, test } from "bun:test";
import {
  renderProjectsPage,
  renderAddProjectPage,
  renderRemoveProjectPage,
  type ProjectView,
  type ProjectsPageOptions,
} from "../src/render.ts";

const AT = "2026-08-19T00:00:00Z";
const NAV = [{ label: "Projects", path: "/projects" }];

function project(name: string, overrides: Partial<ProjectView> = {}): ProjectView {
  return { name, manifest: { ok: true, data: { name } }, specs: [], ...overrides };
}

const page = (projects: ProjectView[], opts: Partial<ProjectsPageOptions> = {}): string =>
  renderProjectsPage(projects, AT, NAV, opts);

describe("the listing on /projects", () => {
  // The same rows the generated overview drew, from the same function:
  // "same components" by construction, not by convention.
  test("one linked row per project, with its counts and description", () => {
    const html = page([
      project("alpha", {
        manifest: { ok: true, data: { name: "alpha", description: "the first one" } },
        specs: [
          { folder: "01-a", dir: "/x/01-a", archived: false, title: "A", description: null, dependsOn: [], status: null },
          { folder: "02-b", dir: "/x/archive/02-b", archived: true, title: "B", description: null, dependsOn: [], status: null },
        ],
      }),
      project("beta"),
    ]);
    expect(html).toContain('<h2>Projects</h2>');
    expect(html).toContain('class="proj-row"');
    expect(html).toContain('href="alpha.html"');
    expect(html).toContain('href="beta.html"');
    expect(html).toContain("the first one");
    expect(html).toContain("1 active · 1 archived");
    expect(html).toContain("2 projects · 1 active · 1 archived");
  });

  test("a manifest that failed to parse is an error row, not a missing one", () => {
    const html = page([{ name: "brokenproj", manifest: { ok: false, error: "YAML parse error at line 3" }, specs: [] }]);
    expect(html).toContain("YAML parse error at line 3");
    expect(html).toMatch(/class="[^"]*error[^"]*"/);
  });

  // The link 112 left behind pointed at `/` because the management was
  // there. It is here now, so the link has nothing to point at.
  test("no Manage projects link — the management IS this page", () => {
    expect(page([project("alpha")])).not.toContain("Manage projects");
  });

  test("it carries the nav — and no stamp: the build time lives on About now", () => {
    const html = page([project("alpha")]);
    expect(html).toContain("<nav");
    expect(html).not.toContain(AT);
    expect(html).toContain("<h1>Projects</h1>");
  });
});

// --- the Add and Remove controls (2026-08-19: pages of their own) ------------
//
// The panel used to be a fold at the bottom of this page, whose opener
// was the bare word "Projects". Now Add is a real button at the top
// right of the list opening a page with Save and Cancel, and each
// allowlisted row carries its own Remove linking to a confirm page.

describe("the Add button and the Remove links on /projects", () => {
  test("Add is a button above the list, at the right — like New spec", () => {
    const html = page([project("aide")], { createProjects: ["aide"] });
    expect(html).toContain('<div class="listtop"><a class="btn primary" href="/projects/new">Add</a></div>');
    expect(html.indexOf('href="/projects/new"')).toBeLessThan(html.indexOf("<h2>Projects</h2>"));
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
    expect(html).toMatch(/atlasaurus[\s\S]*?<a class="btn small" href="\/projects\/atlasaurus\/remove">Remove<\/a>/);
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

  test("Save and Cancel — Save posts, Cancel is a plain link to the list", () => {
    const html = add();
    expect(html).toContain(">Save</button>");
    expect(html).toContain('<a class="btn" href="/projects">Cancel</a>');
  });

  test("it says the manifest it writes is minimal", () => {
    const html = add();
    expect(html).toContain("/aide-manifest");
    expect(html.toLowerCase()).toContain("minimal");
  });

  test("a refusal carried back in the query string is shown here", () => {
    expect(add({ error: "the name is already taken" })).toContain("the name is already taken");
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
    expect(html).toContain('<a class="btn" href="/projects">Cancel</a>');
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
