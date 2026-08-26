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
} from "../../../src/render.ts";

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
    // The word "Projects" is said once, in the tab (2026-08-21): the
    // shell's <h1> is hidden and the <h2> over the list is gone. What
    // opens the list now is the counts, beside the Add button.
    expect(html).not.toContain("<h2>Projects</h2>");
    expect(html).toContain('class="summary"');
    expect(html).toContain('class="proj-row"');
    // The served page links the page it serves. The generated site
    // still links its own files — `projectListBody` without `pageHref`.
    expect(html).toContain('href="/projects/alpha"');
    expect(html).toContain('href="/projects/beta"');
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
    expect(html).not.toContain("<h1>Projects</h1>");
  });
});

// Spec 142: code merged outside the dashboard never runs the project's
// AIDE_INSTALL_CMD, so the serving host keeps serving the old version
// and nothing says so. The banner is the saying-so: on the row, on
// every load, for as long as the drift lasts.

describe("the drift banner on /projects", () => {
  // The page renders at AT, so that is "now" for every freshness label
  // below — the render function has no clock of its own, and one
  // passed separately would be a second answer to the same question.
  const NOW = Date.parse(AT);
  /** An answer taken `secs` before the page was drawn. */
  const checkedAgo = (behind: number | null, secs: number) => ({
    behind,
    checkedAt: NOW - secs * 1000,
  });

  test("a project behind origin says so on its own row, and says how far", () => {
    const html = page([project("aide"), project("atlasaurus")], {
      driftByProject: { aide: checkedAgo(3, 240) },
    });
    expect(html).toContain("3 commits behind origin, checked 4 min ago — deploy is a hand step");
    // On aide's row, not floating above the list where a reader has to
    // work out which project it is about.
    expect(html).toMatch(/aide[\s\S]*?3 commits behind origin[\s\S]*?atlasaurus/);
    expect(html).toContain('class="rowmsg warn"');
  });

  test("one commit behind is one commit, not 1 commits", () => {
    expect(page([project("aide")], { driftByProject: { aide: checkedAgo(1, 240) } })).toContain(
      "1 commit behind origin, checked 4 min ago — deploy is a hand step",
    );
  });

  // Spec 203: the answer comes off a background schedule now, so how
  // OLD it is decides how much of it to believe. The label is plain
  // text, not `relTime`'s <span>: this note is escaped on its way out.
  test("the freshness label is the note's own words, not markup", () => {
    const html = page([project("aide")], { driftByProject: { aide: checkedAgo(2, 3 * 86400) } });
    expect(html).toContain("2 commits behind origin, checked 3 d ago — deploy is a hand step");
    expect(html).not.toContain("&lt;span");
  });

  test("an answer taken seconds ago says just now", () => {
    expect(page([project("aide")], { driftByProject: { aide: checkedAgo(2, 5) } })).toContain(
      "2 commits behind origin, checked just now — deploy is a hand step",
    );
  });

  // Spec 203: gated for the check, but the background poll has not
  // answered for it yet — a fresh boot, or a project just added. The
  // row says so rather than showing a count nobody has taken.
  test("a project the poll has not reached yet says the drift is unchecked", () => {
    const html = page([project("aide")], {
      driftByProject: { aide: { behind: null, checkedAt: null } },
    });
    expect(html).toContain("origin drift not checked yet");
    expect(html).not.toContain("behind origin");
  });

  // Asked and unanswerable is not the same row as never asked: the
  // fail-open rule says a banner nobody can trust is worse than none.
  test("a check that could not answer leaves the row silent", () => {
    const html = page([project("aide")], { driftByProject: { aide: checkedAgo(null, 60) } });
    expect(html).not.toContain("behind origin");
    expect(html).not.toContain("not checked yet");
  });

  test("a checkout level with origin gets no banner", () => {
    const html = page([project("aide")], { driftByProject: { aide: checkedAgo(0, 60) } });
    expect(html).not.toContain("behind origin");
    expect(html).not.toContain("not checked yet");
  });

  test("a project the drift map does not name gets no banner at all (criteria 1 and 3)", () => {
    const html = page([project("aide"), project("atlasaurus")], {
      driftByProject: { aide: checkedAgo(2, 60) },
    });
    expect(html).not.toMatch(/atlasaurus[\s\S]*?behind origin/);
    // Absent from the map is not gated for the check — it says nothing,
    // where a gated-but-unchecked project says so.
    expect(html).not.toMatch(/atlasaurus[\s\S]*?not checked yet/);
  });

  test("with no drift at all the page is exactly what it was", () => {
    expect(page([project("aide")], {})).not.toContain("behind origin");
    expect(page([project("aide")], { driftByProject: {} })).not.toContain("behind origin");
  });

  // A project whose manifest will not parse is already an error row —
  // it is still a checkout that can fall behind, and losing the banner
  // there would hide drift on exactly the project someone is fixing.
  test("an unparseable manifest still gets its banner", () => {
    const html = page([{ name: "brokenproj", manifest: { ok: false, error: "YAML parse error" }, specs: [] }], {
      driftByProject: { brokenproj: checkedAgo(7, 5) },
    });
    expect(html).toContain("7 commits behind origin, checked just now");
  });
});

