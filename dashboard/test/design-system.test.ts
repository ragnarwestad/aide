// Spec 102: the brand, the components, and the four things the design
// sheet did not have an example of.
//
// The rest of the suite asserts what a page SAYS. This file asserts the
// handful of things the design foundation itself promises: that the
// mark and the favicons are on every page, that a phase's technical
// name never reaches the reader, that each of the ten job states picks
// a badge, and that the row's rarely-set controls lie flat on the
// controls line rather than behind a disclosure.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  navEntries,
  renderJobDetailPage,
  renderNewSpecPage,
  renderProjectsPage,
  renderQueuePage,
  renderQueueRows,
  renderSite,
  type JobDetailView,
  type ProjectView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../src/render.ts";
import { ICON_LINKS, WORDMARK } from "../src/render/ui/brand.ts";

const NAV = [{ label: "Overview", path: "projects.html" }];
const AT = "2026-08-18T12:00:00Z";
const NOW = Date.parse("2026-08-18T12:00:00Z");

const row = (extra: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "job-1",
  project: "aide",
  specFolder: "102-design-foundation",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  spentUsd: 0,
  timeoutSec: 1200,
  createdAt: "2026-08-18T10:00:00Z",
  ...extra,
});

const target = (extra: Partial<QueueTarget> = {}): QueueTarget => ({
  project: "aide",
  specFolder: "102-design-foundation",
  ...extra,
});

// Spec 103: a row is collapsed unless the view names it, and the
// controls this file is about come with opening it — so every render
// here opens the one spec it draws.
const rows = (list: QueueRowView[], opts: Partial<QueuePageOptions> = {}) =>
  renderQueueRows(
    list,
    {
      runnerAvailable: true,
      targets: [],
      filter: { open: "aide/102-design-foundation" },
      ...opts,
    },
    NOW,
  );

