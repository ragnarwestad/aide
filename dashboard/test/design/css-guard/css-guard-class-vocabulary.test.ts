// Split out of css-token-guard.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CSS,
  LOADING_CSS,
  ROOT,
  RENDER_FILES,
  deadRules,
  emittedWords,
  isEmitted,
  isEmittedIn,
  selectorClasses,
  stringTexts,
} from "../css-guard-fixtures.ts";

// --- the class vocabulary ---------------------------------------------------

/** The components and their documented modifiers. Anything a page
 *  wants to look like has to be one of these. */
const COMPONENTS = [
  "btn", "primary", "ok", "danger", "busy", "spin",
  // Spec 518: the two answers of a confirm box, on one row.
  "dialogactions",
  // Spec 525: the "Closing…" heading of a dialog that stands while its job runs.
  "standingtitle",
  // A control that is its icon alone, no button frame: the spec page's
  // PDF link, and the red PDF icon it carries (2026-09-09).
  "iconlink", "icon-pdf",
  // Spec 208: what a control wears between the click and the answer,
  // for the two kinds of waiting a BUTTON's `busy` does not cover — an
  // in-page row swap, and a real navigation to another document.
  "awaiting",
  "badge", "b-idle", "b-running", "b-waiting", "b-ready", "b-refused", "b-done",
  "phases", "phase", "default", "checked", "done", "off", "box",
  // the picked half of the Depends-on control (spec 404): the same
  // .phases wrapper, uncapped, ahead of the scrolling remainder.
  "picked",
  "rowmsg", "failed", "waiting", "info",
  // the invisible holder around the spec row's state badge (2026-08-24),
  // mirroring actionslot: it reserves the width on mobile so the pill
  // inside keeps its natural size.
  "badgeslot",
  // the "still checking" pulse (2026-08-24): the bar itself, and the
  // visually-hidden word inside it that screen readers get instead.
  "checking", "sr",
  // `fieldhead` is the label's own line when a field carries a "(?)":
  // the name at one end, the mark at the other.
  "field", "fieldhead", "fieldend", "wide",
  // spec 474: the New-spec page's own Depends-on field, side by side —
  // the shared wrapper and its two columns.
  "depends-pair", "depends-col",
  // spec 476: the two acceptance switches' own stacked column, beside
  // the phase table.
  "acceptance-col",
  // `headend`: where a spec stands, at the far end of the line naming it.
  "headend",
  // `formdoc`: a `.doc` whose content is fields, so it takes the
  // fields' own narrower right edge.
  "formdoc",
  // the WYSIWYG mount point (spec 292) and the raw textarea beside it —
  // the fallback CSS in css/field.css swaps which one is visible once
  // the client script sets data-mounted.
  "spec-editor-mount", "spec-editor-raw",
];

/** Class names `specs-client.ts` selects on or writes. They carry no
 *  styling of their own — renaming one silently breaks Run, Approve,
 *  Cancel, Merge or the refusal display in a browser, with no type
 *  error to catch it. */
const JS_HOOKS = [
  "rowrun", "actionform",
  "refused", "refusal", "newspecform", "frow", "factions",
  // spec 112: the Projects panel — the Add form and one Remove per
  // allowlisted project.
  "addprojectform", "removeform",
  // spec 486: the project page's own Settings Save form, excluded from
  // NEW_SPEC_FORM the same way the Add form already is.
  "projectsettingsform",
  // spec 258: the Deploy button on a project's own page.
  "deployform",
  // spec 276: specs-client.ts selects on all three — the Enabled
  // checkbox, the Run-now form, and the create/edit form (whose own
  // `input[name="cron"]` feeds the live cron-next preview).
  "scheduleenabled", "schedulerun", "scheduleform",
  // spec 277: the Delete confirmation, a plain POST with no submit
  // override — specs-client.ts binds bindTypedConfirm to it only.
  "scheduledeleteform",
  // spec 423: the queue list's own Cancel form, so the delegated
  // listener that opens its confirmation dialog can find it without
  // matching every `.actionform` on the page.
  "cancelform",
  // the page-wide leave-confirmation dialog (spec 478): a `confirmdialog`
  // shown in place of the native beforeunload prompt for an in-app link
  // click; unsaved-changes.ts selects it by class.
  "leaveapp",
  // the on/off switch (`switchControl()`): a track, its knob and the
  // word beside it.
  "switch", "switchtrack", "switchknob", "switchword",
];