// Spec 259: a project's own recurring jobs get a "next scheduled run"
// badge on its overview row, following the drift banner's own pattern
// — read off what was passed in, no clock or network of the render's
// own.
describe("the next-scheduled-run badge on /projects (spec 259)", () => {
  test("a project with a schedule entry shows its next fire time", () => {
    const html = page([project("aide")], {
      scheduleByProject: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" }] },
    });
    // AT is 2026-08-19T00:00:00Z; the next 3am UTC fire is the same day.
    expect(html).toContain("next scheduled run 2026-08-19T03:00:00.000Z");
  });

  test("the soonest of several entries is the one shown", () => {
    const html = page([project("aide")], {
      scheduleByProject: {
        aide: [
          { name: "weekly", cron: "0 4 * * 0", prompt: "docs/weekly.md" },
          { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md" },
        ],
      },
    });
    expect(html).toContain("next scheduled run 2026-08-19T03:00:00.000Z");
    expect(html).not.toContain("next scheduled run 2026-08-2");
  });

  test("a project the schedule map does not name gets no badge", () => {
    expect(page([project("aide")], { scheduleByProject: {} })).not.toContain("next scheduled run");
    expect(page([project("aide")], {})).not.toContain("next scheduled run");
  });
});


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

// --- spec 140: the help the form had, and the help it did not ----------------
describe("the Add page helps with what it cannot decide (spec 140)", () => {
  const add = (opts: Partial<ProjectsPageOptions> = {}) => renderAddProjectPage(NAV, AT, opts);

  // Criterion 6. The candidates are read from the offered checkouts'
  // own `.gitignore` files by the server — a suggestion list on the
  // field, working with no script at all, because every control on this
  // page does.
  test("gitignored paths from the host's checkouts are offered on the Worktree links field", () => {
    const html = add({
      existingCheckouts: ["skjer"],
      worktreeLinkCandidates: ["node_modules", ".venv"],
    });
    expect(html).toContain("<datalist");
    expect(html).toContain('<option value="node_modules">');
    expect(html).toContain('<option value=".venv">');
    // Wired to the input, or the list is a list of nothing.
    const list = html.match(/<datalist id="([^"]+)"/)![1]!;
    expect(html).toContain(`name="worktreeLinks"`);
    expect(html).toMatch(new RegExp(`name="worktreeLinks"[^>]*list="${list}"`));
  });

  test("no candidates means no empty datalist hanging off the field", () => {
    expect(add({ existingCheckouts: ["skjer"] })).not.toContain("<datalist");
  });

  // Criterion 7. A project's name IS its directory name, so the field
  // carries a real choice only when the directory is about to be made
  // — the clone. Saying so is what stops a reader typing a name that
  // differs from the checkout they picked.
  test("the Name field says it only settles anything for a clone", () => {
    expect(add()).toContain("only when cloning from a Git URL");
  });
});