const detail = (extra: Partial<JobDetailView> = {}): JobDetailView => ({
  ...row(),
  steps: ["analyze", "implement", "archive"],
  stepIndex: 1,
  results: [],
  ...extra,
});

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
      const body = outside.slice(outside.indexOf("<body>"));
      expect([path, body.includes('href="about.html"')]).toEqual([path, false]);
      expect([path, body.includes('href="/settings"')]).toEqual([path, false]);
    }
  });

  // Spec 243: Theme moved out of the menu into the header itself — a
  // control the reader reaches without opening anything first.
  test("the theme buttons live in the header, outside the menu", () => {
    for (const [path, html] of every) {
      const head = html.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? "";
      const m = menu(html);
      expect([path, head.includes("data-theme-choice")]).toEqual([path, true]);
      expect([path, m.includes("data-theme-choice")]).toEqual([path, false]);
    }
  });

  // Three from spec 163, which gave the archive a half of the site of
  // its own, until spec 221 folded the archive into the Specs list and
  // took the tab back off.
  test("two tabs, Specs and Projects, between the header and the page's own h1", () => {
    for (const [path, html] of every) {
      const bar = tabs(html);
      expect([path, [...bar.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => m[1])]).toEqual([
        path,
        ["Specs", "Projects"],
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

  test("Specs is current on the spec list and on a job detail page", () => {
    for (const html of [served["/"], served["/specs/job-1"]]) {
      expect(tab(html, "Specs")).toContain('aria-current="page"');
      expect(tab(html, "Projects")).not.toContain("aria-current");
    }
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

// --- the mark replaces the checkbox, never widens the chip -------------------

// Said repeatedly, last 2026-08-19: when a phase runs, its spinner must
// take the CHECKBOX's place — a spinner beside the box makes the chip
// grow the moment a run starts. Same for the lock on a chip that will
// not take a click. The rule is CSS (the input stays in the markup for
// the form's sake), so the test pins the stylesheet itself.
// The phase lines are columns (asked for 2026-08-19, "få det nå
// alignet"): the name has a fixed width so every model select starts at
// the same x, sharing it with the caption row's own first span.
// The row's one action lives in the State column, after the badge whose
// sentence it finishes (spec 157). It had a COLUMN of its own at the
// front of the table in spec 124, which put every button in the page's
// left gutter and pushed every other column sideways; then a cell in
// the spec column spanning the phase lines (2026-08-19). The left edge
// belongs to the phase lines now.
describe("the row's one action rides beside the state, not in a column of its own", () => {
  test("the header declares no blank cell, at either end", async () => {
    const html = rows([], { targets: [target()] });
    const thead = html.match(/<thead><tr>[\s\S]*?<\/tr><\/thead>/)?.[0] ?? "";
    // Blank at the END until 2026-08-23, heading the cell a shut row's
    // action sat in before spec 157 moved it beside the state. Every
    // row drew an empty `<td>` under it for as long as it stood.
    expect(thead).not.toMatch(/<th><\/th>/);
    expect(thead).toMatch(/<\/a><\/th><\/tr><\/thead>$/);
  });

  test("the button is in the head row's State cell, and spans no rows", () => {
    const html = rows([], { targets: [target()] });
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = [...head.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    // The SECOND cell: name, then state. The Progress column stood
    // between them until the pips moved in beside the name (2026-08-22).
    expect(cells[1]).toContain("</button>");
    // The guard is about THIS button, not about the string: spec 165
    // gave the row's AI select a legitimate spanning cell of its own,
    // so a blanket ban would now fail for the wrong reason. What must
    // not come back is the action in a cell spanning the phase lines.
    expect(head).not.toContain("rowspan");
    for (const cell of html.matchAll(/<td[^>]*rowspan[^>]*>([\s\S]*?)<\/td>/g)) {
      expect(cell[1]).not.toContain("</button>");
    }
    // And the phase lines lead with their own cell, hard left.
    expect(html).toMatch(/<tr class="subrow[^"]*"[^>]*><td class="phasecell">/);
  });
});

// The phase lines begin where the spec column ends, so an un-capped
// summary line put a hand's width of nothing between the buttons and
// the phases (2026-08-19). The text wraps at a measure instead.
describe("the spec column is capped, so the phases sit close", () => {
  test("the name, the summary and the repo marks all wrap at a measure", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    expect(CSS).toMatch(/\.spec-title \{[^}]*max-width: \d+rem/);
    // A WIDTH on the name line since 2026-08-23, not a maximum: a short
    // name let the pips beside it sit further left than a long one's,
    // so they stepped in and out down the column. Still a measure — the
    // name still truncates — and what this test is for is that the
    // column ends at one.
    expect(CSS).toMatch(/\.spec-name \{[^}]*[^-]width: \d+rem/);
  });
});

// The three things a phase line offers used to be flex children of one
// cell, pinned to fixed widths so every select started at the same x.
// Spec 165 made each a real table column, and spec 192 put the AI, the
// model and the phase's box back into one cell — the name in a column
// of its own, the three choices in the column beside it. What must not
// come back with them is the hand-pinned width: the one width the merged
// cell reserves is stated on the model select itself, by name, and every
// other width the row takes is the width its controls happen to need.
describe("the phase lines line up in columns", () => {
  test("the stylesheet declares the columns, not pinned flex children", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    expect(CSS).not.toContain(".phasecell > .row");
    expect(CSS).not.toContain("td.toolcell");
    expect(CSS).toContain("table.list tr.subrow .modelcell > .row {");
    expect(CSS).toContain(
      'table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 6.25rem; max-width: 100px; }',
    );
  });
});

// An open row's last phase line sat hard against the next spec's name.
// The rule meant to prevent it read `tr.subrow:last-child`, and
// `:last-child` means the last row in the TABLE — so it fired only when
// the open spec happened to be the bottom one, and any spec below it
// left the last phase line on its ordinary 2px. A collapsed row looks
// right because its air comes from ABOVE: the head row has its own
// border-top and padding-top.
//
// What is wanted is "the last sub-row of THIS spec". `:has()` reads
// forward from the subrow to the head row that follows it, which is the
// only direction a flat, unwrapped tbody allows without a wrapper
// element per spec. Adding a standalone selector beside the existing one
// is also narrower than moving the space onto tr.spechead's own
// border-top/padding-top rule, which three other things on the page rely
// on (spec 167).
describe("an open spec's last phase line has air under it", () => {
  test("the padding rule reaches a spec's own last subrow, not just the table's", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    const rule =
      CSS.match(/([^\n}]*tr\.subrow:last-child td[^{]*)\{([^}]*)\}/) ??
      ([] as unknown as RegExpMatchArray);
    const selector = rule[1] ?? "";
    expect(rule[2] ?? "").toContain("padding-bottom: var(--sp-3)");
    // The case that was already right — the page's literal last row —
    // is kept, and the case that was not is added beside it.
    expect(selector).toContain("tr.subrow:last-child td");
    expect(selector).toContain("tr.subrow:has(+ tr.spechead) td");
  });
});

// The one moving thing that said a phase was running used to be a
// spinner on that phase's CHECKBOX, and a checkbox only exists on an
// open row — so the closed row, which spec 157 made the whole interface
// for the ordinary case, showed no motion at all. Spec 168 moved the
// signal onto the running phase's Progress marker: the mark that
// already says WHICH phase is running says "and it is alive" in the
// same 14x4 glyph, taking no space and needing no new element.
describe("the running phase's pip carries the motion, not the checkbox", () => {
  test("the pip skims along the bar rather than pulsing in place", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    const pipNow = CSS.match(/\.pip\.now\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(pipNow).toMatch(/animation:\s*\S+/);
    // Matched by the animation's own NAME, never as "the first
    // @keyframes in the file": `.spin`'s `@keyframes sp { ... }` is
    // written on one line too, and a name-agnostic pattern would pass
    // by matching that one instead, for the wrong reason.
    const keyframes = CSS.match(/@keyframes\s+pipskim\s*\{([\s\S]*?)\}\s*\}/)?.[1] ?? "";
    // A pulse reads as an alert; a band travelling ALONG the bar reads
    // as work being done, in the direction the four marks already run.
    expect(keyframes).toContain("background-position");
    expect(keyframes).not.toContain("opacity");
  });

  // Spec 210: the pip fills a third at a time while an implement runs.
  // The FILL is what changes; the box never does — a pip that grew would
  // move everything on the line beside it, and the page's rule is that
  // nothing moves because something else changed.
  test("the pip is wide enough for a third to be visible, and divisible by three", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    const pip = CSS.match(/\n\.pip \{([^}]*)\}/)?.[1] ?? "";
    const width = Number(pip.match(/width:\s*(\d+)px/)?.[1]);
    expect(width).toBe(21);
    expect(width % 3).toBe(0);
  });

  test("the project row link covers its row below independent actions", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    const row = CSS.match(/\.proj-row \{([^}]*)\}/)?.[1] ?? "";
    const overlay = CSS.match(/\.proj-row-link::after \{([^}]*)\}/)?.[1] ?? "";
    const action = CSS.match(/\.proj-row-action \{([^}]*)\}/)?.[1] ?? "";
    expect(row).toContain("position: relative");
    expect(overlay).toContain("position: absolute");
    expect(overlay).toContain("inset: 0");
    expect(action).toContain("position: relative");
    expect(action).toContain("z-index: 1");
  });

  test("the fill covers the thirds already behind the run, and only those", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    // Keyed off `.pip.now`: a third belongs to the phase that is
    // RUNNING. A past or future pip carrying a fill would be the mark
    // answering a question nobody asked of it.
    expect(CSS).toContain('.pip.now[data-third="1"]::after { width: 33%; }');
    expect(CSS).toContain('.pip.now[data-third="2"]::after { width: 67%; }');
    const overlay = CSS.match(/\.pip\.now\[data-third\]::after \{([^}]*)\}/)?.[1] ?? "";
    // Anchored LEFT and drawn in the accent: the fill grows from the
    // start of the bar in the direction the four marks already read.
    expect(overlay).toContain("var(--accent)");
    expect(overlay).toMatch(/inset:\s*0 auto 0 0/);
    // And the box it is drawn inside has to be able to hold it.
    const pip = CSS.match(/\n\.pip \{([^}]*)\}/)?.[1] ?? "";
    expect(pip).toContain("position: relative");
    expect(pip).toContain("overflow: hidden");
  });

  test("a machine set to reduce motion gets none, and can still tell running from waiting", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    const reduced = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(reduced).toContain(".pip.now");
    expect(reduced).toContain("animation: none");
    // The mark stands still; it does not go grey. The accent is what
    // says which phase, and that half of the signal is not motion.
    expect(reduced).toContain("background: var(--accent)");
  });

  test("every running row's pip shares one clock", async () => {
    // No `animation-delay` anywhere. The whole `#jobrows` subtree is
    // replaced in a single `innerHTML` swap, so every pip on the page
    // starts together by construction; a delay keyed off a row index or
    // a job's own start time is exactly what would make a list of
    // running specs shimmer at random instead of moving as one.
    const { CSS } = await import("../src/render/ui/css.ts");
    // The DECLARATION, not the word: the rule's own comment says why
    // there is no delay, and a guard tripped by prose that agrees with
    // it would only teach the next reader to delete the prose.
    expect(CSS).not.toMatch(/animation-delay\s*:/);
    expect(CSS).not.toMatch(/animation:[^;}]*\d[a-z]*\s+[^;}]*\d+m?s[^;}]*\d+m?s/);
    // And nothing sets one from script either — a per-row delay read
    // off a job's own start time is the shape this is really guarding
    // against, and it would live in the browser code, not the CSS.
    const root = join(import.meta.dir, "..");
    // css.ts is read above as the EVALUATED stylesheet and left out
    // here: it is the one file in the glob whose comments are page
    // content, so its own explanation of why there is no delay is text
    // this loop would read as a declaration.
    const files = [
      ...[...new Bun.Glob("src/render/**/*.ts").scanSync(root)].filter((f) => f !== "src/render/ui/css.ts"),
      "src/queue-client.ts",
    ];
    expect(files.length).toBeGreaterThan(4);
    for (const file of files) {
      const source = await Bun.file(join(root, file)).text();
      expect([file, /animation-delay|animationDelay/.test(source)]).toEqual([file, false]);
    }
  });

  test("the spinner is off the checkbox entirely", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    // Two signals for one fact, and the wrong one of the two: a box is
    // a control, so a spinner on it read as "this box is working"
    // rather than "this phase is running".
    expect(CSS).not.toContain(".phase.busy");
    // The lock still replaces the box it stands in for — that rule is
    // the reason the selector list existed, and it stays.
    expect(CSS).toContain(".phase.off input { display: none; }");
  });
});