/** Structure and layout: what a thing IS on the page, not what it looks
 *  like. Short on purpose — a new entry here is a decision, and it
 *  shows up in the diff as one. */
const STRUCTURE = [
  // the schedule form's notification choice: one full-width line.
  "schedulenotify",
  // the frame — "menu" and "menupanel" are the "…" disclosure in the
  // header and the box it opens (spec 119, which removed "layout").
  "pagehead", "brand", "mark", "mark-l", "mark-d", "surface", "actionslot",
  // The spec's own state drawn again inside the caption line's action
  // slot, for a phone (2026-09-10).
  "lbl",
  // The check mark beside the theme/language menus' own chosen row
  // (spec 475) — a name of its own since "check" below already means
  // two other things under this same .menupanel shape.
  "menucheck",
  // where the pips sit on a spec's name line, since the Progress
  // column went and they moved in beside the name (2026-08-22)
  "pipslot",
  // Spec 493: several messages on a notice line, each in its own box, and
  // the acceptance criteria unfolded under the held-back one.
  "msgstack", "rowchecks", "checksunread",
  // The empty row that closes each spec on the list, which the stylesheet
  // turns into the air between two cards (2026-09-25).
  "specgap",
  // Spec 500: a phase's latest messages, unfolded under its line — the
  // row, its list, the empty-state line and the link to the step's log.
  "phasemsgs", "phasemsglist", "phasemsgempty", "phasemsgopen",
  "tabbar", "tab",
  // The same bar one level in: a spec's seven tabs and a job's three,
  // which were filter pills until 2026-08-23 (2026-08-23, "IKKE bruke
  // chips i stedet for tabs").
  "subtabs",
  // The one width a document page shares: banner, tabs and panel
  // (2026-08-23).
  "doc",
  // "theme" is Theme's own sibling disclosure (spec 243, popup revision
  // 2026-08-25) — same trigger/panel look as "menu" via the shared
  // class, this one names which of the two a given "details.menu" is.
  // "state" is the state-filter dropdown's own (spec 289, replacing the
  // per-state chips) — a third "details.menu", named the same way.
  // "lang" is the language choice beside Theme (spec 350) — a fourth
  // "details.menu", named the same way. "unit" is the same again for
  // the header-level Units switch (spec 436).
  "menu", "menupanel", "theme", "lang", "unit", "state", "about", "aboutpanel", "aboutclose", "listtop",
  // the "…" menu's own flat mobile copy of the theme/language/unit rows
  // (spec 436): no second "details.menu" nested inside it (menu-script.ts's
  // closeAll() would close the outer menu on the same click) — a plain
  // wrapper div instead, shown only at phone width.
  "morerows",
  // a row's compact control in that copy (spec 507): the theme and unit
  // buttons side by side, and the rule between the three rows and the links.
  "seg", "menusep",
  // The board line in the header, and its copy at the top of the "…"
  // menu for phones (2026-09-10).
  "boardline", "boardrow",
  // a confirmation asked over the page instead of on one of its own
  // (2026-08-31, the schedule row's Delete): the same `<dialog>` the
  // About box is, and the panel inside it.
  "confirmdialog", "confirmpanel",
  // the Deploy panel's own state sentence, button and refusal line,
  // spaced apart by this container's gap rather than a component margin
  // (spec 377, design-system.md "Spacing lives in the container").
  "deploypanel",
  // the Deploy dialog's step list, each line's state word, and the
  // one-line area its finished message is written into (the dialog
  // keeps one size from the press to the end).
  "deploysteps", "deploystate", "deploymessage",
  // the covering layer a click that leaves the page gets, from the
  // click until the new document arrives (spec 314): the same
  // `<dialog>` shape About and the confirm box are.
  "pageoverlay",
  // The implement run's own note on one acceptance row, under the
  // criterion it belongs to.
  "checknote",
  "checktests",
  "untested",
  // The line that layer carries when the wait is long enough that a
  // spinner alone says too little — a deploy, which takes the service
  // down under the page. A navigation passes none and it stays hidden.
  "overlaynote",
  // text roles — "u-usd"/"u-tok" are the two halves of every
  // consumption figure (spec 118): both are rendered, and one CSS rule
  // each shows exactly the one the reader asked for.
  "small", "muted", "num", "label",
  // The spec's own name beside the project inside `.label` (2026-09-10):
  // the part that wraps, hanging under itself.
  "specname", "specpart", "desc", "summary", "counts",
  // one whole spec file, preformatted (spec 150) — the spec page shows
  // four of them and a phase's job page one
  "specfile",
  // the archive's own three: the search box, widened and uncaptioned,
  // and the two cells that must not wrap — the date (2026-08-23) and
  // what the spec cost in time (spec 207). All three are on the Specs
  // list since spec 221, which folded the archive into it.
  "archive-q", "archive-date", "archive-duration",
  // and the form that box sits in (spec 221): a line of its own under
  // the chips, because that line was already full. "searchfield" is the
  // box's own wrapper and "searchclear" the × inside it (spec 226) —
  // one press back to the whole list, and a link like every other
  // control on this page rather than a script.
  // "icon-search" is the magnifying glass inside the field, left-aligned
  // opposite "searchclear" (design handoff, 2026-08-25).
  "specsearch", "searchfield", "searchclear", "icon-search",
  "u-usd", "u-tok",
  // containers — "stack" was the vertical one (spec 124): the row's
  // action buttons, one under the next, in the list's first column. It
  // went with them in spec 157, which draws ONE button per row, beside
  // the state, in the page's ordinary "row" container. "tablewrap" is
  // the box a table too wide for the window scrolls inside, so the
  // PAGE never does (spec 155).
  "row", "tabpanel", "facts",
  // the shared "(?)" popover (spec 261's search-field help, and since
  // spec 311 every spec tab's own explanation of what it shows) — one
  // `helpPopover()` component in components.ts, not scoped to any one
  // row.
  "intro",
  // the one back-navigation link every subpage carries (spec 252),
  // deliberately not ".btn": it goes somewhere rather than submitting
  // anything. "backhead" is the flex row `backLink()` draws around it
  // and the page's own <h1> when a title is given (spec 296).
  "backlink", "backhead",
  // the Steps tab's per-row expand (spec 240): the row a step's own log
  // sits in.
  "steplog",
  "tablewrap",
  // the spec list
  // "modelcell" is where a phase line's three choices sit: the AI, the
  // model, and the phase's own box. Spec 165 gave the AI a column of
  // its own ("toolcell") and spec 192 took it back out again — a
  // column boundary is a reserved width and two lots of cell padding,
  // and the three read as three separate things with that between
  // them.
  "list", "spechead", "specstate", "foldcell", "subrow", "phasecell", "modelcell",
  // the spec list's own table (2026-08-24): the mobile stylesheet lays
  // it out as stacked blocks, and the archive page and the settings
  // table share "list" without wanting any of that.
  "speclist",
  // the mobile fold on a phase line (design handoff, mobile-spec-row):
  // the phase name's own wrapper, and the compact AI/model picker a
  // narrow screen draws: its box, the checkbox that opens it, the panel
  // it lays over the box, and one labelled field per select. All four
  // are inert on a wide screen, where the two selects stand as they
  // always have.
  "phasefold", "aimodel", "aimodelopen", "aimodelnow", "aimodelpanel", "aimodelfield",
  // spec 488: the button's own text, as two candidate spans — the bare
  // model name and the always tool-prefixed form — with a media query
  // deciding which one a phone-width screen shows.
  "aimodelshort", "aimodelfull",
  "spec-name", "spec-title",
  // the row's message panel (spec 143): a full-width row of its own, so
  // a sentence out of a status file or a runner's refusal wraps instead
  // of running off the right edge of a cell sized for a word.
  "specnotice",
  "empty", "fold", "shut", "sortlink", "on", "asc",
  "pipwrap", "pipletters", "pips", "pip", "now", "past", "todo", "waiting", "refused",
  // the project overview
  "proj-row", "error-text", "error",
  // the row's name is stretched across the whole row by an ::after
  // overlay (spec 233), so a press anywhere on it opens the project;
  // "proj-row-action" lifts the Remove button back above that overlay,
  // which is the only reason either class exists. "proj-row-warn"
  // (spec 369) is the same escape, for the row's link to the Config tab.
  "proj-row-link", "proj-row-action", "proj-row-warn",
  // a spec's remaining checks, at the top of its page (spec 182): the
  // Tasks-table rows of 4-status.md, grouped by phase, each undone one
  // carrying the button that ticks it. "checkbox" is that button — and
  // the same-sized span a done or archived row shows in its place, so
  // the two kinds of row line up.
  "checks", "checklist", "checkphase", "check", "checktask", "checkbox",
  // spec 509: a row's second box, "Not verified", and its read-only twin.
  "unverified", "readonly", "notverified",
  // spec 510: the note field of an archived row's Failed choice.
  "failcontrol",
  "failnote",
  // the heading over the two boxes of an acceptance list: "Verified", and
  // the two columns' names under it.
  "checkcolumns", "checkverified", "checkyes", "checkother",
  // the tab's head line and its Save/Cancel pair, on the same line (spec
  // 391) — the form's first child on the Checks tab and every document
  // tab, so this is the ONE class the two share for it.
  "panelhead",
  // the two forms on the spec page that post one of those checks and
  // the description (spec 229). A class of its own for one rule: their
  // buttons sit a step lower than an ordinary form's do.
  "specform",
  // the banner's own depends-on/acceptance form (spec 394), on every
  // tab including Checks — its own class rather than "specform", which
  // the Checks tab's tick form already carries; two forms sharing one
  // class on the same page broke the e2e suite's "find the one
  // .specform button" locator.
  "trackingform",
  // /schedule (spec 276, reworked spec 278): the detail page's
  // key/value overview and the Cron field's input.
  "kv", "cron-input",
  // the Config tab's button row (spec 301): always two buttons, right-
  // aligned, with its own margin to the table below.
  "configactions",
  // the Settings page's own table (spec 409): sized to its own content
  // rather than stretching to the frame, the same idea as "speclist"
  // scoped to this one table.
  "settingstable",
  // the Test servers page's own table (spec 519): a list table with
  // fixed, named columns that fill the page's frame.
  "testservers",
  // the Settings form itself (spec 409): the third dirty-latch prefix
  // spec-form-actions.ts's bind() loop registers, beside "specform" and
  // "trackingform".
  "settingsform",
  // the heading row that opens each group of settings rows: the steps
  // that act on a spec, the ones that do not, and the fallback.
  "settingsgroup",
  // the Settings page's per-AI tab: the panel itself, the list of
  // questions the check answered, and the block holding what the
  // preflight printed.
  "toolpanel", "checklist", "checkoutput",
  // spec 495: a scheduled run's report on the entry's page — the panel,
  // its header line and the sandboxed frame.
  "reportpanel", "reporthead", "reportframe",
  // spec 515: the loading element the spec page's first chunk carries.
  "pageloading",
];