// Criterion 11: the readiness note is computed on every visit, not shown
// once after Add and then lost. Without this, an operator who did not
// act on it immediately had no way to rediscover what was missing short
// of starting a run and having it refused.
describe("the list says which projects cannot run yet (spec 184)", () => {
  test("a project that cannot run carries its note without a Settings action", () => {
    const html = page([project("skjer")], {
      createProjects: ["skjer"],
      readinessByProject: {
        skjer: { canRun: false, note: "skjer cannot run yet: no specs root at /repos/specs/skjer" },
      },
    });
    expect(html).toContain("no specs root at /repos/specs/skjer");
    expect(html).not.toContain('href="/projects/skjer/settings"');
  });

  test("a project that can run carries neither a note nor a Settings action", () => {
    const html = page([project("skjer")], {
      createProjects: ["skjer"],
      readinessByProject: { skjer: { canRun: true, note: "skjer is ready to run" } },
    });
    expect(html).not.toContain("ready to run");
    expect(html).not.toContain('href="/projects/skjer/settings"');
  });

  // The generated site has no server behind it to check a token
  // against, so it carries no controls at all — the same reason its rows
  // have no Remove.
  test("a project nothing was assessed for is drawn exactly as before", () => {
    const html = page([project("skjer")], { createProjects: ["skjer"] });
    expect(html).not.toContain("cannot run");
  });
});

// --- spec 184: the Add form proposes rather than blanks ----------------------
//
// The fields were always blank, and the reader had to go and look up
// both answers — a lockfile for one, the other projects' layout for the
// other. Both are worked out by the server now and offered as the
// field's own value, still fully editable.
describe("the Add page proposes what it can work out (spec 184)", () => {
  const add = (opts: Partial<ProjectsPageOptions> = {}) => renderAddProjectPage(NAV, AT, opts);

  const value = (html: string, name: string): string | null =>
    html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))?.[1] ?? null;

  // Criteria 5 and 10. Exactly one checkout on offer is the only case
  // the page can pre-fill for with no script: with several, nothing has
  // been picked yet, and a value filled in for one of them would be a
  // claim about which.
  test("one offered checkout has its proposals filled in", () => {
    const html = add({
      existingCheckouts: ["skjer"],
      proposalsByCheckout: { skjer: { specsPath: "/repos/aide-specs/skjer", worktreeLinks: "node_modules" } },
    });
    expect(value(html, "worktreeLinks")).toBe("node_modules");
    expect(value(html, "specsPath")).toBe("/repos/aide-specs/skjer");
  });

  // Criterion 6, rendered: a proposal that could not be made is a blank
  // field, never a guess.
  test("a proposal that could not be made leaves the field empty", () => {
    const html = add({
      existingCheckouts: ["skjer"],
      proposalsByCheckout: { skjer: { specsPath: "", worktreeLinks: "node_modules" } },
    });
    expect(value(html, "worktreeLinks")).toBe("node_modules");
    expect(value(html, "specsPath")).toBeNull();
  });

  test("several checkouts on offer pre-fill nothing, because nothing is picked yet", () => {
    const html = add({
      existingCheckouts: ["skjer", "atlasaurus"],
      proposalsByCheckout: {
        skjer: { specsPath: "/repos/aide-specs/skjer", worktreeLinks: "node_modules" },
        atlasaurus: { specsPath: "/repos/aide-specs/atlasaurus", worktreeLinks: ".venv" },
      },
    });
    expect(value(html, "worktreeLinks")).toBeNull();
    expect(value(html, "specsPath")).toBeNull();
    // But the proposals ARE on the page, for the pick to fill in.
    expect(html).toContain("data-proposals");
    expect(html).toContain("atlasaurus");
  });

  // A project not on this host yet has no lockfile to read, so there is
  // nothing to propose from — the clone has not happened.
  test("a page with no checkouts on offer proposes nothing at all", () => {
    const html = add();
    expect(value(html, "worktreeLinks")).toBeNull();
    expect(value(html, "specsPath")).toBeNull();
    expect(html).not.toContain("data-proposals");
  });
});
