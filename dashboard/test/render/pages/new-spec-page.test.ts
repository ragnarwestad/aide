import { describe, expect, test } from "bun:test";
import {
  renderNewSpecPage,
  renderQueuePage,
  renderQueueRows,
  PHASE_LINES,
  type NewSpecPageOptions,
  type QueuePageOptions,
} from "../../../src/render.ts";
import { aiPicker, modelPicker } from "../../../src/render/pages/queue-list/model-picker.ts";
import { type SpecGroup } from "../../../src/render/pages/queue-list/data-model.ts";
import {
  row,
} from "./fixtures.ts";


// --- spec 121: the New-spec form is a page of its own ------------------------
//
// It was a `<details>` folded into `/` (spec 113 gave its summary the
// primary-button look). Pressing a primary button and having the page
// unfold under it read oddly, and there was no way out but pressing the
// same button again. The control is a plain link now, and the form is
// everything `/new` has on it — with a Create that goes home and a
// Cancel that goes home doing nothing.
describe("spec 121: New spec is a link, and the form is its own page", () => {
  const page = (opts: Partial<QueuePageOptions> = {}) =>
    renderQueuePage([], "2026-08-19T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [],
      createProjects: ["aide"],
      ...opts,
    });
  const newPage = (opts: Partial<NewSpecPageOptions> = {}) =>
    renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-08-19T00:00:00Z", {
      createProjects: ["aide"],
      targets: [],
      ...opts,
    });

  // Criterion 1.
  test("the front page offers a plain link, not a toggle", () => {
    const html = page();
    expect(html).toContain('<a class="btn primary" href="/new">New</a>');
    expect(html).not.toContain('<details class="newspec">');
    // And the form itself is gone from this page entirely — not merely
    // shut: `/new` is the only place it is rendered now.
    expect(html).not.toContain('action="/api/queue/create"');
  });

  // Criterion 2: the same emptiness rule the form itself carried — a
  // machine no project may create a spec in is offered nothing.
  test("no project to create in, no link at all", () => {
    const html = page({ createProjects: [] });
    // The markup, not the word: the stylesheet is inlined into every
    // page and its comments name the components they style.
    expect(html).not.toContain(">New</a>");
    expect(html).not.toContain('href="/new"');
  });

  // Criterion 3: the whole field order, and the per-project scoping
  // the chips carry so the browser can narrow them. Reworked 2026-08-19:
  // Project and Depends on share the first row, Title has a line of its
  // own, and Create/Cancel sit at the RIGHT of the Description box —
  // which in the markup means after it. Reworked again by spec 228:
  // Project shares its row with the Model choice instead, and Depends
  // on drops to a full-width row of its own.
  test("the page carries Project, Depends on, Title, Description, Create — in that order", () => {
    const html = newPage({
      targets: [
        { project: "aide", specFolder: "92-a-spec-can-depend" },
        { project: "aide-dashboard", specFolder: "01-first" },
      ],
    });
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect([needle, i > -1]).toEqual([needle, true]);
      return i;
    };
    const order = [
      '<select name="project">',
      '<table class="list">',
      'name="dependsOn"',
      '<input type="text" name="title"',
      '<textarea name="description"',
      "Create</button>",
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The rows themselves: Project leads the first, Description+actions
    // the last, Title and Depends on each on a line of their own between
    // them.
    expect(html).toMatch(/<span class="frow"><label class="field"><span>Project<\/span>/);
    expect(html).toMatch(/<span class="frow"><label class="field wide"><span>Description<\/span>/);
    // Spec 342: the phase table has replaced Project's row's own
    // hand-rolled AI/Model pair (criterion 8, spec 228) as what sits
    // between Project's row and Depends on — still not inside a second
    // `.frow`.
    const betweenProjectAndDepends = html.slice(
      html.indexOf('<select name="project">'),
      html.indexOf('name="dependsOn"'),
    );
    expect(betweenProjectAndDepends).toContain('<table class="list">');
    expect(betweenProjectAndDepends).not.toContain('<span class="frow">');
    expect(html).toMatch(/<span class="factions"><button[^>]*>Create<\/button>/);
    // Each chip says which project it belongs to.
    expect(html).toMatch(/data-project="aide-dashboard"[^]*?value="01-first"/);
  });

  // Criterion 5: Cancel does nothing but leave. A plain `<a href="/">`
  // is what makes "no request against /api/queue/create" true
  // structurally — there is no script for it to depend on.
  // Spec 252: the bottom Cancel beside Create is gone — the top Back
  // link is the one plain link home now, and it is a link either way,
  // never a button that could post.
  test("no bottom Cancel beside Create — Back is the one way out", () => {
    const html = newPage();
    expect(html).not.toContain('<a class="btn" href="/">Cancel</a>');
    expect(html).not.toContain('name="cancel"');
  });

  // --- spec 228: the model the FIRST step runs on ----------------------------
  //
  // The four steps that follow `create` each have a phase line with a
  // model picker on it. `create` has none — it makes the spec those
  // lines belong to — so this form is the only place its model can be
  // chosen. Same two controls the phase lines draw, same helpers, same
  // single-tool rule.
  const TWO_TOOLS: NonNullable<NewSpecPageOptions["modelChoices"]> = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
    { name: "codex-fast", budgetUsd: 5, tool: "codex" },
  ];

  /** The value both selects have to agree on for `applyAiPick` to find
   *  one from the other (`queue-client.ts`: the lookup is by `name` AND
   *  `form`, so a shared enclosing `<form>` element is not enough). */
  const formAttr = (html: string, selector: string): string | undefined =>
    html.match(new RegExp(`<select ${selector}[^>]*\\bform="([^"]*)"`))?.[1];

  // Spec 342: the hand-rolled `.field`-wrapped pair became the phase
  // table's own `create` row — the AI select still comes before the
  // Model select, in the same `.aimodel` cell the Specs list's row uses.
  test("the AI and Model selects sit together in the create row of the phase table", () => {
    const html = newPage({ modelChoices: TWO_TOOLS });
    expect(html).toMatch(
      /<tr class="subrow" data-step="create">[\s\S]*?<span class="aimodel"><select data-ai="model\.create"[\s\S]*?<select name="model\.create"[\s\S]*?<\/span>[\s\S]*?<\/tr>/,
    );
  });

  test("Back links home before the create form", () => {
    const html = newPage();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
    expect(html.indexOf("← Back</a>")).toBeLessThan(
      html.indexOf('action="/api/queue/create"'),
    );
  });

  // Spec 252, Criterion 2: the filtered specs-list URL a reader pressed
  // "New spec" from survives the round trip.
  test("Back tracks the given backHref", () => {
    const html = newPage({ backHref: "/?state=all&q=archive" });
    expect(html).toContain('<a class="backlink" href="/?state=all&amp;q=archive">← Back</a>');
  });

  // Spec 296: "New spec" sits beside ← Back, on one line.
  test("the title sits inside .backhead, right after ← Back, and appears as <h1> exactly once", () => {
    const html = newPage();
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/">← Back</a><h1>New spec</h1></div>',
    );
    expect(html.match(/<h1>New spec<\/h1>/g)?.length ?? 0).toBe(1);
  });

  // Criteria 2, 7: one back-navigation control, never two — the bottom
  // Cancel this page used to draw beside Create is gone, its job done by
  // the top Back link.
  test("exactly one back-navigation control, no separate Cancel", () => {
    const html = newPage();
    expect(html.match(/← Back/g)).toHaveLength(1);
    expect(html).not.toContain(">Cancel<");
  });

  // Criterion 1.
  test("two tools configured: a grouped Model select and a paired AI select, both pre-filled", () => {
    const html = newPage({ modelChoices: TWO_TOOLS, defaultModels: { create: "fable", default: "sonnet" } });
    const model = html.match(/<select name="model\.create"[\s\S]*?<\/select>/)![0];
    expect(model).toContain('<optgroup label="Claude Code">');
    expect(model).toContain('<optgroup label="Codex">');
    // The step's own configured default outranks the table's fallback.
    expect(model).toMatch(/<option value="fable"[^>]*selected/);
    const ai = html.match(/<select data-ai="model\.create"[\s\S]*?<\/select>/)![0];
    expect(ai).toContain(">Claude Code</option>");
    expect(ai).toContain(">Codex</option>");
    // The AI shown is the tool of the model beside it, and each option
    // carries the model that AI would fill in.
    expect(ai).toMatch(/<option value="claude"[^>]*data-default="fable"[^>]*selected/);
    expect(ai).toMatch(/<option value="codex"[^>]*data-default="codex-fast"/);
  });

  // Risk 1: the one detail the browser's pairing depends on. Without a
  // matching `form` value the AI select renders, looks pressable, and
  // silently writes into nothing.
  test("the Model and AI selects carry the same form id — and the form actually has it", () => {
    const html = newPage({ modelChoices: TWO_TOOLS });
    const id = formAttr(html, 'name="model\\.create"');
    expect(id).toBeTruthy();
    expect(formAttr(html, 'data-ai="model\\.create"')).toBe(id!);
    expect(html).toContain(`<form method="post" action="/api/queue/create" class="newspecform" id="${id}"`);
  });

  // Criterion 3: `aiPicker`'s own rule — an AI picker offering one AI
  // has nothing to offer.
  test("one tool configured: the Model select alone, no AI select", () => {
    const html = newPage({
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12 }],
      defaultModels: { default: "sonnet" },
    });
    expect(html).toContain('name="model.create"');
    expect(html).not.toContain('data-ai="model.create"');
    expect(html).toMatch(
      /<span class="aimodel"><select name="model\.create"[\s\S]*?<\/select><\/span>/,
    );
    expect(html).not.toContain("<span>AI</span>");
    // Pre-filled from the table's fallback when the step names nothing.
    expect(html).toMatch(/<option value="sonnet"[^>]*selected/);
  });

  // Criterion 2: "nothing chosen means no line", the same answer
  // `dependsOnField` and `modelPicker` both already give.
  test("no model configured at all: neither control is drawn", () => {
    for (const opts of [{}, { modelChoices: [] }]) {
      const html = newPage(opts);
      expect(html).not.toContain('name="model.create"');
      expect(html).not.toContain('data-ai="model.create"');
      // ...and no caption left hanging over nothing.
      expect(html).not.toContain(">Model</span>");
    }
  });

  // Criterion 4. Today the toggle simply omits itself from `/` when
  // nothing may be created in — a page reachable by its own URL cannot
  // answer that way.
  test("with nothing to create in, the page says so instead of showing an empty form", () => {
    const html = newPage({ createProjects: [] });
    expect(html).not.toContain('action="/api/queue/create"');
    expect(html).toContain("No project on this machine");
  });

  // Spec 309: nothing on this page said requirements would be drafted
  // from the text, or that a Requirements section written here is left
  // alone — the only hint lived in a job log a headless run never shows.
  test("the Description field carries a hint about drafted requirements", () => {
    const html = newPage();
    expect(html).toContain(
      '<small class="muted small">Requirements will be drafted from this ' +
        'text — a "## Requirements" section you write here is left as it ' +
        "stands.</small>",
    );
    const field = html.slice(
      html.indexOf('<textarea name="description"'),
      html.indexOf("</label>", html.indexOf('<textarea name="description"')),
    );
    expect(field).toContain("<small");
  });

  test("a refusal carried back in the query string is shown above the form", () => {
    const html = newPage({ error: "no such project: nope" });
    expect(html).toContain("no such project: nope");
    expect(html.indexOf("no such project: nope")).toBeLessThan(
      html.indexOf('action="/api/queue/create"'),
    );
  });
});