// --- every state picks a badge -----------------------------------------------

// Five of the ten had an example on the design sheet. These four did
// not, so the mapping was decided in the plan and is asserted by name
// here rather than left to the general "the page still renders" cover.
describe("the four states with no example on the design sheet", () => {
  const badgeOf = (state: QueueRowView["state"], extra: Partial<QueueRowView> = {}) => {
    const html = rows([row({ state, stepIndex: 0, ...extra })]);
    return html.match(/<span class="badge (b-[a-z]+)"/)?.[1] ?? "";
  };

  test("stopped is a notice, not a failure — the same amber as waiting", () => {
    expect(badgeOf("stopped", { stopReason: "budget" })).toBe("b-waiting");
  });

  test("failed is danger", () => {
    expect(badgeOf("failed")).toBe("b-refused");
  });

  test("interrupted is danger, grouped with failed as it always was", () => {
    expect(badgeOf("interrupted")).toBe("b-refused");
  });

  test("cancelled is a deliberate ending, not a failure", () => {
    expect(badgeOf("cancelled")).toBe("b-idle");
  });
});

describe("refused and running are told apart by more than the word", () => {
  test("the refused badge carries a border the running one does not", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    const refused = CSS.match(/\.b-refused\s*\{([^}]*)\}/)?.[1] ?? "";
    const running = CSS.match(/\.b-running\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(refused).toContain("border-color: var(--danger)");
    expect(running).not.toContain("border-color:");
    expect(refused).toContain("var(--danger-soft)");
    expect(running).toContain("var(--accent-soft)");
  });

  test("a refusal on the row is a message with the warning mark, not colour alone", () => {
    const html = rows([row({ state: "failed" })], {
      targets: [target()],
      error: "cannot merge aide/102-… into main — conflict",
      errorSpec: "aide/102-design-foundation",
    });
    expect(html).toContain('class="refused rowmsg err"');
    expect(html).toMatch(/class="refused rowmsg err">\s*<svg/);
  });
});
// "Also touches" had a group of its own here: it lived in the action
// cell beside the button, and four tests pinned it there. The control
// is gone — 0 of 200 jobs ever named an extra repo, and it drew a tick
// box per project on every open row — so the tests went with it.