/** One value of a family whose other values carry the rules: a phase
 *  chip's base state, a pip's, and a check row's "not verified". They are
 *  read as classes elsewhere (`.check.open`), so they stay classes and need
 *  no rule of their own. */
const STATE_VALUES = ["default", "todo", "notverified"];

const ALLOWED = new Set([...COMPONENTS, ...JS_HOOKS, ...STRUCTURE]);

/** Every class name a render file writes into markup. `${...}` is
 *  replaced first: a fragment built from an expression is skipped, so
 *  the check is on the literal vocabulary. The expressions themselves
 *  are all in `components.ts`, where the variant unions are typed and a
 *  bogus one is a compile error rather than a class nobody notices. */
function classesIn(source: string): string[] {
  const flat = source.replace(/\$\{[^}]*\}/g, "«»");
  const attrs = [
    ...flat.matchAll(/class="([^"]*)"/g),
    ...flat.matchAll(/className\s*=\s*"([^"]*)"/g),
  ];
  return attrs
    .flatMap((m) => m[1]!.split(/\s+/))
    .filter((c) => c && !c.includes("«"));
}

describe("render files use the component vocabulary and nothing else", () => {
  test("the glob found the render files at all", () => {
    expect(RENDER_FILES.length).toBeGreaterThan(4);
  });

  for (const file of RENDER_FILES) {
    test(`${file} introduces no class of its own`, async () => {
      const source = await Bun.file(join(ROOT, file)).text();
      const unknown = [...new Set(classesIn(source))].filter((c) => !ALLOWED.has(c));
      expect(unknown).toEqual([]);
    });
  }

  // The entry point (specs-client/index.ts) and its themed folder are
  // both reached by this one glob, so a class written in any of the
  // split files is caught the same as one in the entry.
  test("the browser code writes no class of its own either", async () => {
    const files = [...new Bun.Glob("src/specs-client/**/*.ts").scanSync(ROOT)];
    const source = (await Promise.all(files.map((f) => Bun.file(join(ROOT, f)).text()))).join("\n");
    const unknown = [...new Set(classesIn(source))].filter((c) => !ALLOWED.has(c));
    expect(unknown).toEqual([]);
  });
});

