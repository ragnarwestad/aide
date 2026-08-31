import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderNewSpecPage,
  renderQueuePage,
  navEntries,
  renderSite,
  type QueuePageOptions,
} from "../../../src/render.ts";
import {
  external,
  project,
  generatedAt,
  site,
  byPath,
  NAV,
  detail,
  row,
} from "./fixtures.ts";


describe("nav (criterion 2)", () => {
  // The project pages are reached from the Projects page, not from the
  // nav: two lists of the same projects were one too many.
  test("the nav lists no project pages, and no Projects label", () => {
    for (const page of site) {
      expect(page.html).not.toContain('<li class="lbl">Projects</li>');
      // Spec 115: the entry points at the SERVED page, not at the file.
      expect(page.html).toContain('href="/projects"');
      expect(page.html).not.toMatch(/<nav>[\s\S]*href="goodproj.html"[\s\S]*<\/nav>/);
    }
  });

  // Criterion 9 (spec 115), at the source: one entry, retargeted at the
  // served page. `navFromSite()` in serve.ts is a SEPARATE fallback and
  // deliberately still answers `projects.html` — serve.test.ts holds
  // that half.
  test("the Projects entry points at the served page", () => {
    expect(navEntries()[0]).toEqual({ label: "Projects", path: "/projects" });
  });

  // Spec 163 gave the archive a tab of its own; spec 221 took it away
  // again, because every archived spec is a row on the Specs list now —
  // one chip away, with the same date, description, "not landed" mark
  // and search the tab had. Two places to read one thing is two places
  // to keep in step.
  test("the Archive entry is gone", () => {
    expect(navEntries().map((e) => e.label)).not.toContain("Archive");
    expect(navEntries().map((e) => e.path)).not.toContain("/archive");
  });

  // Two tabs since spec 119, three from spec 163 to spec 221, two
  // again, three from spec 272 (Schedule): the site has a Specs half,
  // a Projects half and a Schedule half. The project pages are still
  // the Projects page's business rather than tabs of their own, and
  // About left the bar for the "…" menu — it is not a half of the
  // site.
  test("the tabs are Specs, Projects and Schedule; the wordmark is still home", () => {
    for (const page of site) {
      const navHtml = page.html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
      const links = [...navHtml.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
        (m) => [m[2], m[1]],
      );
      expect(links).toEqual([["Specs", "/"], ["Projects", "/projects"], ["Schedule", "/schedule"]]);
      expect(page.html).toContain('<a class="brand" href="/">');
    }
  });

  // Every generated page is a Projects page: the overview, the About
  // page's siblings and one page per project. None of them is the spec
  // list, so Specs is never the current tab here.
  test("exactly one current tab, and on a generated page it is Projects", () => {
    for (const page of site) {
      const navHtml = page.html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
      const currents = [...navHtml.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)];
      // About has no tab of its own — it is reached through the menu.
      const expected = page.path === "about.html" ? [] : ["Projects"];
      expect(currents.map((m) => m[1])).toEqual(expected);
    }
  });
});

// Spec 107. The three choices are not a page to go to, so they are not
// tabs. Spec 119 put them behind the "…" menu; spec 243 moved them back
// OUT, into the header itself — first as three bare icon buttons, then
// (same spec, revised 2026-08-25 against PaceUp's own header) behind a
// popup of their own, ".menu.theme", a sibling of the "…" one rather
// than a row inside it or three buttons loose in the header.
describe("the theme choice in the header (specs 107, 119, 243)", () => {
  const header = (html: string) => html.match(/<header>[\s\S]*?<\/header>/)![0];
  const menu = (html: string) => html.match(/<details class="menu">[\s\S]*?<\/details>/)![0];
  const themeMenu = (html: string) => html.match(/<details class="menu theme">[\s\S]*?<\/details>/)![0];

  test("every page offers Dark, Light and Auto, in the header's own popup, outside the … menu", () => {
    for (const page of site) {
      const m = menu(page.html);
      const t = themeMenu(page.html);
      const choices = [
        ...t.matchAll(/data-theme-choice="([^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>[\s\S]*?<\/button>/g),
      ].map((x) => [x[1], x[2]]);
      expect(choices).toEqual([["dark", "Dark"], ["light", "Light"], ["auto", "Auto"]]);
      expect(m).not.toContain("data-theme-choice");
    }
  });

  test("the choices are buttons, not links — they go nowhere", () => {
    const h = header(site[0]!.html);
    expect(h).toMatch(/<button type="button" data-theme-choice="dark"/);
    expect(h).not.toMatch(/<a[^>]*data-theme-choice/);
  });

  test("Auto is marked as chosen, because the server cannot know better", () => {
    for (const page of site) {
      const h = header(page.html);
      const marked = [...h.matchAll(/data-theme-choice="([^"]+)"[^>]*aria-current=/g)].map(
        (x) => x[1],
      );
      expect(marked).toEqual(["auto"]);
      // `aria-current`, never `class="current"`: that class means "the
      // page you are on", and the theme control is not a page.
      expect(h).not.toMatch(/<button[^>]*class="current"/);
    }
  });
});

