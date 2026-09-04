// Split out of projects-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { renderAddProjectPage, type ProjectsPageOptions } from "../../../src/render.ts";
import { AT, NAV, page, project } from "./projects-page-fixtures.ts";

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
    expect(no).toContain('class="notice rowmsg waiting"');
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
describe("the list says which projects cannot run yet (spec 184, moved off the list by spec 369)", () => {
  test("a project that cannot run carries a warning mark, its own sibling element rather than nested inside the name link", () => {
    const html = page([project("skjer")], {
      createProjects: ["skjer"],
      readinessByProject: { skjer: false },
    });
    expect(html).toContain('class="proj-row-warn"');
    expect(html).toContain('href="/projects/skjer?tab=config"');
    expect(html).not.toContain('href="/projects/skjer/settings"');
    // Criterion 5/6: the mark is a sibling of .proj-row-link, not nested
    // inside it — the name link's own markup carries none of it.
    const nameLink = html.match(/<a class="proj-row-link"[^>]*>[^<]*<\/a>/)?.[0];
    expect(nameLink).toBeDefined();
    expect(nameLink).not.toContain("proj-row-warn");
  });

  test("a project that can run carries neither the mark nor a Settings action", () => {
    const html = page([project("skjer")], {
      createProjects: ["skjer"],
      readinessByProject: { skjer: true },
    });
    expect(html).not.toContain('class="proj-row-warn"');
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
