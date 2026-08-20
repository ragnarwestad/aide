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

// --- spec 138: the field that was missing, and the answer that was ------------
// discarded
describe("the Add page says what a run will need (spec 138)", () => {
  const add = (opts: Partial<ProjectsPageOptions> = {}) => renderAddProjectPage(NAV, AT, opts);

  // A worktree carries TRACKED files only, so a project whose test
  // command lives behind a gitignored path — pytest in `.venv`, a suite
  // needing `node_modules` — fails in every run for a reason that has
  // nothing to do with its change. The form had no field for it at all.
  test("worktree links can be given when the project is added", () => {
    const html = add();
    expect(html).toContain('name="worktreeLinks"');
    expect(html).toContain("Worktree links");
  });

  test("a readiness result carried back after Save is shown on the list", () => {
    const html = page([project("skjer")], {
      createProjects: ["skjer"],
      notice: "skjer added — cannot run yet: the project tree is dirty (.aide/)",
    });
    expect(html).toContain("cannot run yet");
    expect(html).toContain(".aide/");
  });

  // Never in the colour of a refusal, and never in the same colour for
  // both answers: the project IS added either way.
  test("a project that can run is not drawn as a warning", () => {
    const yes = page([project("skjer")], {
      createProjects: ["skjer"],
      notice: "skjer added — ready to run",
      noticeOk: true,
    });
    expect(yes).toContain('class="notice rowmsg info"');
    const no = page([project("skjer")], {
      createProjects: ["skjer"],
      notice: "skjer added — cannot run yet: the tree is dirty",
    });
    expect(no).toContain('class="notice rowmsg warn"');
  });

  test("no notice, no banner", () => {
    expect(page([project("aide")], { createProjects: ["aide"] })).not.toContain("notice rowmsg");
  });
});