// --- spec 342: the New spec page can run the whole workflow from the start ---
//
// The page used to make the spec and stop — going on to analyze,
// implement and archive was a separate press per phase from the Specs
// list, after the spec existed. This is the same phase table that row
// draws, reused rather than copied, so a reader can tick the phases they
// already know they want before the spec exists at all.
describe("spec 342: the phase table", () => {
  const newPage = (opts: Partial<NewSpecPageOptions> = {}) =>
    renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-08-19T00:00:00Z", {
      createProjects: ["aide"],
      targets: [],
      ...opts,
    });

  const table = (html: string) =>
    html.slice(html.indexOf('<table class="list">'), html.indexOf("</table>") + "</table>".length);

  const subRow = (html: string, step: string) =>
    table(html).match(new RegExp(`<tr class="subrow" data-step="${step}">.*?</tr>`))?.[0] ?? "";

  // REQ-1.
  test("one row per phase, in workflow order", () => {
    const html = table(newPage());
    expect(PHASE_LINES).toEqual(["create", "analyze", "implement", "archive"]);
    const at = PHASE_LINES.map((step) => html.indexOf(`data-step="${step}"`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  // REQ-2: ticked, disabled, and carries no `name` — a disabled field is
  // never submitted either way, but the missing name is the belt as
  // well as the braces `phase-rows.ts`'s own `create` box relies on.
  test("the create row's tick is checked, disabled, and posts nothing", () => {
    const line = subRow(newPage(), "create");
    const box = line.match(/<input type="checkbox"[^>]*value="create"[^>]*>/)?.[0] ?? "";
    expect(box).toContain("checked");
    expect(box).toContain("disabled");
    expect(box).not.toContain("name=");
  });

  // REQ-3, REQ-4: every other phase's tick posts `name="steps"` and is
  // NOT checked by default, so an untouched form ticks nothing beyond
  // `create`.
  test("analyze/implement/archive ticks post name=\"steps\" with their own value, unticked by default", () => {
    const html = newPage();
    for (const step of ["analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      const box = line.match(new RegExp(`<input type="checkbox"[^>]*value="${step}"[^>]*>`))?.[0] ?? "";
      expect(box).toContain('name="steps"');
      expect(box).not.toContain("checked");
    }
  });

  // REQ-1, REQ-7: every picker on the page posts to the page's own
  // form, whichever phase it is on — the New spec page has no `g` to
  // derive one from, so every select has to carry `formIdOverride`
  // explicitly.
  test("every picker's form attribute is the page's own form id", () => {
    const html = table(newPage({ modelChoices: [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12, tool: "codex" }] }));
    const forms = [...html.matchAll(/<select[^>]*\bform="([^"]*)"/g)].map((m) => m[1]);
    expect(forms.length).toBeGreaterThan(0);
    expect(forms.every((f) => f === "new-spec-form")).toBe(true);
  });

  // REQ-6: a phase nobody has ever run or picked a model for shows the
  // configured default — the same fallback `create`'s own picker
  // already used, since the page passes no `pendingModels` at all.
  test("REQ-6: analyze/implement/archive pre-fill from the configured default, same as create", () => {
    const html = newPage({
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12 }],
      defaultModels: { analyze: "fable", default: "sonnet" },
    });
    const line = subRow(html, "analyze");
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
    const implementLine = subRow(html, "implement");
    expect(implementLine).toMatch(/<option value="sonnet"[^>]*selected/);
  });

  // REQ-8: the create row's own picker markup is byte-identical to what
  // `aiPicker`/`modelPicker` return when called directly — proof the
  // page draws it by calling them, not by a parallel hand-rolled copy.
  test("REQ-8: the create row's pickers are produced by aiPicker/modelPicker themselves", () => {
    const models = [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12, tool: "codex" as const }];
    const html = newPage({ modelChoices: models, defaultModels: { default: "sonnet" } });
    const line = subRow(html, "create");
    const row: SpecGroup = {
      project: "", specFolder: "new", named: false, state: "not-started",
      spentUsd: 0, costUnmeasured: false, phases: [], done: [], dependsOn: [], analyzeStale: false,
    };
    const opts = { modelChoices: models, defaultModels: { default: "sonnet" } };
    const expectedAi = aiPicker(row, opts, "create", false, false, undefined, undefined, "new-spec-form");
    const expectedModel = modelPicker(row, opts, "create", false, false, undefined, undefined, "new-spec-form");
    expect(line).toContain(expectedAi);
    expect(line).toContain(expectedModel);
  });
});

