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
import { ICON_LINKS, WORDMARK } from "../src/render/brand.ts";

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
  steps: ["analyze", "review-plan", "implement", "archive"],
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
    expect(html).toContain("<title>aide — from spec to merge</title>");
    expect(html).toContain("<h1>Projects</h1>");
  });

  // Every tab leads with aide: the reader picks it out of a row of
  // tabs by the product's name, not by which page happens to be open.
  test("a sub-page's tab title leads with aide", () => {
    expect(site.get("about.html")!).toContain("<title>aide · About</title>");
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
  const entries = navEntries([project]);
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

  test("About and the theme buttons live inside the menu, nowhere else", () => {
    for (const [path, html] of every) {
      const m = menu(html);
      expect([path, m.includes('href="about.html"')]).toEqual([path, true]);
      expect([path, m.includes("data-theme-choice")]).toEqual([path, true]);
      const outside = html.replace(m, "");
      // The theme SCRIPT names the attribute too, and is not a control.
      const body = outside.slice(outside.indexOf("<body>"));
      expect([path, body.includes('href="about.html"')]).toEqual([path, false]);
      expect([path, body.includes("data-theme-choice")]).toEqual([path, false]);
    }
  });

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

  test("Projects is current on the projects page and on a project's own page", () => {
    for (const html of [served["/projects"], site.get("projects.html")!, site.get("aide.html")!]) {
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
// The action stack lives in the spec column, spanning the phase lines
// it commands — spec 124 gave it a COLUMN of its own at the front of
// the table, which put every button in the page's left gutter and
// pushed every other column sideways (2026-08-19).
describe("the action stack rides in the spec column, not in one of its own", () => {
  test("the header declares its blank cell last, and no row leads with one", async () => {
    const html = rows([], { targets: [target()] });
    const thead = html.match(/<thead><tr>[\s\S]*?<\/tr><\/thead>/)?.[0] ?? "";
    expect(thead).toMatch(/<th><\/th><\/tr><\/thead>$/);
    expect(thead).not.toMatch(/^<thead><tr><th><\/th>/);
  });

  test("an open row's stack is one spanning cell, beside its phase lines", () => {
    const html = rows([], { targets: [target()] });
    const stack = html.match(/<td class="stackcell" rowspan="(\d+)">([\s\S]*?)<\/td>/);
    expect(stack).not.toBeNull();
    expect(Number(stack![1])).toBeGreaterThan(1);
    expect(stack![2]).toContain(">Run</button>");
  });
});

// The phase lines begin where the spec column ends, so an un-capped
// summary line put a hand's width of nothing between the buttons and
// the phases (2026-08-19). The text wraps at a measure instead.
describe("the spec column is capped, so the phases sit close", () => {
  test("the name, the summary and the repo marks all wrap at a measure", async () => {
    const { CSS } = await import("../src/render/css.ts");
    expect(CSS).toMatch(/\.spec-title \{[^}]*max-width: \d+rem/);
    // The measure, not the rule it lives in: spec 130 folded the
    // second `.spec-name` rule into the first, and the cap came with
    // it. What this test is for is that the name wraps at a measure.
    expect(CSS).toMatch(/\.spec-name \{[^}]*max-width: \d+rem/);
  });
});

describe("the phase lines line up in columns", () => {
  test("the stylesheet gives the phase name a fixed flex basis", async () => {
    const { CSS } = await import("../src/render/css.ts");
    expect(CSS).toContain('table.list tr.subrow[data-step] .phasecell > .row > :first-child');
    expect(CSS).toContain('table.list tr.subrow[data-caption] .phasecell > .row > :first-child');
  });
});

describe("the busy chip swaps its checkbox for the spinner", () => {
  test("the stylesheet hides the input wherever a mark stands in for it", async () => {
    const { CSS } = await import("../src/render/css.ts");
    expect(CSS).toContain(".phase.busy input, .phase.off input { display: none; }");
  });
});

// --- the step's name is not the reader's word --------------------------------

describe("review-plan is shown as review (description item 4)", () => {
  test("the phase box is named for the reader and keeps the technical value", () => {
    const html = rows([], { targets: [target()] });
    // Since spec 124 the box carries no visible label of its own — the
    // phase's name is the next thing on the line — so the word a
    // reader hears is the one it is given outright.
    expect(html).toMatch(/data-phase="review-plan"[\s\S]*?aria-label="review"/);
    expect(html).toContain('value="review-plan"');
    // The word only ever appears as an attribute, never as text a
    // reader sees.
    expect(html).not.toMatch(/>[^<]*review-plan[^<]*</);
  });

  test("the phase line under the row shows it too", () => {
    const html = rows([], { targets: [target()] });
    expect(html).toMatch(/data-step="review-plan"[\s\S]*?>review</);
  });

  test("the job page's step pips use the same word", () => {
    // The facts table, where the pips live: a running job opens on its
    // activity instead.
    const html = renderJobDetailPage(detail(), AT, NAV, { tab: "overview" });
    expect(html).toContain('title="review"');
    expect(html).not.toContain('title="review-plan"');
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
    const { CSS } = await import("../src/render/css.ts");
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

// --- nothing is left behind a second click ------------------------------------

describe("the row's rarely-set controls sit in the action stack (item 4)", () => {
  const html = () =>
    rows([], {
      targets: [target()],
      projects: ["aide", "atlasaurus"],
      modelChoices: [{ name: "opus", budgetUsd: 15 }],
    });

  /** The spec's action cell: an open row's whole stack, in the cell
   *  that leads its phase lines and spans them; a shut row's one
   *  action, in the header's last cell. */
  const controls = (h: string) => {
    const stack = h.match(/<td class="stackcell"[^>]*>([\s\S]*?)<\/td>/)?.[1];
    if (stack !== undefined) return stack;
    const head =
      h.match(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="[^"]*">[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = [...head.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
    return cells[cells.length - 1] ?? "";
  };
  /** The list itself. The "?" popover above it is a `<details>` too
   *  (spec 113) and has nothing to do with a row. */
  const list = (h: string) => h.match(/<table class="list">[\s\S]*<\/table>/)?.[0] ?? "";

  test("no disclosure is left for the row to hide them behind", () => {
    const table = list(html());
    expect(table).not.toBe("");
    expect(table).not.toContain('class="more"');
    expect(table).not.toContain("<details");
    expect(table).not.toContain("<summary");
  });

  // One of the three now: the model went to the phase line itself in
  // spec 123, and the gate box went altogether in spec 133.
  test("also-touches is in the action cell", () => {
    const cell = controls(html());
    expect(cell).toContain('name="extraProjects"');
    expect(cell).not.toContain('name="model"');
    expect(cell).not.toContain('name="gate"');
  });

  test("nothing of it is left anywhere else on the page", () => {
    const h = html();
    const outside = h.replace(controls(h), "");
    expect(outside).not.toContain('name="extraProjects"');
    expect(h).not.toContain('name="gate"');
  });

  test("it comes after the buttons, quietly", () => {
    const cell = controls(html());
    expect(cell.indexOf('name="extraProjects"')).toBeGreaterThan(cell.indexOf(">Run</button>"));
    expect(cell).toContain('<span class="row extra">');
  });

  // Spec 120: presence in the cell is not the same as SHARING it. Each
  // form is its own block, so siblings glued straight into the `<td>`
  // decide their own spacing — only a container around them declares
  // it once. Spec 124 turns that container on its side: the buttons
  // are one under the next now, and the gap is still the container's.
  /** The cell's own `<span class="stack">`, with everything it holds. */
  const group = (h: string) => h.match(/<span class="stack">[\s\S]*<\/span>/)?.[0] ?? "";

  test("Run, the action forms and the extra fields are one stack (spec 120)", () => {
    const cell = controls(
      rows([row()], {
        targets: [target()],
        projects: ["aide", "atlasaurus"],
        modelChoices: [{ name: "opus", budgetUsd: 15 }],
      }),
    );
    const outer = group(cell);
    expect(outer).toContain('id="rowrun-');
    expect(outer).toContain(">Run</button>");
    expect(outer).toContain('<span class="row extra">');
    expect(outer).toContain('class="actionform"');
  });

  test("the stack is there with no job to cancel either (spec 120)", () => {
    // The same cell with nothing ever run: Approve and Cancel are not
    // drawn at all (there is no job to act on), and what remains still
    // shares the container rather than gaining one when a job arrives.
    const outer = group(controls(html()));
    expect(outer).toContain('id="rowrun-');
    expect(outer).toContain('<span class="row extra">');
    expect(outer).not.toContain('class="actionform"');
  });
});

// --- the button says what pressing it does ------------------------------------

describe("the primary button's label per row state (the design sheet's table)", () => {
  const buttons = (html: string) =>
    [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  test("a spec nothing has ever run offers Run", () => {
    expect(buttons(rows([], { targets: [target()] }))).toContain("Run");
  });

  // Always "Run", never "Run again" (asked for 2026-08-19): the
  // again-variant guessed at history and guessed wrong at the edges —
  // the ticked boxes already say what a press will do.
  test("the button says Run whatever has already run", () => {
    for (const done of [[], ["analyze", "review-plan"], ["analyze", "review-plan", "implement"]]) {
      const t = target({ done });
      const b = buttons(rows([row({ state: "done" })], { targets: [t] }));
      expect(b).toContain("Run");
      expect(b).not.toContain("Run again");
    }
  });

  test("a job waiting for approval offers Approve and Cancel", () => {
    const b = buttons(rows([row({ state: "awaiting-approval" })], { targets: [target()] }));
    expect(b).toContain("Approve");
    expect(b).toContain("Cancel");
  });

  test("a running job offers Cancel; Run is disabled without a spinner of its own", () => {
    const html = rows([row({ state: "running" })], { targets: [target()] });
    expect(buttons(html)).toContain("Cancel");
    // The busy VARIANT carries a spinner, and the running phase chip
    // already has the row's one — two spinners read as two jobs
    // (2026-08-19). Disabled, with the reason in the title, is enough.
    const run = html.match(/<button[^>]*>Run(?: again)?<\/button>/)?.[0] ?? "";
    expect(run).toContain("disabled");
    expect(run).not.toContain("busy");
  });

  // Spec 132: the button is one word, and the row's State line is what
  // says which repo a press would land.
  test("the merge button says Merge; the State line says what it merges", () => {
    const html = rows(
      [
        row({
          state: "done",
          branchUrls: [{ label: "aide-specs", url: "https://example.test/c", merged: false }],
        }),
      ],
      { targets: [target()] },
    );
    expect(buttons(html)).toContain("Merge");
    expect(buttons(html)).not.toContain("Merge the plan");
    expect(html).toContain(">ready to merge the plan<");
  });

  // Spec 135: a refusal is the row's history, and the row says it. The
  // button keeps its verb — pressing it a second time is not a
  // different action from pressing it the first time.
  test("a refusal does not change the word: the button still says Merge", () => {
    const html = rows(
      [
        row({
          state: "done",
          branchUrls: [{ label: "aide-specs", url: "https://example.test/c", merged: false }],
        }),
      ],
      {
        targets: [target()],
        error: "conflict — merge it by hand",
        errorSpec: "aide/102-design-foundation",
      },
    );
    expect(buttons(html)).toContain("Merge");
    expect(buttons(html)).not.toContain("Merge again");
  });
});

// --- spec 106: the way out of a conflict, offered where the refusal is --------
//
// The control is ADDITIVE — "merge it by hand" never goes away — and
// NARROWLY GATED: it is offered for one refusal reason among several
// that share the same free-text channel, so the test that matters most
// is the one that says it is ABSENT everywhere else.

describe("Resolve (spec 106)", () => {
  const buttons = (html: string) =>
    [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  const merged = (opts: Partial<QueuePageOptions> = {}) =>
    rows(
      [
        row({
          state: "done",
          branchUrls: [{ label: "aide-specs", url: "https://example.test/c", merged: false }],
        }),
      ],
      { targets: [target()], ...opts },
    );

  const CONFLICT = {
    error: "cannot merge aide/102 into main in /repos/aide (conflict — merge it by hand)",
    errorSpec: "aide/102-design-foundation",
    errorReason: "conflict",
  };

  test("a conflict refusal offers it, beside Merge and never instead of it", () => {
    const html = merged(CONFLICT);
    expect(html).toContain("resolveform");
    expect(buttons(html)).toContain("Resolve");
    // The hand route is what the reader had yesterday, and it stays.
    expect(buttons(html)).toContain("Merge");
  });

  test("a collapsed row offers it too — the refusal is read there as well", () => {
    const html = renderQueueRows(
      [
        row({
          state: "done",
          branchUrls: [{ label: "aide-specs", url: "https://example.test/c", merged: false }],
        }),
      ],
      { runnerAvailable: true, targets: [target()], filter: {}, ...CONFLICT },
      NOW,
    );
    expect(html).toContain("resolveform");
  });

  test("a refusal that resolving would not fix does not offer it", () => {
    // The three the merge route can produce beside a conflict. None of
    // them is a merge a step could sit down and finish. (A dirty tree
    // was a fourth until spec 144 stopped it from refusing anything.)
    for (const error of [
      "cannot fast-forward main in /repos/aide — merge it by hand",
      "aide/102 is not on origin in /repos/aide — there is nothing left to merge",
      "merged locally in /repos/aide, but the push of main failed",
    ]) {
      const html = merged({ error, errorSpec: "aide/102-design-foundation" });
      expect(html).not.toContain("resolveform");
    }
  });

  test("a row with no refusal at all does not offer it", () => {
    expect(merged()).not.toContain("resolveform");
  });

  test("a refusal belonging to ANOTHER spec does not put it on this row", () => {
    const html = merged({ ...CONFLICT, errorSpec: "aide/99-someone-else" });
    expect(html).not.toContain("resolveform");
  });

  test("it queues a resolve step, and says so in the form itself", () => {
    const html = merged(CONFLICT);
    expect(html).toContain('action="/api/queue"');
    expect(html).toMatch(/name="steps"\s+value="resolve"/);
  });

  // Spec 120: the two are the one place on a header row where two
  // controls stand side by side, and the space between them used to be
  // a margin each form carried with it. A margin travels into the next
  // layout the form is used in; a container's gap does not.
  test("Merge and resolve are one group, spaced by the container (spec 120)", () => {
    // An open row's stack leads its phase lines; a shut row's one
    // action is the header's last cell (2026-08-19).
    const cell = (html: string) => {
      const stack = html.match(/<td class="stackcell"[^>]*>([\s\S]*?)<\/td>/)?.[1];
      if (stack !== undefined) return stack;
      const head = html.match(/<tr class="spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
      const cells = [...head.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
      return cells[cells.length - 1] ?? "";
    };
    // Open: the two stand in the row's own stack, with every other
    // button the row offers, and the gap is the stack's.
    const stack = cell(merged(CONFLICT)).match(/<span class="stack">[\s\S]*<\/span>/)?.[0] ?? "";
    expect(stack).toContain("mergeform");
    expect(stack).toContain("resolveform");
    // Shut: since spec 132 there is only ONE control left out here —
    // Merge moved into the panel — so there is no pair to space, and no
    // container around a single form either.
    const shut = cell(merged({ ...CONFLICT, filter: {} }));
    expect(shut).not.toContain("mergeform");
    expect(shut).toContain("resolveform");
    expect(shut).not.toContain('<span class="row">');
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
    const { CSS } = await import("../src/render/css.ts");
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
    const { CSS } = await import("../src/render/css.ts");
    const dark = CSS.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(dark).not.toBe("");
    for (const token of PAIRED) expect(dark).toContain(`${token}:`);
  });

  test("the mark swaps to its dark-surface copy", async () => {
    const { CSS } = await import("../src/render/css.ts");
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

  test("a project page says whether the spec folder is archived on disk", () => {
    const project: ProjectView = {
      name: "aide",
      manifest: { ok: true, data: { name: "aide" } },
      specs: [
        { folder: "101-x", dir: "/x/101-x", archived: false, title: "Open", description: null, dependsOn: [], status: null },
        { folder: "99-y", dir: "/x/archive/99-y", archived: true, title: "Done", description: null, dependsOn: [], status: null },
      ],
    };
    const html = renderSite([project], AT).find((p) => p.path === "aide.html")!.html;
    expect(html).toContain('<tr class="spec-open">');
    expect(html).toContain('<tr class="spec-archived">');
    // Neither vocabulary borrows the other's words.
    expect(html).not.toContain('<tr class="archived">');
    expect(html).not.toContain('<tr class="active">');
  });
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
    expect(panel).toContain('<td colspan="6">');
    expect(panel).toMatch(/class="rowmsg err">\s*<svg/);
    // The same colspan the "no spec matches" row uses — one column
    // count for the table, not two that can drift apart.
    const empty = renderQueueRows([], { runnerAvailable: true, targets: [] });
    expect(empty).toContain('colspan="6"');
  });

  test("a held-back note is amber, like the badge that announces it", async () => {
    const html = rows([row({ state: "done", steps: ["archive"] })], {
      targets: [target({ archiveHeldBack: { reason: "the Slack webhook" } })],
    });
    const panel = html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(panel).toContain("rowmsg warn");
    const { CSS } = await import("../src/render/css.ts");
    expect(CSS.match(/\.rowmsg\.warn\s*\{([^}]*)\}/)?.[1] ?? "").toContain("var(--warn)");
  });
});
