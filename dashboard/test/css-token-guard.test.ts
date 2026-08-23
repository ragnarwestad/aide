// The rule that stops the stylesheet drifting again.
//
// `css.ts` was the sum of one small addition per spec — ten font sizes
// with no scale, nine greys, and blue/amber/red from three unrelated
// palettes, each correct for its own feature and none looking at the
// page as a whole. Spec 102 replaced that with one token block and six
// components; this test is what keeps it that way. A spec that wants a
// look it cannot build from the tokens has to change the TOKENS —
// visibly, in the one block this test exempts — rather than add a
// colour beside them.
//
// Two rules, one file each side of them:
//
// 1. In `css.ts`, no colour literal and no font-size outside the token
//    block. The block is delimited by the sentinel comments below
//    rather than inferred, so the exemption is a thing you can see in
//    the source rather than a regex nobody re-reads.
// 2. In every render file, no CSS class that is not one of the
//    components, one of the named JS hooks, or one of the few
//    structural names on the list below. The list is deliberately
//    written out rather than pattern-matched: it is meant to be read
//    at a glance when it changes.
//
// Modelled on `source-is-text.test.ts`: glob, assert the glob found
// something, then one named test per file so bun's own output names
// the offender.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// The EVALUATED stylesheet, not the source text: since spec 130 each
// palette is written once, in a constant the four token blocks
// interpolate, so the raw `.ts` file no longer has the colours where
// the sentinels are. Every check below that reads css.ts's CONTENT
// reads this string; the class-name checks further down still glob
// the render files as text, which is a different question.
import { CSS } from "../src/render/css.ts";

const ROOT = join(import.meta.dir, "..");

const RENDER_FILES = [...new Bun.Glob("src/render/*.ts").scanSync(ROOT)].sort();

const TOKEN_START = "/* tokens:start */";
const TOKEN_END = "/* tokens:end */";

/** Everything in `css.ts` that is NOT a token declaration. The token
 *  block may appear more than once — light and the dark override — and
 *  every one of them is exempt. */
function outsideTokens(css: string): string {
  let out = "";
  let rest = css;
  for (;;) {
    const start = rest.indexOf(TOKEN_START);
    if (start === -1) return out + rest;
    out += rest.slice(0, start);
    const end = rest.indexOf(TOKEN_END, start);
    // An unclosed block would otherwise exempt the whole rest of the
    // file — the one way this guard could pass by accident.
    expect(end).toBeGreaterThan(start);
    rest = rest.slice(end + TOKEN_END.length);
  }
}

// `brand.ts` is the one exception, and it is not a stylesheet: the mark
// is a production SVG asset whose four bar colours ARE the brand, with
// their own dark-surface set. A token cannot be used inside a data URI.
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/g;

describe("css.ts uses tokens and nothing else", () => {
  test("the stylesheet is where the test thinks it is", () => {
    expect(RENDER_FILES).toContain("src/render/css.ts");
  });

  test("no colour literal outside the token block", () => {
    expect([...outsideTokens(CSS).matchAll(COLOUR)].map((m) => m[0])).toEqual([]);
  });

  test("no font-size outside the token block that is not a scale step", () => {
    const sizes = [...outsideTokens(CSS).matchAll(/font-size:\s*([^;}]+)/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(sizes.filter((v) => !/^var\(--fs-[a-z]+\)$/.test(v))).toEqual([]);
  });

  test("no raw length inside a font shorthand outside the token block", () => {
    const fonts = [...outsideTokens(CSS).matchAll(/(?<![-a-z])font:\s*([^;}]+)/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(fonts.filter((v) => /\d+(px|rem|em)\b/.test(v))).toEqual([]);
  });
});

// --- the theme a reader chose (spec 107) ------------------------------------
//
// Four token blocks now, not two: the machine's preference, and the
// same two sets again as an explicit choice. That repetition is what a
// reader is most likely to "tidy up" — the light block especially,
// which looks redundant beside the default `:root` until you notice it
// is the only thing that survives a machine set to dark. These tests
// say what each block is FOR, so deleting one fails with a reason
// rather than with a colour nobody can reproduce.

/** The token declarations that follow `opening`, as `name: value`
 *  pairs. Reads the block delimited by the sentinels, so it sees
 *  exactly what the guard above exempts. `opening` carries its own
 *  brace: the selectors are named in the prose above the rules too, and
 *  the first mention of one is a comment, not the rule. */
function tokensAfter(css: string, opening: string): Record<string, string> {
  const at = css.indexOf(opening);
  expect(at).toBeGreaterThan(-1);
  const start = css.indexOf(TOKEN_START, at);
  const end = css.indexOf(TOKEN_END, start);
  expect(end).toBeGreaterThan(start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start + TOKEN_START.length, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+)/g)) {
    out[m[1]!] = m[2]!.trim();
  }
  expect(Object.keys(out).length).toBeGreaterThan(5);
  return out;
}