// Spec 115: the listing itself moved to the SERVED `/projects`, where
// the panel that changes the list can sit beside it. What the generator
// still writes at this filename is a redirect — the file has to keep
// existing (`rsync-publish.sh` will not publish a site without it, and
// people have bookmarked it), but the reader belongs on the served page.
// The listing's own tests went with it, to projects-page.test.ts.
describe("the generated overview is a redirect to /projects", () => {
  const index = byPath.get("projects.html")!;

  test("it sends the reader on, keeping whatever the address carried", () => {
    expect(index).toContain("location.replace('/projects' + location.search)");
  });

  // The script is the fast path, not the only one: a browser with
  // JavaScript off, or a folder opened without a server, still has
  // something to click.
  test("a plain link too, for a reader the script never reaches", () => {
    expect(index).toContain('<a href="/projects">');
    expect(index.toLowerCase()).toContain("moved");
  });

  test("it lists nothing itself — that is the served page's job now", () => {
    expect(index).not.toContain('class="proj-row"');
    expect(index).not.toContain("2 projects · 1 active · 1 archived");
    expect(index).not.toContain("Manage projects");
    expect(index).not.toContain("<table");
  });

  test("it is still a page of the site, nav and all; the stamp lives on About", () => {
    expect(index).toContain("<nav");
    expect(index).not.toContain(generatedAt);
    expect(byPath.get("about.html")).toContain(generatedAt);
  });
});

// About opens as a DIALOG from the menu (asked for 2026-08-19): the
// markup rides on every page, the menu item opens it in place, and the
// about.html page below stays as the no-JS fallback its href points at.
describe("the About dialog", () => {
  test("every page carries the dialog, with a close cross", () => {
    for (const p of site) {
      expect(p.html).toContain('<dialog class="about">');
      expect(p.html).toContain('<button class="aboutclose" aria-label="Close">');
      // the platform's own close: no script once the box is open
      expect(p.html).toContain('<form method="dialog">');
    }
  });

  test("a static page's dialog carries the labelled build stamp", () => {
    expect(byPath.get("about.html")!.match(/Build: these static pages/g)!.length)
      .toBeGreaterThanOrEqual(1);
  });

  test("a served page's dialog carries no build stamp — it was not built", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", NAV, {
      runnerAvailable: true,
      targets: [],
    });
    expect(html).toContain('<dialog class="about">');
    expect(html).not.toContain("Build:");
  });
});

describe("the About page", () => {
  test("it is generated, and holds the explanation the front page lost", () => {
    const page = byPath.get("about.html");
    expect(page).toBeDefined();
    expect(page!).toContain("read-only overview");
    expect(page!).toContain("make publish");
  });

  test("every page links to it from the menu", () => {
    for (const p of site) {
      expect(p.html).toContain('href="about.html"');
    }
  });

  // Spec 119: About is reached from the "…" menu, so it has no tab of
  // its own and marks none of the two current.
  test("it is reached from the menu, and marks no tab current", () => {
    const page = byPath.get("about.html")!;
    const menu = page.match(/<details class="menu">[\s\S]*?<\/details>/)![0];
    expect(menu).toContain('<a href="about.html" data-about>About</a>');
    expect(page.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0]).not.toContain("aria-current");
  });

  // The nav lists one entry per PROJECT page. About is a page too, and
  // the server's fallback nav reads the site directory — so it must not
  // be mistaken for a project.
  test("it is not listed under Projects", () => {
    const page = byPath.get("about.html")!;
    const projects = page.slice(page.indexOf('class="nav-label"'));
    expect(projects).not.toContain('href="about.html"');
  });
});

