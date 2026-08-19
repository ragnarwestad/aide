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

// --- the Projects panel, moved here from `/` (spec 112's tests) --------------

describe("the Projects panel on /projects", () => {
  /** The panel's markup, from its own disclosure to the end of it. */
  const panel = (html: string): string => {
    const at = html.indexOf('<details class="newspec projectadmin">');
    expect(at).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf("</details>", html.lastIndexOf("</form>")) + 10);
  };

  test("the Add form asks for what cannot be derived, and posts to the project route", () => {
    const form = panel(page([project("aide")], { createProjects: ["aide"] }));
    expect(form).toContain('action="/api/queue/projects"');
    expect(form).toContain('name="name"');
    expect(form).toContain('name="gitUrl"');
    expect(form).toContain('name="existingPath"');
    expect(form).toContain('name="specsPath"');
    expect(form).toContain('name="description"');
    // The same refusal slot the New-spec form has, and for the same
    // reason: a project that was never added has no row to land on.
    expect(form).toContain('class="refused rowmsg err"');
  });

  test("it is offered before there is a single project to list", () => {
    const form = panel(page([], { createProjects: [] }));
    expect(form).toContain('action="/api/queue/projects"');
  });

  test("the Add form says the manifest it writes is minimal", () => {
    const form = panel(page([project("aide")], { createProjects: ["aide"] }));
    expect(form).toContain("/aide-manifest");
    expect(form.toLowerCase()).toContain("minimal");
  });

  test("every allowlisted project has a Remove of its own", () => {
    const form = panel(page([], { createProjects: ["aide", "atlasaurus"] }));
    expect(form).toContain('action="/api/queue/projects/aide/remove"');
    expect(form).toContain('action="/api/queue/projects/atlasaurus/remove"');
    expect(form).toContain('data-confirm="atlasaurus"');
    expect(form).toContain('name="confirm"');
  });

  test("Remove says what it does and does not do, before the confirmation field", () => {
    const form = panel(page([], { createProjects: ["atlasaurus"] }));
    const said = form.slice(form.indexOf('action="/api/queue/projects/atlasaurus/remove"'));
    const copy = said.slice(0, said.indexOf('name="confirm"'));
    expect(copy).toContain("allowlist");
    expect(copy.toLowerCase()).toContain("checkout");
    expect(copy.toLowerCase()).toContain("specs");
    // The typed confirmation is a real gate: the name has to be typed
    // back, the browser turns the button off until it matches
    // (`data-confirm`), and the server refuses a mismatch either way.
    // The button is rendered ENABLED on purpose — one the server
    // disabled could never be enabled again with script off.
    expect(said).toContain('data-confirm="atlasaurus"');
    expect(said).not.toContain("disabled");
  });

  // Without the page's own code the typed confirmation is server-side
  // only and every refusal costs a page load. The panel had both on `/`;
  // moving it must not quietly take them away.
  test("the page carries the browser code the panel's controls need", () => {
    const html = page([project("aide")], { createProjects: ["aide"], script: "/*code*/" });
    expect(html).toContain("<script>/*code*/</script>");
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