describe("an explicit theme is the same ramp, not a third one", () => {
  test("the chosen Dark is exactly what the machine's dark preference gives", () => {
    expect(tokensAfter(CSS, ':root[data-theme="dark"] {')).toEqual(
      tokensAfter(CSS, "@media (prefers-color-scheme: dark) {"),
    );
  });

  test("the chosen Light is exactly the default set, colour for colour", () => {
    // The light block only looks redundant. It is an ATTRIBUTE selector
    // and the dark preference above is a bare `:root` inside a media
    // query, so this is the one rule that keeps an explicit Light on a
    // machine set to dark. The default set is the top of the file, and
    // the size/space tokens live there and nowhere else, so compare on
    // the colours the two have in common.
    const chosen = tokensAfter(CSS, ':root[data-theme="light"] {');
    const base = tokensAfter(CSS, ":root {");
    for (const [name, value] of Object.entries(chosen)) expect([name, base[name]]).toEqual([name, value]);
  });

  test("neither block sits inside a media query, which is what would sink it", () => {
    // A `@media` block between the selector and the end of the
    // stylesheet is fine; one that OPENS before it and has not closed
    // is not — the choice would then apply only when the machine
    // already agreed with it.
    for (const selector of [':root[data-theme="dark"] {', ':root[data-theme="light"] {']) {
      const before = CSS.slice(0, CSS.indexOf(selector));
      const opened = (before.match(/@media[^{]*\{/g) ?? []).length;
      const braces = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
      expect([selector, opened > 0 && braces > 0]).toEqual([selector, false]);
    }
  });
});

// --- refused is not a shade of running (spec 130) ---------------------------
//
// The file's own header says danger is carried by the darkest bar of
// the mark and NOT by a shade of the accent, so the two states never
// rest on hue alone. Dark had both `--danger` and `--accent-strong` on
// `#F5B7A3` all the same, and nothing here noticed. Named pair, not a
// blanket "no two tokens share a value" rule: dark's `--bg` and
// `--on-accent` are deliberately the same colour — dark text on the
// peach accent is what `--on-accent` is for — and a blanket rule would
// make that pair a failure.

describe("running and refused never share a colour", () => {
  // The two explicit blocks are enough: the equality tests above tie
  // the machine's preference and the bare `:root` default to these.
  for (const theme of ["dark", "light"]) {
    test(`${theme}: --danger is not --accent-strong`, () => {
      const tokens = tokensAfter(CSS, `:root[data-theme="${theme}"] {`);
      expect([theme, tokens["--danger"] === tokens["--accent-strong"]]).toEqual([theme, false]);
    });
  }
});

// --- one width, one owner (spec 130) ---------------------------------------
//
// `main` carried a `max-width` of its own that the frame rule below it
// overrode at equal specificity — a declaration that had not applied
// since the frame was centred, and read like the answer to "how wide
// is the page" while not being it.

describe("the page's width comes from the frame rule alone", () => {
  test("main declares no max-width of its own", () => {
    const rule = CSS.match(/^main\s*\{([^}]*)\}/m)?.[1] ?? "";
    // A `main` rule that vanished entirely would pass the line below
    // without protecting anything.
    expect(rule).toContain("padding");
    expect(rule).not.toContain("max-width");
    // and the frame rule, which is the one that actually decides it
    expect(CSS).toMatch(/header, body > nav\.tabbar, main \{[^}]*max-width: \d+rem/);
  });
});

// --- one class, one home (spec 130) ----------------------------------------

describe("a class is declared in one place", () => {
  test(".spec-name is declared once, not twice", () => {
    // Two rules for one class is how a class starts having two homes:
    // the next reader changes the first one and never sees the second.
    // (`.spec-name > .label` is a different selector and does not count.)
    expect((CSS.match(/\.spec-name\s*\{/g) ?? []).length).toBe(1);
  });
});

// --- the class vocabulary ---------------------------------------------------

/** The six components and their documented modifiers. Anything a page
 *  wants to look like has to be one of these. */
const COMPONENTS = [
  "btn", "primary", "ok", "danger", "busy", "spin",
  // Spec 208: what a control wears between the click and the answer,
  // for the two kinds of waiting a BUTTON's `busy` does not cover — an
  // in-page row swap, and a real navigation to another document.
  "awaiting",
  "badge", "b-idle", "b-running", "b-waiting", "b-ready", "b-refused", "b-done", "dot",
  "phases", "phase", "default", "checked", "done", "off", "box",
  "rowmsg", "err", "warn", "info",
  "field", "wide",
  "filters",
];

/** Class names `queue-client.ts` selects on or writes. They carry no
 *  styling of their own — renaming one silently breaks Run, Approve,
 *  Cancel, Merge or the refusal display in a browser, with no type
 *  error to catch it. */
const JS_HOOKS = [
  "rowrun", "actionform", "mergeform",
  "refused", "refusal", "newspec", "newspecform", "frow", "factions",
  // spec 112: the Projects panel — the Add form and one Remove per
  // allowlisted project.
  "addprojectform", "removeform",
];

/** Structure and layout: what a thing IS on the page, not what it looks
 *  like. Short on purpose — a new entry here is a decision, and it
 *  shows up in the diff as one. */
const STRUCTURE = [
  // the frame — "menu" and "menupanel" are the "…" disclosure in the
  // header and the box it opens (spec 119, which removed "layout").
  "pagehead", "stamp", "brand", "mark", "mark-l", "mark-d", "surface", "actionslot", "current", "lbl",
  // where the pips sit on a spec's name line, since the Progress
  // column went and they moved in beside the name (2026-08-22)
  "pipslot",
  "tabbar", "tab",
  // The same bar one level in: a spec's seven tabs and a job's three,
  // which were filter pills until 2026-08-23 (2026-08-23, "IKKE bruke
  // chips i stedet for tabs").
  "subtabs",
  // The one width a document page shares: banner, tabs and panel
  // (2026-08-23).
  "doc",
  "menu", "menupanel", "about", "aboutpanel", "aboutclose", "listtop",
  // text roles — "u-usd"/"u-tok" are the two halves of every
  // consumption figure (spec 118): both are rendered, and one CSS rule
  // each shows exactly the one the reader asked for.
  "small", "muted", "num", "label", "desc", "summary", "counts", "specdesc",
  // one whole spec file, preformatted (spec 150) — the spec page shows
  // four of them and a phase's job page one
  "specfile",
  // the archive's own three: the search box, widened and uncaptioned,
  // and the two cells that must not wrap — the date (2026-08-23) and
  // what the spec cost in time (spec 207)
  "archive-q", "archive-date", "archive-duration",
  "u-usd", "u-tok",
  // containers — "stack" was the vertical one (spec 124): the row's
  // action buttons, one under the next, in the list's first column. It
  // went with them in spec 157, which draws ONE button per row, beside
  // the state, in the page's ordinary "row" container. "tablewrap" is
  // the box a table too wide for the window scrolls inside, so the
  // PAGE never does (spec 155).
  "row", "fact", "intro", "tabpanel", "activity", "facts", "extra",
  "tablewrap",
  // the spec list
  // "modelcell" is where a phase line's three choices sit: the AI, the
  // model, and the phase's own box. Spec 165 gave the AI a column of
  // its own ("toolcell") and spec 192 took it back out again — a
  // column boundary is a reserved width and two lots of cell padding,
  // and the three read as three separate things with that between
  // them.
  "list", "spechead", "subrow", "phasecell", "modelcell",
  "spec-name", "spec-title",
  // the row's message panel (spec 143): a full-width row of its own, so
  // a sentence out of a status file or a runner's refusal wraps instead
  // of running off the right edge of a cell sized for a word.
  "specnotice",
  "empty", "listnote", "fold", "shut", "sortlink", "on", "asc",
  "branchlist", "branch",
  "pips", "pip", "now", "past", "todo",
  // a spec row's own state — deliberately NOT `active`/`archived`,
  // which `site.ts` uses for the unrelated question of whether a spec
  // folder has been archived on disk.
  "run-new", "run-live", "run-past",
  // and site.ts's answer to that other question
  "spec-open", "spec-archived",
  // the project overview
  "proj-row", "error-text", "error",
  // the archive's Description column (spec 170): the one cell on the
  // site holding several paragraphs of prose, bounded to two lines so
  // one spec's description cannot take the row.
  "archive-desc",
  // a spec's remaining checks, at the top of its page (spec 182): the
  // Tasks-table rows of 4-status.md, grouped by phase, each undone one
  // carrying the button that ticks it. "checkbox" is that button — and
  // the same-sized span a done or archived row shows in its place, so
  // the two kinds of row line up.
  "checks", "checkshead", "checklist", "checkphase", "check", "checktask", "checkbox",
];

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

  test("the browser code writes no class of its own either", async () => {
    const source = await Bun.file(join(ROOT, "src/queue-client.ts")).text();
    const unknown = [...new Set(classesIn(source))].filter((c) => !ALLOWED.has(c));
    expect(unknown).toEqual([]);
  });
});