// --- the button says what pressing it does ------------------------------------

describe("the primary button's label per row state (the design sheet's table)", () => {
  const buttons = (html: string) =>
    [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  test("a spec nothing has ever run is offered its first two phases", () => {
    expect(buttons(rows([], { targets: [target()] }))).toContain("Analyze");
  });

  // The bare word "Run" went in spec 157, and "Run again" before it
  // (2026-08-19): the again-variant guessed at history and guessed
  // wrong at the edges. The button names the phase a press would run,
  // which is the thing both wordings were groping for.
  test("the button names the phase a press would run, whatever has already run", () => {
    for (const [done, label] of [
      [[], "Analyze"],
      [["analyze"], "Implement"],
      [["analyze", "implement"], "Archive"],
    ] as const) {
      const t = target({ done: [...done] });
      const b = buttons(rows([row({ state: "done" })], { targets: [t] }));
      expect(b).toContain(label);
      expect(b).not.toContain("Run again");
      expect(b).not.toContain("Run");
    }
  });

  test("a running job offers Cancel and nothing else", () => {
    const html = rows([row({ state: "running" })], { targets: [target()] });
    // Named for the step it would stop, so it reads like the Run
    // button it replaces (spec 157).
    expect(buttons(html)).toContain("Cancel");
    // No Run at all — a greyed-out one beside a live Cancel is the
    // second control this spec removes. The busy VARIANT carries a
    // spinner, and the running phase chip already has the row's one;
    // two spinners read as two jobs (2026-08-19).
    expect(html).not.toMatch(/<button[^>]*form="rowrun/);
    expect(html).not.toContain(">Run<");
    const cancel = html.match(/<button[^>]*>Cancel<\/button>/)?.[0] ?? "";
    expect(cancel).not.toContain("busy");
  });

  // Spec 149: there is no Merge button at all any more, and the State
  // line stopped naming what one would land. A finished spec with a
  // branch still open says which PHASE is next, in the State column and
  // there alone — the repo list carries links and nothing else.
  test("a finished spec with an open branch offers no merge, and asks for none", () => {
    const html = rows(
      [
        row({
          state: "done",
          branchUrls: [{ label: "aide-specs", url: "https://example.test/c" }],
        }),
      ],
      { targets: [target()] },
    );
    expect(buttons(html)).not.toContain("Merge");
    expect(html).not.toContain("ready to merge");
    expect(html).not.toContain("waiting for archive");
  });

});

// --- spec 171: no way out is OFFERED, because archive takes it itself --------
//
// There was a Resolve control here, narrowly gated to one refusal class
// among several. Spec 171 folded resolving into `archive`, so the
// control is gone and the test that matters is the one that says it is
// absent everywhere — under every refusal class, on an open row and a
// shut one alike. A conflict that reaches a reader is one no machine
// could settle, and the row says so in the failure's own text beside the
// ordinary re-run every other failed step offers.

describe("no Resolve control (spec 171)", () => {
  const buttons = (html: string) =>
    [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  const CONFLICT = {
    error: "cannot merge aide/102 into main in /repos/aide (conflict)",
    errorReason: "conflict" as const,
  };

  const conflicted = (opts: Partial<QueuePageOptions> = {}) =>
    rows(
      [
        row({
          state: "done",
          branchUrls: [{ label: "aide-specs", url: "https://example.test/c" }],
          ...CONFLICT,
        }),
      ],
      { targets: [target()], ...opts },
    );

  test("a conflict refusal draws no control of its own", () => {
    const html = conflicted();
    expect(html).not.toContain("resolveform");
    expect(buttons(html)).not.toContain("Resolve");
    // The hand route the reader had before spec 149 is gone too.
    expect(buttons(html)).not.toContain("Merge");
    // What it DOES offer is the ordinary re-run — the same control
    // every other failed step's row carries.
    expect(html).toMatch(/<button[^>]*form="rowrun/);
  });

  test("a collapsed row draws none either", () => {
    const html = conflicted({ filter: {} });
    expect(html).not.toContain("resolveform");
    expect(buttons(html)).not.toContain("Resolve");
  });

  test("no refusal class draws one", () => {
    // The three the merge route can produce beside a conflict, and the
    // conflict itself. None of them offers a press of its own now.
    for (const error of [
      "cannot fast-forward main in /repos/aide",
      "aide/102 is not on origin in /repos/aide — there is nothing left to merge",
      "merged locally in /repos/aide, but the push of main failed",
      CONFLICT.error,
    ]) {
      const html = rows(
        [
          row({
            state: "done",
            branchUrls: [{ label: "aide-specs", url: "https://example.test/c" }],
            error,
          }),
        ],
        { targets: [target()] },
      );
      expect(`${error}: ${html.includes("resolveform")}`).toBe(`${error}: false`);
    }
  });

  test("nothing on the page queues a resolve step", () => {
    expect(conflicted()).not.toMatch(/name="steps"\s+value="resolve"/);
  });
});

// --- dark mode is implemented, not merely declared ----------------------------

// Spec 121 made two controls links rather than buttons — New spec on
// the spec list, and Cancel on /new — because both GO somewhere and do
// nothing else. They wear `.btn`, so the component has to survive being
// worn by an `<a>`: the page's own a-rule underlines on hover, and a
// button that grows an underline under the pointer stops looking like
// one.
describe("the button component works on a link too (spec 121)", () => {
  const rules = async (): Promise<[string, string]> => {
    const { CSS } = await import("../src/render/ui/css.ts");
    return [
      CSS.match(/(?<![-.\w])\.btn \{[^}]*\}/)?.[0] ?? "",
      CSS.match(/\.btn:hover \{[^}]*\}/)?.[0] ?? "",
    ];
  };

  test("the rules are where this test thinks they are", async () => {
    const [rest, hover] = await rules();
    expect(rest).not.toBe("");
    expect(hover).not.toBe("");
  });

  test("it carries no underline, at rest or under the pointer", async () => {
    const [rest, hover] = await rules();
    expect(rest).toContain("text-decoration: none");
    expect(hover).toContain("text-decoration: none");
  });

  test("both controls really are links wearing it", () => {
    const list = renderQueuePage([], AT, NAV, {
      runnerAvailable: true,
      targets: [],
      createProjects: ["aide"],
    });
    expect(list).toContain('<a class="btn primary" href="/new">');
    const form = renderNewSpecPage(NAV, AT, { createProjects: ["aide"], targets: [] });
    expect(form).toContain('<a class="btn" href="/">');
  });
});

describe("every token has a dark-surface value (acceptance criterion 13)", () => {
  // Contrast can only be judged in a browser. What a test CAN close is
  // that no token is left behind: a page half in dark mode is the one
  // failure mode a missing override produces.
  const PAIRED = [
    "--bg", "--surface", "--surface-2", "--text", "--muted", "--line", "--line-strong",
    "--accent", "--accent-strong", "--accent-soft", "--ok", "--ok-soft",
    "--warn", "--warn-soft", "--danger", "--danger-soft",
  ];

  test("the dark block overrides every colour token", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    const dark = CSS.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(dark).not.toBe("");
    for (const token of PAIRED) expect(dark).toContain(`${token}:`);
  });

  test("the mark swaps to its dark-surface copy", async () => {
    const { CSS } = await import("../src/render/ui/css.ts");
    expect(CSS).toContain(".mark-d");
    expect(CSS).toContain(".mark-l");
  });
});

// --- one name, one question ------------------------------------------------

// `active` and `archived` used to be two class names meaning two
// unrelated things: on the spec list, whether a job is in flight; on a
// project page, whether the spec folder has been archived on disk.
// Nothing pinned either, so nothing would have noticed them drifting
// into each other.
describe("the two row-state vocabularies are distinct (acceptance criterion 9)", () => {
  test("the spec list says whether a job is in flight", () => {
    expect(rows([], { targets: [target()] })).toContain('class="spechead run-new"');
    expect(rows([row({ state: "running" })], { targets: [target()] })).toContain(
      'class="spechead run-live"',
    );
    expect(rows([row({ state: "done" })], { targets: [target()] })).toContain(
      'class="spechead run-past"',
    );
  });

  // The generated project page had two spec-row classes of its own,
  // `spec-open` and `spec-archived`, kept distinct from the queue's
  // `active`/`archived`. That page went on 2026-08-22 and the classes
  // with it; the queue's vocabulary is the only one left.
});

// Spec 143: the panel a row's long message goes into is the message
// component the page already has, in a row of its own — not a second
// way of drawing the same thing.
describe("the row's message panel is the component, not new markup", () => {
  test("the panel wraps rowMessage and spans the whole table", () => {
    const html = rows([row({ state: "failed", error: "the specs tree is dirty: /repos/aide-specs" })], {
      targets: [target()],
    });
    const panel = html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(panel).toContain(`<td colspan="5">`);
    expect(panel).toMatch(/class="rowmsg err">\s*<svg/);
    // The same colspan the "no spec matches" row uses — one column
    // count for the table, not two that can drift apart.
    const empty = renderQueueRows([], { runnerAvailable: true, targets: [] });
    expect(empty).toContain(`colspan="5"`);
  });

  test("a held-back note is amber, like the badge that announces it", async () => {
    const html = rows([row({ state: "done", steps: ["archive"] })], {
      targets: [target({ archiveHeldBack: { reason: "the Slack webhook" } })],
    });
    const panel = html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(panel).toContain("rowmsg warn");
    const { CSS } = await import("../src/render/ui/css.ts");
    expect(CSS.match(/\.rowmsg\.warn\s*\{([^}]*)\}/)?.[1] ?? "").toContain("var(--warn)");
  });
});