describe("self-contained (criterion 5)", () => {
  test("no external references on any page", () => {
    for (const page of site) {
      expect(page.html).not.toContain("<script src");
      // The favicons are data URIs, so a <link> is fine — what this
      // test is about is a reference that needs a second request.
      //
      // Spec 173 added the only two that do, and they are named here
      // rather than allowed in general: a browser will not install a
      // page whose manifest is a data URI, so the manifest and iOS's
      // touch icon HAVE to be resources at a URL. `serve.ts` answers
      // both from memory. On a generated page opened from a folder
      // they find nothing at all, which is the same inert as the
      // `href="/"` that page's own nav already carries.
      expect(external(page.html)).toEqual(["/manifest.webmanifest", "/apple-touch-icon.png"]);
      expect(page.html).not.toMatch(/<img[^>]+src="https?:/);
    }
  });
});

// --- spec 115: the Projects panel left the front page ------------------------
//
// It was here because a generated file had no server behind it to check
// a token against (spec 112). `/projects` is served now, so the panel
// sits on the page that lists what it changes — and `/` is back to one
// panel above the list. Its own tests live in projects-page.test.ts.
describe("the front page after the panel moved", () => {
  const page = (opts: Partial<QueuePageOptions> = {}): string =>
    renderQueuePage([], "2026-08-18T00:00:00Z", [{ label: "Projects", path: "/projects" }], {
      runnerAvailable: true,
      targets: [],
      ...opts,
    });

  test("no Projects disclosure under New spec", () => {
    const html = page({ createProjects: ["aide", "atlasaurus"] });
    // The MARKUP, not the word: the stylesheet is inlined into every
    // page and still carries the panel's rules, for the page that has it.
    expect(html).not.toContain('<details class="newspec projectadmin">');
    expect(html).not.toContain('action="/api/queue/projects"');
    expect(html).not.toContain('action="/api/queue/projects/aide/remove"');
  });

  // Spec 289 folded the state chips into one dropdown inside
  // `.specsearch`, so there is one filter row now, not "either" of two.
  test("the state dropdown rides before New spec, inside the one search row", () => {
    const assertOrder = (html: string) => {
      // From the list container on, not from 0: the inlined stylesheet
      // mentions data-filter="state" too (the mobile filter-bar rules,
      // 2026-08-24), and an indexOf from the top finds the CSS text
      // long before the markup.
      const jobrows = html.indexOf('<div id="jobrows">');
      const filters = html.indexOf('data-filter="state"', jobrows);
      const help = html.indexOf('<details class="intro"', jobrows);
      const newSpec = html.indexOf('href="/new"', jobrows);
      const table = html.indexOf("<table", jobrows);
      expect(filters).toBeGreaterThan(jobrows);
      expect([filters, help, newSpec, table]).toEqual(
        [...[filters, help, newSpec, table]].sort((a, b) => a - b),
      );
    };

    assertOrder(page({ createProjects: ["aide"] }));
    assertOrder(
      renderQueuePage(
        [row(), row({ id: "job-2", project: "atlasaurus", specFolder: "12-other" })],
        "2026-08-18T00:00:00Z",
        [{ label: "Projects", path: "/projects" }],
        { runnerAvailable: true, targets: [], createProjects: ["aide"] },
      ),
    );
  });

  // Spec 261 moved the "?" and New spec onto the search field's own
  // row (`.specsearch`), so this is the scope the margin rule now has
  // to name — the old `#jobrows > .row:first-child` selector named the
  // chips' row, which no longer holds either control. Spec 289 removed
  // that row entirely, so `.specsearch` is `#jobrows`'s own first child
  // now. New spec itself carries the auto margin (moved off the "?"
  // popover so the popover could sit right after Search instead), and
  // the clear-air margin rule is scoped to `.specsearch` alone, not
  // `#jobrows`, since `/schedule` uses the same form with no `#jobrows`
  // of its own.
  test("New spec owns the automatic margin that keeps both controls at the right", () => {
    const html = page({ createProjects: ["aide"] });
    expect(html).toContain(".specsearch > .btn.primary { margin-left: auto; }");
    expect(html).not.toContain(
      "#jobrows > .row:first-child > .btn { margin-left: auto; }",
    );
    expect(html).toContain(".specsearch:first-child { margin: var(--sp-3) 0; }");
    expect(html).not.toContain("#jobrows > .row:first-child { margin: var(--sp-3) 0; }");
  });

  test("the nav takes the reader to the page that manages them", () => {
    expect(page()).toContain('href="/projects"');
  });
});
// --- spec 150: the job page's Overview, cut to what is said nowhere else -----
//
// The Overview's labelled list repeated the heading (Project, Spec), the
// pips (Step) and the row (Work), and then a "Live right now" panel
// answered `State not-live · Subagents – · Cost so far – · Session
// decc8861` for a run in a worktree — a panel that exists for exactly
// that moment and answered with dashes. What is left is the three facts
// the page is the only place for, and the file the phase actually made.

describe("the Overview's facts table (criterion 10)", () => {
  const facts = (html: string): string[] =>
    [...html.matchAll(/<td class="label">([\s\S]*?)<\/td>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  test("exactly three rows: Started, Cost so far, Model", () => {
    const html = renderJobDetailPage(
      detail({ state: "done", model: "sonnet" }),
      "2026-08-21T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(facts(html)).toEqual(["Started", "Cost so farTokens so far", "Model"]);
  });

  test("the four facts said elsewhere are gone, branch list included", () => {
    const html = renderJobDetailPage(
      detail({
        state: "done",
        branchUrls: [{ label: "aide", url: "https://example.test/compare" }],
      }),
      "2026-08-21T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(facts(html)).not.toContain("Project");
    expect(facts(html)).not.toContain("Spec");
    expect(facts(html)).not.toContain("Step");
    expect(facts(html)).not.toContain("Work");
    expect(html).not.toContain("https://example.test/compare");
  });

  // The heading is where the spec is named, and it stays: whichever tab
  // is open, a reader still has to know which job this is.
  test("the spec's own name and title stay above the tabs", () => {
    const html = renderJobDetailPage(
      detail({ state: "done", title: "One page shows the whole spec" }),
      "2026-08-21T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).toContain("One page shows the whole spec");
    expect(html).toContain("02-job-detail-view");
  });
});

describe("Live right now is gone (criterion 9)", () => {
  for (const tool of ["claude", "codex"] as const) {
    test(`a running ${tool} job does not show it`, () => {
      const html = renderJobDetailPage(
        detail({ state: "running", tool }),
        "2026-08-21T10:05:00Z",
        NAV,
        { tab: "overview" },
      );
      expect(html).not.toContain("Live right now");
      expect(html).not.toContain("Subagents");
    });
  }

  for (const state of ["queued", "done", "failed", "cancelled"] as const) {
    test(`nor does a ${state} one`, () => {
      const html = renderJobDetailPage(
        detail({ state }),
        "2026-08-21T10:05:00Z",
        NAV,
        { tab: "overview" },
      );
      expect(html).not.toContain("Live right now");
    });
  }
});

// --- spec 173: the head elements that make the page an app ------------------
//
// Criterion 4. `pageShell` is the single <head> every page on this site
// is built from — the served pages, the New-spec form, and the
// generated files alike — so installability is added in exactly one
// place and every page gets it the way every page already gets a
// favicon. A generated page opened from a folder finds no manifest and
// no worker at the other end of these, which is the same inert as its
// own `href="/"` nav links, not a new kind of broken.
describe("spec 173: every page says how it is installed", () => {
  const pages = (): string[] => [
    ...renderSite([project("aide")], "2026-08-21T00:00:00Z").map((p) => p.html),
    renderQueuePage([], "2026-08-21T00:00:00Z", [{ label: "Projects", path: "/projects" }], {
      runnerAvailable: true,
      targets: [],
    }),
    renderNewSpecPage([{ label: "Projects", path: "/projects" }], "2026-08-21T00:00:00Z", {
      createProjects: ["aide"],
    }),
  ];

  test("the manifest is linked once, on every page", () => {
    for (const html of pages()) {
      expect(html.match(/<link rel="manifest" href="\/manifest\.webmanifest">/g)).toHaveLength(1);
    }
  });

  test("iOS gets the icon it will not take from the manifest", () => {
    // "Add to Home Screen" reads apple-touch-icon, and Safari will not
    // rasterize an SVG for it the way it accepts one as a favicon.
    for (const html of pages()) {
      expect(html.match(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/g)).toHaveLength(1);
    }
  });

  test("the window's own colour is given for both themes", () => {
    for (const html of pages()) {
      const metas = [...html.matchAll(/<meta name="theme-color" content="(#[0-9A-F]{6})" media="([^"]+)">/g)];
      expect(metas.map((m) => m[2])).toEqual([
        "(prefers-color-scheme: light)",
        "(prefers-color-scheme: dark)",
      ]);
    }
  });

  test("all of it sits in <head>, before the stylesheet", () => {
    for (const html of pages()) {
      const manifest = html.indexOf('<link rel="manifest"');
      const themeColor = html.indexOf('<meta name="theme-color"');
      // An element that is absent has index -1 and would sit "before"
      // anything at all — the one way this could pass for nothing.
      expect(manifest).toBeGreaterThan(-1);
      expect(themeColor).toBeGreaterThan(-1);
      expect(manifest).toBeLessThan(html.indexOf("<style>"));
      expect(themeColor).toBeLessThan(html.indexOf("</head>"));
    }
  });

  test("the worker is registered from the script every page already carries", () => {
    // Not a <script> of its own: the guard on the generated pages
    // counts script tags, and what it guards against is page code
    // drifting back onto them — not a fourth small setting sharing the
    // one tag the theme switcher already opened.
    for (const html of pages()) {
      const head = html.slice(0, html.indexOf("</head>"));
      const scripts = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      expect(scripts).toHaveLength(1);
      expect(scripts[0]![1]).toContain("/sw.js");
    }
  });
});
