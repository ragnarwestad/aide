// Spec 102: the brand, the components, and the four things the design
// sheet did not have an example of.
//
// The rest of the suite asserts what a page SAYS. This file asserts the
// handful of things the design foundation itself promises: that the
// mark and the favicons are on every page, and that the header, the …
// menu and the two tabs follow the frame contract.
//
// Split out of design-system.test.ts by theme.
import { afterEach, describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import {
  navEntries,
  renderJobDetailPage,
  renderProjectsPage,
  renderQueuePage,
  renderSite,
  type ProjectView,
} from "../../src/render.ts";
import { ICON_LINKS, WORDMARK } from "../../src/render/ui/brand.ts";
import { getBoardInfo, setBoardInfo } from "../../src/render/ui/board-info.ts";
import { AT, detail } from "./design-system-fixtures.ts";

// --- the brand ---------------------------------------------------------------

describe("the mark is on the page (description item 3)", () => {
  const project: ProjectView = { name: "aide", manifest: { ok: true, data: { name: "aide" } }, specs: [] };
  const site = new Map(renderSite([project], AT).map((p) => [p.path, p.html]));

  test("the favicons go in <head>, before the stylesheet", () => {
    const html = site.get("projects.html")!;
    expect(html).toContain(ICON_LINKS);
    expect(html.indexOf(ICON_LINKS)).toBeLessThan(html.indexOf("<style>"));
  });

  test("the wordmark opens the header, before the … menu", () => {
    for (const html of site.values()) {
      expect(html).toContain(`<header>${WORDMARK}`);
      expect(html.indexOf(WORDMARK)).toBeLessThan(html.indexOf('<details class="menu">'));
    }
  });

  test("the mark ships as inline SVG and data URIs — the site is opened from a folder too", () => {
    const html = site.get("projects.html")!;
    expect(html).not.toContain('href="/favicon');
    expect(html).not.toContain("<img");
    expect(ICON_LINKS).toContain("data:image/svg+xml,");
  });

  test("the overview's tab title carries the tagline; its heading does not change", () => {
    const html = site.get("projects.html")!;
    expect(html).toContain("<title>aide -board — from spec to merge</title>");
    expect(html).toContain("<h1>Projects</h1>");
  });

  // Every tab leads with the surface's name: the reader picks it out of
  // a row of tabs by what this is, not by which page happens to be open.
  // "aide -board" rather than "aide" since the wordmark took the surface
  // name — the CLI and this page are one product and two surfaces, and
  // the tab is one of the places that has to say which.
  test("a sub-page's tab title leads with the surface name", () => {
    expect(site.get("about.html")!).toContain("<title>aide -board · About</title>");
  });
});

// --- the frame: header, … menu and the two tabs (spec 119) --------------------
//
// The left column is gone. What replaces it is a contract, not a look:
// the mark is the leftmost thing on every page and the "…" menu the
// rightmost, About and the theme buttons are BEHIND that menu and
// nowhere else, and the two tabs under the header say which of the
// site's two halves the reader is in. Each of those is a rule that
// would break silently — a menu that also leaves About in the open
// still renders, and a tab that marks the wrong page current looks
// like a page that works.

describe("the header and the two tabs (spec 119)", () => {
  const project: ProjectView = { name: "aide", manifest: { ok: true, data: { name: "aide" } }, specs: [] };
  const site = new Map(renderSite([project], AT).map((p) => [p.path, p.html]));
  // The entries the SERVER passes — `navEntries` is what `serve.ts`
  // calls, and the Projects entry it builds is the served route, which
  // is what decides whether that tab reads as current on `/projects`.
  const entries = navEntries();
  const served = {
    "/": renderQueuePage([], AT, entries, { runnerAvailable: true, targets: [] }),
    "/specs/job-1": renderJobDetailPage(detail(), AT, entries),
    "/projects": renderProjectsPage([project], AT, entries, {}),
  };
  const every = new Map<string, string>([...site, ...Object.entries(served)]);

  const menu = (h: string) => h.match(/<details class="menu">[\s\S]*?<\/details>/)?.[0] ?? "";
  const tabs = (h: string) => h.match(/<nav[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
  /** One pill, by its label, out of the tab bar. */
  const tab = (h: string, label: string) =>
    tabs(h).match(new RegExp(`<a[^>]*>${label}</a>`))?.[0] ?? "";

  test("the menu control is the last thing in the header, after the mark", () => {
    for (const [path, html] of every) {
      const head = html.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? "";
      expect([path, head.startsWith(`<header>${WORDMARK}`)]).toEqual([path, true]);
      expect([path, head.includes('<details class="menu">')]).toEqual([path, true]);
    }
  });

  test("Settings and About live inside the menu, nowhere else", () => {
    for (const [path, html] of every) {
      const m = menu(html);
      expect([path, m.includes('href="about.html"')]).toEqual([path, true]);
      expect([path, m.match(/href="\/settings"/g)?.length]).toEqual([path, 1]);
      const outside = html.replace(m, "");
      const body = outside.slice(outside.indexOf("<body"));
      expect([path, body.includes('href="about.html"')]).toEqual([path, false]);
      expect([path, body.includes('href="/settings"')]).toEqual([path, false]);
    }
  });

  // Spec 243: Theme moved out of the menu into the header itself — a
  // control the reader reaches without opening anything first. Spec 436
  // reverses the second half: the same choice buttons also repeat, flat,
  // inside the "…" menu's own morerows block, reachable at phone width
  // where the standalone header trigger is hidden.
  test("the theme buttons live in the header, and repeat flat inside the menu for mobile", () => {
    for (const [path, html] of every) {
      const head = html.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? "";
      const m = menu(html);
      expect([path, head.includes("data-theme-choice")]).toEqual([path, true]);
      expect([path, m.includes("data-theme-choice")]).toEqual([path, true]);
    }
  });

  // Three from spec 163, which gave the archive a half of the site of
  // its own, until spec 221 folded the archive into the Specs list and
  // took the tab back off; three again from spec 272 (Schedule).
  test("three tabs, Specs, Projects and Schedule, between the header and the page's own h1", () => {
    for (const [path, html] of every) {
      // Spec 437: the job detail page is a subpage now and draws no
      // site-level tab bar — checked separately below.
      if (path === "/specs/job-1") continue;
      const bar = tabs(html);
      expect([path, [...bar.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => m[1])]).toEqual([
        path,
        ["Specs", "Projects", "Schedule"],
      ]);
      expect([path, html.indexOf("</header>") < html.indexOf("<nav")]).toEqual([path, true]);
      // The generated pages keep their h1 under the tabs; the spec list
      // has none (the Specs tab names it), so only assert where one is.
      if (html.includes("<h1>")) {
        expect([path, html.indexOf("</nav>") < html.indexOf("<h1>")]).toEqual([path, true]);
      }
    }
  });

  test("the tab bar carries no empty group caption", () => {
    for (const [path, html] of every) {
      expect([path, tabs(html).includes('<span class="lbl"></span>')]).toEqual([path, false]);
    }
  });

  // Spec 437 reverses spec 119's own premise here: the job detail page
  // is a subpage now, drawing no site-level nav to mark current at all.
  test("Specs is current on the spec list; the job detail page carries no site-level nav", () => {
    expect(tab(served["/"], "Specs")).toContain('aria-current="page"');
    expect(tab(served["/"], "Projects")).not.toContain("aria-current");
    expect(served["/specs/job-1"]).not.toContain('<nav class="tabbar">');
  });

  // A project's own generated page went on 2026-08-22 — the server
  // serves the one project page there is.
  test("Projects is current on the projects page", () => {
    for (const html of [served["/projects"], site.get("projects.html")!]) {
      expect(tab(html, "Projects")).toContain('aria-current="page"');
      expect(tab(html, "Specs")).not.toContain("aria-current");
    }
  });

  test("neither tab is current on About — it is reached through the menu now", () => {
    const html = site.get("about.html")!;
    expect(tabs(html)).not.toContain("aria-current");
  });

  test("no left column is left anywhere", () => {
    for (const [path, html] of every) {
      expect([path, html.includes('class="layout"')]).toEqual([path, false]);
    }
  });
});

// --- the board line and its Stop control (spec 424) --------------------------
//
// Which board a page is served from — a process-lifetime value read
// directly by `pageHeader()` (`getBoardInfo()`), never threaded through
// any of the call sites above. Covers both a statically generated page
// (`renderSite`) and a dynamically served one (`renderQueuePage`),
// since REQ-2 names "headeren" with no page excluded and a test board's
// own Projects/About come from exactly the same `renderSite()` call a
// dynamically served page's header does.

describe("the board line and its Stop control (spec 424)", () => {
  const project: ProjectView = { name: "aide", manifest: { ok: true, data: { name: "aide" } }, specs: [] };
  const entries = navEntries();
  const machine = process.env.AIDE_DASH_HOST ?? hostname();

  afterEach(() => setBoardInfo(undefined));

  function render(): string[] {
    return [
      ...renderSite([project], AT).map((p) => p.html),
      renderQueuePage([], AT, entries, { runnerAvailable: true, targets: [] }),
    ];
  }

  test("REQ-1: an ordinary server's header reads '<machine> - Prod'", () => {
    setBoardInfo(undefined);
    for (const html of render()) {
      expect(html).toContain(`${machine} - Prod`);
    }
  });

  test("REQ-5: an ordinary server draws no Stop form anywhere", () => {
    setBoardInfo(undefined);
    for (const html of render()) {
      expect(html).not.toContain('action="/api/self-stop"');
    }
  });

  // The spec's number on the line, the folder and branch as hover text
  // (2026-09-10): spec 424's "<spec> : <branch>" spelt the same long name
  // twice, since the branch is always aide/<folder>.
  test("a test board's header reads '<machine> - Test - <number>', with folder and branch on hover", () => {
    setBoardInfo("424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra");
    for (const html of render()) {
      expect(html).toContain(`${machine} - Test - 424<`);
      expect(html).toContain(
        'title="424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra : ' +
          'aide/424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra"',
      );
      expect(html).not.toContain("Test - 424-headeren");
    }
  });

  test("REQ-3: a test board's header carries a Stop form beside the line", () => {
    setBoardInfo("424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra");
    for (const html of render()) {
      expect(html).toContain('<form class="actionform" method="post" action="/api/self-stop">');
    }
  });

  // Risk (3-solution.md): a module-level singleton must never leak a
  // prior test's board across `createServer()`/render calls in the same
  // `bun test` process.
  test("no leakage: an ordinary render right after a test-board one shows no Stop form", () => {
    setBoardInfo("424-headeren-sier-hvilket-board-du-er-pa-og-testserveren-kan-stoppes-derfra");
    render();
    setBoardInfo(undefined);
    for (const html of render()) {
      expect(html).not.toContain('action="/api/self-stop"');
      expect(html).toContain(`${machine} - Prod`);
    }
    expect(getBoardInfo()).toBeUndefined();
  });
});