// --- the list holds only what is used ---------------------------------------

describe("the vocabulary lists cannot hold a name nothing uses", () => {
  test("every name on the list is emitted by a render or specs-client file (AC-1)", () => {
    expect([...ALLOWED].filter((n) => !isEmitted(n))).toEqual([]);
  });

  test("every name on the list has a CSS rule, is a script hook, or is a state value (AC-2)", () => {
    const styled = selectorClasses(CSS + LOADING_CSS);
    const bare = [...ALLOWED].filter((n) => !styled.has(n) && !JS_HOOKS.includes(n) && !STATE_VALUES.includes(n));
    expect(bare).toEqual([]);
  });

  test("no stylesheet rule selects only classes nothing emits (AC-4)", () => {
    expect(deadRules(CSS)).toEqual([]);
  });
});

describe("the reader of what is emitted (AC-3)", () => {
  const emits = (name: string, ...sources: string[]) => isEmittedIn(name, emittedWords(sources));

  test("a name only in a comment, an identifier, a substitution's code or a longer word is unemitted", () => {
    expect(emits("gone", '// gone\nconst x = 1;')).toBe(false);
    expect(emits("gone", "/* gone */ const x = 1;")).toBe(false);
    expect(emits("gone", "const gone = 1;")).toBe(false);
    expect(emits("gone", "const s = `${gone}`;")).toBe(false);
    expect(emits("current", 'const s = "aria-current";')).toBe(false);
    expect(emits("gone")).toBe(false);
  });

  test("a name in a plain string, a nested string, a template part or a b- prefix is emitted", () => {
    expect(emits("here", 'const s = "a here b";')).toBe(true);
    expect(emits("here", "const s = `x ${cond ? 'here' : ''}`;")).toBe(true);
    expect(emits("here", "const s = `<p class=\"here ${x}\">`;")).toBe(true);
    expect(emits("b-idle", 'const s = `<span class="badge b-${state}">`;')).toBe(true);
    expect(emits("spec-open", 'const s = `<tr id="spec-${key}">`;')).toBe(false);
  });

  test("the reader reads every render and client file without throwing, and finds the known names", () => {
    const words = emittedWords(
      [...RENDER_FILES, ...new Bun.Glob("src/specs-client/**/*.ts").scanSync(ROOT)].map((f) =>
        readFileSync(join(ROOT, f), "utf-8"),
      ),
    );
    for (const name of ["btn", "spechead", "b-running"]) expect(isEmittedIn(name, words)).toBe(true);
    expect(words.has("b-")).toBe(true);
  });

  test("a quote in a regex, a regex in a substitution, a // in a string and a division are read whole", () => {
    expect(stringTexts('const a = /"/g; const b = "kept";')).toEqual(["kept"]);
    expect(stringTexts("const a = `x ${s.replace(/`/g, '')} y`;")).toEqual(["x ", "", " y"]);
    expect(stringTexts('const a = "http://x"; const b = "kept";')).toEqual(["http://x", "kept"]);
    expect(stringTexts('const a = w! / 2; const b = "kept";')).toEqual(["kept"]);
    expect(stringTexts('const a = (n) / 2 / 3; const b = "kept";')).toEqual(["kept"]);
  });

  test("a literal that never ends throws", () => {
    expect(() => stringTexts('const a = "open')).toThrow();
    expect(() => stringTexts("const a = `open")).toThrow();
  });
});

describe("the dead-rule check (AC-4)", () => {
  const live = (name: string) => name === "live" || name === "b-running";
  const dead = (css: string) => deadRules(css, (n) => live(n) || isEmittedIn(n, new Set(["b-"])));

  test("a rule whose every selector names an unemitted class is dead", () => {
    expect(dead(".gone, .also-gone { color: red; }")).toEqual([".gone, .also-gone"]);
    expect(dead(".a .gone { color: red; }")).toEqual([".a .gone"]);
  });

  test("one selector that matches something keeps the rule", () => {
    expect(dead(".live, .gone { color: red; }")).toEqual([]);
  });

  test("a selector naming no class, and a b- state class, are not dead", () => {
    expect(dead("table { color: red; } from { top: 0; } to { top: 1px; }")).toEqual([]);
    expect(dead(".b-idle { color: red; }")).toEqual([]);
  });
});