// --- the gap lives in the container (spec 120) ------------------------------
//
// A component that brings its own margin decides the spacing of every
// layout it is ever put in, and the layout it is put in next cannot
// take it back. The four rules below sat beside each other on the two
// lines this page crowds most, each with a `margin-left` standing in
// for a gap their container should have declared once. The guard above
// checks class NAMES and never rule bodies, so nothing else in the
// suite would notice one creeping back.

describe("the space between two controls comes from their container", () => {
  const GAPLESS = [".mergeform", ".actionform", ".extra"];

  for (const cls of GAPLESS) {
    test(`${cls} declares no margin of its own`, () => {
      // A rule that is gone entirely passes: `.actionform`'s margin was
      // its only declaration, and `td form` already gives it the rest.
      const body = CSS.match(new RegExp(`\\${cls}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect([cls, body.includes("margin")]).toEqual([cls, false]);
    });
  }

  test("the row's own alignment rule stays scoped, and the filter bar keeps its own", () => {
    // The controls line the flex-end rule was written for is gone
    // (spec 124), and with it the selector — a guard left pointing at
    // `tr[data-controls]` would pass for ever without protecting
    // anything. `.row`'s own unscoped `center` is what the filter bar
    // still needs and must not be replaced by a row-shaped rule.
    expect(CSS).not.toContain("data-controls");
    expect(CSS).toMatch(/\.row\s*\{[^}]*align-items:\s*center[^}]*\}/);
  });

  // Spec 167. `.actionslot` has reserved a fixed width since spec 157,
  // but the badge in FRONT of it has none — "not started", "analyzing",
  // "archive held back", "done — nothing waiting on you" — so the
  // buttons started at different x positions down the column and moved
  // as a state changed. `space-between` puts the action against the
  // column's right edge whatever the badge says, and costs no reserved
  // space at all.
  //
  // Static rule, not a rendered comparison: whether two badges of
  // different lengths anchor their buttons to the same pixel needs a
  // browser. What this proves is that the rule exists, and that it is
  // scoped to the State cell's row rather than added to the shared
  // `.row {}` the phase lines and the filter bar also use.
  test("the State cell's action is pushed to the column's right edge, scoped", () => {
    expect(CSS).toMatch(
      /table\.list tr\.spechead > td > \.row \{[^}]*justify-content:\s*space-between[^}]*\}/,
    );
    // The shared rule keeps its own alignment and gains nothing.
    expect(CSS.match(/\n\.row \{([^}]*)\}/)?.[1] ?? "").not.toContain("justify-content");
  });
});

// --- the row's action cannot widen a column (spec 124, spec 157) -----------
//
// The button a row offers comes and goes with its state, and the cell
// it sits in must not be sized by whichever label is longest: a column
// that grows to fit one row's button moves every other row on the page.
// Spec 124 answered that with a declared width on a cell of the
// buttons' own — a COLUMN at the front of the table first, which
// pushed every other column sideways, then the spec column's own cell
// spanning the phase lines (2026-08-19).
//
// Spec 157 answers it by wrapping instead. One button per row, in the
// State column, sharing the page's ordinary `row` container with the
// badge — and that container wraps, so a long pairing becomes two
// lines rather than a wider column.

describe("the row's action wraps rather than widening a column", () => {
  test("no cell of the buttons' own is left to declare a width on", () => {
    expect(CSS).not.toContain("stackcell");
    expect(CSS).not.toMatch(/\.stack \{/);
  });

  test("the container the badge and button share wraps, with the gap it always had", () => {
    const rule = CSS.match(/\n\.row \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("flex-wrap: wrap");
    expect(rule).toMatch(/gap:\s*var\(--sp-\d\)/);
    expect(rule).not.toContain("margin");
  });
});

// --- the unit a reader chose (spec 118) -------------------------------------
//
// The same trick as the theme, applied to text instead of colour: every
// consumption figure is rendered twice and CSS hides one. Both rules are
// needed and neither is obvious — the second is a `:not()`, which is
// what makes dollars the default without an attribute to select on — so
// deleting either fails here with a reason.

describe("the unit a reader chose is a CSS switch, not a second page", () => {
  test("choosing tokens hides the dollar figure", () => {
    expect(CSS).toContain(':root[data-unit="tokens"] .u-usd { display: none; }');
  });

  test("with no choice made the token figure is the hidden one", () => {
    // `:not([data-unit="tokens"])`, not `[data-unit="usd"]`: dollars is
    // the ABSENCE of the attribute, exactly as Auto is for the theme, so
    // a page whose script never ran still reads the way it always did.
    expect(CSS).toContain(':root:not([data-unit="tokens"]) .u-tok { display: none; }');
  });
});

// --- the select is ours (spec 156) ------------------------------------------
//
// `appearance: none` is what stops the platform drawing its own control
// on top of ours, and it drags three things behind it: a chevron we
// have to draw, a focus ring we have to draw, and a disabled look we
// have to draw. Each of the four reads as optional polish and is not —
// drop any one and a select goes back to being the operating system's.
//
// Two of the four selects on the site are NOT inside a `.field`:
// `modelPicker()` renders into `<span class="row">` and `toolPicker()`
// into `<label class="muted small">` (`queue-list.ts`). They are
// addressed by attribute instead, and a selector list that quietly
// narrowed back to `.field select` alone would pass every other check
// here while leaving both showing the platform chevron — which is the
// motivating example, a model picker disabled for the length of a run.
// Hence the tests that read the selector LIST and not only the body.

/** Every rule in the stylesheet, as its selector list and its body.
 *  Comments are stripped first: a selector named in prose is prose, and
 *  the counts below are about rules. (A rule inside `@media` carries the
 *  query in its selector list — good enough here, where every rule
 *  asked about is top-level.) */
function rules(css: string): { selectors: string; body: string }[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.trim(),
    body: m[2]!.trim(),
  }));
}

/** The one rule the predicate picks out. Two matches is as much a
 *  failure as none: it means the look has two homes. */
function oneRule(predicate: (r: { selectors: string; body: string }) => boolean) {
  const found = rules(CSS).filter(predicate);
  expect(found.length).toBe(1);
  return found[0]!;
}

describe("a select is drawn by us, not by the platform (spec 156)", () => {
  test("the chevron is a token, not a literal beside one", () => {
    // The `COLOUR` regex above does not catch a percent-encoded `%23`,
    // so the data URI needs an assertion of its own: a URI outside the
    // sentinels is exactly the literal this file exists to refuse.
    expect(outsideTokens(CSS)).not.toContain("data:image/svg+xml");
  });

  test("both themes carry a chevron, and the two are not the same arrow", () => {
    const light = tokensAfter(CSS, ':root[data-theme="light"] {')["--chevron"];
    const dark = tokensAfter(CSS, ':root[data-theme="dark"] {')["--chevron"];
    expect([typeof light, typeof dark]).toEqual(["string", "string"]);
    // Equal would mean one theme's arrow drawn in the other's colour —
    // a light arrow on a light control, which is the bug this fixes.
    expect(light).not.toEqual(dark);
  });

  test("the select is ours: appearance is reset, and we draw the arrow", () => {
    const rule = oneRule((r) => r.body.includes("appearance: none"));
    // Safari has historically wanted the prefixed form spelled out.
    expect(rule.body).toContain("-webkit-appearance: none");
    expect(rule.body).toContain("background-image: var(--chevron)");
    // The arrow needs room of its own, or it sits over the end of a
    // long option label instead of beside it.
    expect(rule.body).toMatch(/padding-right:\s*\d+px/);
  });

  test("the model select and the AI select are ours too", () => {
    // Neither has a `.field` ancestor, so `.field select` alone reaches
    // neither of them.
    const rule = oneRule((r) => r.body.includes("appearance: none"));
    expect(rule.selectors).toContain(".field select");
    expect(rule.selectors).toContain('select[name^="model."]');
    expect(rule.selectors).toContain("select[data-ai]");
    // The control this one replaced (spec 179) is gone from the
    // stylesheet as well as from the markup.
    expect(CSS).not.toContain("data-set-all");
  });

  test("the two selects get the whole field look, not only the arrow", () => {
    // They are in no `.field`, so until this spec they carried no
    // height, border, background or colour from the design system at
    // all — the base rule has to name them as well.
    const rule = oneRule((r) => r.selectors.includes(".field input,"));
    expect(rule.selectors).toContain('select[name^="model."]');
    expect(rule.selectors).toContain("select[data-ai]");
  });

  test("there is one focus rule, it is :focus-visible, and it is the accent", () => {
    // One rule for everything focusable — not one per component, which
    // is how the page ended up with no focus style at all and every
    // control focusing in the browser's blue. `:focus` rather than
    // `:focus-visible` would leave a ring behind after a mouse press.
    const rule = oneRule((r) => r.selectors.includes(":focus"));
    expect(rule.selectors).toBe(":focus-visible");
    expect(rule.body).toContain("outline: 2px solid var(--accent)");
  });

  test("a disabled field reads as unavailable, and so do the two selects", () => {
    // `.btn:disabled` has had `opacity: 0.45` since spec 102; a field
    // had nothing, so a model picker disabled for the length of a run
    // still read as pressable and its reason lived only in a `title`.
    const rule = oneRule((r) => r.selectors.includes(".field input:disabled"));
    expect(rule.selectors).toContain(".field select:disabled");
    expect(rule.selectors).toContain(".field textarea:disabled");
    expect(rule.selectors).toContain('select[name^="model."]:disabled');
    expect(rule.selectors).toContain("select[data-ai]:disabled");
    // `background-color`, not the `background` shorthand: the shorthand
    // would drop the ground the base rule sets.
    expect(rule.body).toContain("background-color: var(--surface-2)");
    expect(rule.body).toContain("color: var(--muted)");
  });

  // The AI select is deliberately NOT in this rule (spec 179). It is
  // the one place the two controls beside each other differ, and the
  // difference is what they hold: a model name is a value, like a spec
  // id or a branch name; "Claude Code" is a thing's NAME, which the
  // project and checkout pickers already keep in the sans face. The
  // chrome — border, height, arrow, disabled look — is identical, and
  // that is what makes the pair read as a pair.
  test("a model name is a value, so it is set in mono like every other one", () => {
    const rule = oneRule(
      (r) => r.body.includes("font-family: var(--mono)") && r.selectors.includes("select["),
    );
    expect(rule.selectors).toContain('select[name^="model."]');
    expect(rule.selectors).not.toContain("select[data-ai]");
    // Mono runs wider at the same nominal size, and these sit in a
    // pinned table column.
    expect(rule.body).toContain("font-size: var(--fs-s)");
  });
});
