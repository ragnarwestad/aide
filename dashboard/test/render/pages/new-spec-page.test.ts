import { describe, expect, test } from "bun:test";
import {
  renderNewSpecPage,
  renderSpecsPage,
  renderSpecsRows,
  PHASE_LINES,
  type NewSpecPageOptions,
  type SpecsPageOptions,
} from "../../../src/render";
import { aiPicker, modelPicker } from "../../../src/render/pages/specs-list/model-picker.ts";
import { type SpecGroup } from "../../../src/render/pages/specs-list";
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
  const page = (opts: Partial<SpecsPageOptions> = {}) =>
    renderSpecsPage([], "2026-08-19T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
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
  test("the front page offers a plain link, and not the form itself", () => {
    const html = page();
    expect(html).toContain('<a class="btn primary" href="/new">New</a>');
    // `/new` is the only place the form is rendered.
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

  // Nothing is chosen for the reader: the first project in the list was
  // where every untouched form used to land.
  test("the Project field starts on \"Choose a project…\" with nothing else selected (AC-1)", () => {
    for (const createProjects of [["aide", "aide-dashboard"], ["aide"]]) {
      const html = newPage({ createProjects });
      const select = html.slice(
        html.indexOf('<select name="project" required>'),
        html.indexOf("</select>", html.indexOf('<select name="project" required>')),
      );
      expect(select.startsWith('<select name="project" required><option value="" selected>Choose a project…</option>')).toBe(true);
      expect(select.match(/selected/g)!.length).toBe(1);
      for (const p of createProjects) expect(select).toContain(`<option value="${p}">${p}</option>`);
    }
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
      '<select name="project" required>',
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
    // between Project's row and Depends on. Spec 476 moved the two
    // acceptance switches beside the phase table, in a shared `.frow` —
    // the frow this assertion now finds between Project's row and the
    // table is that shared one, opening just ahead of the table.
    const betweenProjectAndTable = html.slice(
      html.indexOf('<select name="project" required>'),
      html.indexOf('<table class="list">'),
    );
    expect(betweenProjectAndTable.endsWith('</select></label></span><span class="frow">')).toBe(true);
    const betweenTableAndDepends = html.slice(
      html.indexOf("</table>"),
      html.indexOf('<span class="lbl">Depends on</span>'),
    );
    // Spec 476: the switches' column, stacked, closing the table's own
    // `.frow`, then Depends on's own `.frow` opens. Spec 472: each
    // switch's own line still carries the `field`/`fieldhead`/`fieldend`
    // shell "Depends on" already uses, so its "(?)" stays on screen —
    // it no longer carries `wide`, since the column beside the table (not
    // a full-width line) is now what sizes it. Spec 474: Depends on's own
    // shell is `field wide depends-pair` around two `.depends-col`s, the
    // first one opening with `.fieldhead` (its "(?)") and its `.lbl` label.
    expect(betweenTableAndDepends).toMatch(
      /^<\/table><span class="acceptance-col"><span class="field"><span class="fieldhead"><label class="phase[^>]*data-acceptance="1"[\s\S]*?<\/label><span class="fieldend">(<details class="intro">[\s\S]*?<\/details>)?<\/span><\/span><\/span><span class="field"><span class="fieldhead"><label class="phase[^>]*data-ai-formulate="1"[\s\S]*?<\/label><span class="fieldend">(<details class="intro">[\s\S]*?<\/details>)?<\/span><\/span><\/span><\/span><\/span><span class="frow"><span class="field wide depends-pair"><span class="depends-col"><span class="fieldhead">$/,
    );
    expect(html).toMatch(/<span class="factions"><button[^>]*>Create<\/button>/);
    // Each chip says which project it belongs to.
    expect(html).toMatch(/data-project="aide-dashboard"[^]*?value="01-first"/);
  });

  // AC-1: 10 lines by default, not 4 — the box a spec author gets before
  // any manual resize.
  test("AC-1: the Description field defaults to 10 rows", () => {
    const html = newPage();
    expect(html).toContain('<textarea name="description" rows="10"');
  });

  // --- spec 228: the model the FIRST step runs on ----------------------------
  //
  // The four steps that follow `create` each have a phase line with a
  // model picker on it. `create` has none — it makes the spec those
  // lines belong to — so this form is the only place its model can be
  // chosen. Same two controls the phase lines draw, same helpers, same
  // single-tool rule.
  const TWO_TOOLS: NonNullable<NewSpecPageOptions["modelChoices"]> = [
    { name: "sonnet" },
    { name: "fable" },
    { name: "codex-fast",  tool: "codex" },
  ];

  /** The value both selects have to agree on for `applyAiPick` to find
   *  one from the other (`specs-client.ts`: the lookup is by `name` AND
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

  // Criteria 2, 7: one back-navigation control, never two — the bottom
  // Cancel this page used to draw beside Create is gone, its job done by
  // the top Back link.
  test("exactly one back-navigation control, no separate Cancel", () => {
    const html = newPage();
    expect(html.match(/← Back/g)).toHaveLength(1);
    // The page-wide leave box (spec 518) carries its own Cancel; the page's controls do not.
    expect(html.replace(/<dialog class="leaveapp[\s\S]*?<\/dialog>/, "")).not.toContain(">Cancel<");
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
  test("one tool configured: the AI is named beside the model, not hidden", () => {
    const html = newPage({
      modelChoices: [{ name: "sonnet" }, { name: "fable" }],
      defaultModels: { default: "sonnet" },
    });
    expect(html).toContain('name="model.create"');
    // One tool is one option, not a hidden column: a model select under
    // a heading that says AI is what hiding it produced.
    expect(html).toContain('data-ai="model.create"');
    expect(html).toMatch(
      /<span class="aimodel"><select data-ai="model\.create"[\s\S]*?<select name="model\.create"[\s\S]*?<\/select><\/span>/,
    );
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

  // Spec 472, AC-4: the muted sentence under Description duplicated, in
  // different words, what the AI-formulate switch's own "(?)" already
  // said, and sat off the visible page — its one piece of information
  // not said elsewhere (a hand-written "## Acceptance criteria" section
  // is left alone either way) moved into that "(?)" instead.
  test("the Description field carries no hint of its own; the AI-formulate popover says it all (spec 472)", () => {
    const html = newPage();
    expect(html).not.toContain('<small class="muted small">');
    const formulateIdx = html.indexOf('name="aiFormulateAcceptance"');
    const popover = html.slice(formulateIdx, html.indexOf("</details>", formulateIdx));
    expect(popover).toContain(
      'A "## Acceptance criteria" section you write in the description yourself is left as it stands either way.',
    );
  });

  test("a refusal carried back in the query string is shown above the form", () => {
    const html = newPage({ error: "no such project: nope" });
    expect(html).toContain("No such project: nope");
    expect(html.indexOf("No such project: nope")).toBeLessThan(
      html.indexOf('action="/api/queue/create"'),
    );
  });

  // Spec 437, AC-1/AC-2: New spec is a subpage.
  test("draws no site-level tab bar", () => {
    expect(newPage()).not.toContain('<nav class="tabbar">');
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

  // REQ-1, REQ-2: every other phase's tick posts `name="steps"` and IS
  // checked by default, so an untouched form queues all four phases.
  test("analyze/implement/archive ticks post name=\"steps\" with their own value, checked by default", () => {
    const html = newPage();
    for (const step of ["analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      const box = line.match(new RegExp(`<input type="checkbox"[^>]*value="${step}"[^>]*>`))?.[0] ?? "";
      expect(box).toContain('name="steps"');
      expect(box).toContain("checked");
    }
  });

  // REQ-1, REQ-7: every picker on the page posts to the page's own
  // form, whichever phase it is on — the New spec page has no `g` to
  // derive one from, so every select has to carry `formIdOverride`
  // explicitly.
  test("every picker's form attribute is the page's own form id", () => {
    const html = table(newPage({ modelChoices: [{ name: "sonnet" }, { name: "fable",  tool: "codex" }] }));
    const forms = [...html.matchAll(/<select[^>]*\bform="([^"]*)"/g)].map((m) => m[1]);
    expect(forms.length).toBeGreaterThan(0);
    expect(forms.every((f) => f === "new-spec-form")).toBe(true);
  });

  // REQ-6: a phase nobody has ever run or picked a model for shows the
  // configured default — the same fallback `create`'s own picker
  // already used, since the page passes no `pendingModels` at all.
  test("REQ-6: analyze/implement/archive pre-fill from the configured default, same as create", () => {
    const html = newPage({
      modelChoices: [{ name: "sonnet" }, { name: "fable" }],
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
    const models = [{ name: "sonnet" }, { name: "fable",  tool: "codex" as const }];
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

  // REQ-2, REQ-3, REQ-5 (spec 394): the switch is paired with "Depends
  // on" rather than living inside the phase table, and starts CHECKED —
  // Said the POSITIVE way and CHECKED by default. It read "acceptance
  // ticking not required", unticked, which meant "it IS required" — a
  // double negative to unwind every time. And the default matters:
  // `analyze` decides once, from this, and locks the switch afterwards,
  // so a spec that quietly skipped its acceptance table could only be
  // put right by running the whole analysis again — a quarter of an
  // hour and real money for one box.
  test("spec 394/426: the acceptance switch is checked by default", () => {
    const html = newPage();
    const box = html.match(/<input type="checkbox"[^>]*name="acceptanceRequired"[^>]*>/)?.[0] ?? "";
    expect(box).not.toBe("");
    expect(box).toContain("checked");
    expect(html).toContain("Acceptance ticking required");
    expect(html).not.toContain("acceptance ticking not required");
    expect(box).toContain('value="1"');
    expect(box).toContain('form="new-spec-form"');
  });

  // Spec 454: the field's own explanation moves off `title` into a "(?)".
  test("spec 454: the acceptance switch's explanation is a '(?)', not a title", () => {
    const html = newPage();
    expect(html).not.toMatch(
      /title="Analyze writes an acceptance-criteria table, and archive waits/,
    );
    expect(html).toContain(
      "<p>Analyze writes an acceptance-criteria table, and archive waits until every row is ticked. " +
        "Cleared, the requirements stay written down and nothing is left to tick.</p>",
    );
  });

  // Spec 472, AC-3: the "(?)" is anchored in the same `.field` >
  // `.fieldhead` > `.fieldend` shell "Depends on" already uses, so it
  // stays on screen. Spec 476 dropped `wide` from this shell — the
  // switch sits in the column beside the phase table now, not on a
  // full-width line of its own.
  test("spec 472: the acceptance switch's '(?)' is anchored in a field/fieldhead/fieldend shell", () => {
    const html = newPage();
    const acceptIdx = html.indexOf('name="acceptanceRequired"');
    const shellStart = html.lastIndexOf('<span class="field">', acceptIdx);
    expect(shellStart).toBeGreaterThan(-1);
    const shell = html.slice(shellStart, html.indexOf("</details>", acceptIdx) + "</details>".length);
    expect(shell).toContain('<span class="fieldhead">');
    expect(shell).toContain('<span class="fieldend">');
  });

  // Spec 433, AC-4: "let AI formulate acceptance criteria", checked by
  // default — the same "checked, and a sibling of the acceptance switch"
  // shape, said the positive way for the same reason: unticking it is
  // meant to read as an active choice, not a default a reader stumbles
  // into.
  test("spec 433: the AI-formulate switch is checked by default, beside the acceptance switch", () => {
    const html = newPage();
    const box = html.match(/<input type="checkbox"[^>]*name="aiFormulateAcceptance"[^>]*>/)?.[0] ?? "";
    expect(box).not.toBe("");
    expect(box).toContain("checked");
    expect(box).toContain('value="1"');
    expect(box).toContain('form="new-spec-form"');
    expect(html).toContain("Let AI formulate acceptance criteria");
    // Spec 454: the field's own explanation moves off `title` into a "(?)".
    expect(html).not.toMatch(/title="Ticked, create runs a short AI session/);
    // Spec 472, AC-4: extended with the fact the Description hint's own
    // removal carried over — a hand-written "## Acceptance criteria"
    // section is left alone either way.
    expect(html).toContain(
      "<p>Ticked, create runs a short AI session that drafts the acceptance criteria from this " +
        "description; cleared, create writes the spec directly from what is typed here — no AI " +
        "session, done in seconds. A \"## Acceptance criteria\" section you write in the " +
        "description yourself is left as it stands either way.</p>",
    );
    // Spec 476: its own field, right after the acceptance switch's, in
    // the same `.acceptance-col` beside the phase table — not its own
    // `.frow` below it.
    const acceptIdx = html.indexOf('name="acceptanceRequired"');
    const formulateIdx = html.indexOf('name="aiFormulateAcceptance"');
    expect(acceptIdx).toBeGreaterThan(-1);
    expect(formulateIdx).toBeGreaterThan(acceptIdx);
    const colStart = html.lastIndexOf('<span class="acceptance-col">', acceptIdx);
    expect(colStart).toBeGreaterThan(-1);
    expect(html.lastIndexOf('<span class="acceptance-col">', formulateIdx)).toBe(colStart);
    // Adjacent: the acceptance switch's own field closes right where the
    // AI-formulate switch's field opens, nothing else sitting between
    // them — no other field or control shares the column.
    const between = html.slice(
      html.indexOf("</details>", acceptIdx),
      html.lastIndexOf('<span class="field">', formulateIdx),
    );
    expect(between).toBe("</details></span></span></span>");
  });

  // Spec 472, AC-3: same anchoring as the acceptance switch, above.
  test("spec 472: the AI-formulate switch's '(?)' is anchored in a field/fieldhead/fieldend shell", () => {
    const html = newPage();
    const formulateIdx = html.indexOf('name="aiFormulateAcceptance"');
    const shellStart = html.lastIndexOf('<span class="field">', formulateIdx);
    expect(shellStart).toBeGreaterThan(-1);
    const shell = html.slice(shellStart, html.indexOf("</details>", formulateIdx) + "</details>".length);
    expect(shell).toContain('<span class="fieldhead">');
    expect(shell).toContain('<span class="fieldend">');
  });

  // Spec 415, REQ-2: the caption row shares phaseCaptionCells() with the
  // Specs list's own 6-column table, but this page's phase rows carry
  // only 2 <td>s each and the table has no <colgroup> — the shared
  // helper's 4 list-only cells had nothing under them and nothing
  // sizing them, which read as a stray blank field beside the picker.
  test("spec 415 REQ-2: the caption row and phase rows both have exactly 2 <td>s", () => {
    const html = newPage({ modelChoices: [{ name: "sonnet" }] });
    const captionRow = html.match(/<tr class="subrow" data-caption="1">.*?<\/tr>/)?.[0] ?? "";
    expect(captionRow).not.toBe("");
    expect(captionRow.match(/<td/g)?.length).toBe(2);
    expect(captionRow).not.toContain('data-col="started"');
    expect(captionRow).not.toContain('data-col="cost"');
    expect(captionRow).not.toContain("<td></td>");

    const analyzeRow = subRow(html, "analyze");
    expect(analyzeRow.match(/<td/g)?.length).toBe(2);
  });

  // REQ-1, REQ-2 (spec 476): the switches sit beside the phase table, in
  // the same `.frow`, above "Depends on" — a "Depends on" field is only
  // drawn at all when there is another spec to build on, so this
  // exercises that case rather than the bare page.
  test("spec 476: the acceptance switches sit beside the phase table, in its own .frow, above Depends on", () => {
    const html = newPage({ targets: [{ project: "aide", specFolder: "80-earlier" }] });
    const tableIdx = html.indexOf('<table class="list">');
    const acceptIdx = html.indexOf('name="acceptanceRequired"');
    const formulateIdx = html.indexOf('name="aiFormulateAcceptance"');
    const dependsIdx = html.indexOf('<span class="lbl">Depends on</span>');
    expect(tableIdx).toBeGreaterThan(-1);
    expect(acceptIdx).toBeGreaterThan(tableIdx);
    expect(formulateIdx).toBeGreaterThan(acceptIdx);
    expect(dependsIdx).toBeGreaterThan(formulateIdx);
    // The table and both switches share the one `.frow` that opens just
    // ahead of the table — no `.frow` of their own each, unlike Depends
    // on's, which opens its own further down.
    const tableFrowStart = html.lastIndexOf('<span class="frow">', tableIdx);
    const acceptFrowStart = html.lastIndexOf('<span class="frow">', acceptIdx);
    const dependsFrowStart = html.lastIndexOf('<span class="frow">', dependsIdx);
    expect(tableFrowStart).toBeGreaterThan(-1);
    expect(acceptFrowStart).toBe(tableFrowStart);
    expect(dependsFrowStart).toBeGreaterThan(tableFrowStart);
    // Both switches sit in one shared column, beside the table rather
    // than among its rows.
    const colStart = html.indexOf('<span class="acceptance-col">');
    expect(colStart).toBeGreaterThan(tableIdx);
    expect(colStart).toBeLessThan(acceptIdx);
  });
});

// Spec 474: the New-spec page's own Depends-on field lays the picked
// box and the pick list side by side, both framed alike, each with its
// own translated label — instead of one stacked field with a "Selected:"
// caption and a "none" placeholder above an uncapped, unframed box.
describe("spec 474: Depends on is two same-styled fields side by side", () => {
  const newPage = (opts: Partial<NewSpecPageOptions> = {}) =>
    renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-08-19T00:00:00Z", {
      createProjects: ["aide"],
      targets: [{ project: "aide", specFolder: "80-earlier" }],
      ...opts,
    });

  // AC-1, AC-2: one shared field, two columns, picked/"Depends on" before
  // pick-list/"Select".
  test("the picked box and the pick list sit in one field, side by side, picked column first", () => {
    const html = newPage();
    const fieldIdx = html.indexOf('<span class="field wide depends-pair">');
    expect(fieldIdx).toBeGreaterThan(-1);
    const dependsOnColIdx = html.indexOf('<span class="lbl">Depends on</span>', fieldIdx);
    const selectColIdx = html.indexOf('<span class="lbl">Select</span>', fieldIdx);
    expect(dependsOnColIdx).toBeGreaterThan(fieldIdx);
    expect(selectColIdx).toBeGreaterThan(dependsOnColIdx);
    expect((html.match(/<span class="depends-col">/g) ?? []).length).toBe(2);
  });

  // AC-4: nothing is ever pre-ticked on this page, so the picked box is
  // always the empty case AC-4 talks about — still a framed
  // `.phases.picked`, with no "Selected:"/"none" text anywhere.
  test("the picked box renders empty and framed, with no 'Selected:' or 'none' text", () => {
    const html = newPage();
    const formStart = html.indexOf('<form method="post"');
    const form = html.slice(formStart, html.indexOf("</form>", formStart));
    expect(form).toContain('<span class="phases picked"></span>');
    expect(form).not.toContain('<span class="lbl">Selected:</span>');
    expect(form).not.toContain("none</span>");
    expect(form).not.toContain("data-none");
  });

  // AC-5: labels translated per `opts.lang`, defaulting to English.
  test("the labels are 'Depends on'/'Select' in English, 'Avhenger av'/'Velg' in Norwegian", () => {
    const en = newPage();
    expect(en).toContain('<span class="lbl">Depends on</span>');
    expect(en).toContain('<span class="lbl">Select</span>');
    const nb = newPage({ lang: "nb" });
    expect(nb).toContain('<span class="lbl">Avhenger av</span>');
    expect(nb).toContain('<span class="lbl">Velg</span>');
  });

  // AC-6: no separate "Depends on" section title — the left column's own
  // label is the only place the words "Depends on" appear in the FORM
  // (the inlined stylesheet's own comments, e.g. phase-chip.css's, say
  // "Depends on" too, and are not this AC's concern).
  test("'Depends on' appears exactly once in the form, as the left column's own label", () => {
    const html = newPage();
    const formStart = html.indexOf('<form method="post"');
    const form = html.slice(formStart, html.indexOf("</form>", formStart));
    expect((form.match(/Depends on/g) ?? []).length).toBe(1);
    expect(form).toContain('<span class="lbl">Depends on</span>');
  });
});

describe("spec 113: the runs explanation is a popover beside the filter chips", () => {
  const page = (opts: Partial<SpecsPageOptions> = {}) =>
    renderSpecsPage([], "2026-08-19T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
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
    const bar = beforeTable(renderSpecsRows([row()], { runnerAvailable: true, targets: [] }));
    expect(bar).toContain('<details class="intro">');
    expect(bar).toContain(">?</summary>");
  });
});

// --- spec 506: "Try again" opens the form with what was typed -----------------
describe("spec 506: New spec can arrive filled in", () => {
  const newPage = (opts: Partial<NewSpecPageOptions> = {}) =>
    renderNewSpecPage([{ label: "Overview", path: "projects.html" }], "2026-09-19T00:00:00Z", {
      createProjects: ["aide", "other"],
      targets: [],
      ...opts,
    });
  const typed = { project: "other", title: `A "quoted" <b>title</b> & more`, description: "line one\nline <two> & $&" };

  test("project selected, title and description hold the text as typed (AC-3)", () => {
    const html = newPage({ prefill: typed });
    expect(html).toContain(`<option value="other" selected>other</option>`);
    expect(html).not.toContain(`<option value="" selected>`);
    expect(html).toContain(`value="A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt; &amp; more"`);
    expect(html).toContain(`>line one\nline &lt;two&gt; &amp; $&amp;</textarea>`);
  });

  test("a project no longer offered is not selected, the text is still filled in (AC-3)", () => {
    const html = newPage({ prefill: { ...typed, project: "gone" } });
    expect(html).toContain(`<option value="" selected>`);
    expect(html).not.toContain(`value="gone"`);
    expect(html).toContain("A &quot;quoted&quot;");
  });

  test("with no prefill the form is the empty one it always was (AC-3)", () => {
    const html = newPage();
    expect(html).toContain(`<option value="" selected>`);
    expect(html).toContain(`required placeholder="what the spec is about, in a few words">`);
    expect(html).toContain(`placeholder="the problem, and what you want instead"></textarea>`);
  });
});