describe("spec 113: the runs explanation is a popover beside the filter chips", () => {
  const page = (opts: Partial<QueuePageOptions> = {}) =>
    renderQueuePage([], "2026-08-19T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [],
      ...opts,
    });

  // Everything the rows renderer puts out ahead of the table — which is
  // the filter bar and nothing else.
  const beforeTable = (html: string) => html.slice(0, html.indexOf('<table class="list speclist">'));

  test("the popover stays inside the refreshed rows before the New-spec link", () => {
    const html = page({ createProjects: ["aide"] });
    // The only `.intro` disclosure left on this page is inside the
    // refreshed rows container, immediately before the New-spec link.
    expect(html.indexOf('<details class="intro">')).toBeGreaterThan(html.indexOf('id="jobrows"'));
    expect(html.indexOf('<details class="intro">')).toBeLessThan(html.indexOf('href="/new"'));
  });

  test("the runner-unavailable notice still needs no click", () => {
    const html = page({ runnerAvailable: false });
    expect(html).toContain("No runner is installed");
    // "nothing here spends money" is safety-relevant context and must
    // not need a click.
    expect(html.indexOf("No runner is installed")).toBeLessThan(
      html.indexOf('<details class="intro">'),
    );
  });

  test("the popover sits in the filter bar when only one project has specs", () => {
    const bar = beforeTable(renderQueueRows([row()], { runnerAvailable: true, targets: [] }));
    expect(bar).toContain('<details class="intro">');
    expect(bar).toContain(">?</summary>");
  });

  test("it sits there with several projects too, before the state trigger", () => {
    const bar = beforeTable(
      renderQueueRows([row(), row({ id: "job-2", project: "atlasaurus", specFolder: "12-other" })], {
        runnerAvailable: true,
        targets: [],
      }),
    );
    // The state control is the only filter left: the project filter went
    // on 2026-08-23. Spec 305 then moved the state trigger to sit
    // between this explanation and New spec (its REQ-3), so the
    // explanation now comes BEFORE it rather than after.
    expect(bar).toContain('data-filter="state"');
    expect(bar.indexOf('<details class="intro">')).toBeLessThan(bar.indexOf('data-filter="state"'));
  });

  // Spec 289 replaced this popover's "how runs work" copy with the
  // search-scope explanation that used to sit in its own paragraph
  // below the search form — dropped from the page entirely, not moved
  // anywhere else, so there is no "stopped"/cap wording left to assert.
  test("the copy says what the search reads, not how runs work", () => {
    const bar = beforeTable(renderQueueRows([row()], { runnerAvailable: true, targets: [] }));
    expect(bar).toContain("Searches the");
    expect(bar).not.toContain("<em>stopped</em>");
  });
});
