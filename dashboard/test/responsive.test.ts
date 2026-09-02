// Spec 155: the dashboard on a phone.
//
// The whole change is CSS plus three markup hooks, and `bun test` never
// parses or executes CSS — it can only prove that a rule's source text
// is in the stylesheet, and that the elements the rule selects on are
// in the rendered HTML. Both halves are needed: a `data-col` attribute
// with no rule hides nothing, and a rule selecting an attribute nobody
// writes hides nothing either. What no test here can say is whether the
// page actually looks right at 390px — that is the Manual testing note
// in 3-solution.md.
import { describe, expect, test } from "bun:test";
import { CSS } from "../src/render/ui/css.ts";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueTarget,
} from "../src/render.ts";
import { stepResults } from "../src/render/pages/job-page.ts";

/** The one narrow-width block, brace-matched rather than regex-guessed:
 *  it holds nested rules, so `[^}]*` would stop at the first one. Every
 *  claim below about "at phone width" is a claim about THIS text — a
 *  rule that drifted out of the block would still be in `CSS` and would
 *  still apply at every width, which is the failure worth catching. */
function narrowBlock(css: string): string {
  const opening = "@media (max-width: 40rem) {";
  const at = css.indexOf(opening);
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = at + opening.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at + opening.length, i);
  }
  throw new Error("the narrow-width media query is never closed");
}

const NARROW = narrowBlock(CSS);

const target = (specFolder: string): QueueTarget => ({ project: "aide", specFolder });

const rows = (filter?: QueuePageOptions["filter"], extra: Partial<QueuePageOptions> = {}) =>
  renderQueueRows(
    [],
    { runnerAvailable: true, targets: [target("155-x")], filter, ...extra },
    Date.parse("2026-08-21T12:00:00Z"),
  );

// --- criterion 1: the two columns a phone does not need ---------------------

describe("Started and Cost fold away at phone width", () => {
  // Scoped to the PHASE lines since the mobile-spec-row handoff
  // (2026-08-24): the spec's own header line keeps its date and cost,
  // folded onto the second line beside the badge and the button.
  test("the narrow-width block hides both columns on the phase lines", () => {
    expect(NARROW).toMatch(
      /table\.list tr\.subrow \[data-col="started"\][\s\S]*?tr\.subrow \[data-col="cost"\][\s\S]*?display:\s*none/,
    );
  });

  test("the spec header keeps its date, pushed to the line's right edge", () => {
    expect(NARROW).toContain(
      'table.list tr.spechead [data-col="started"] { display: block; margin-left: auto; }',
    );
  });

  // The action button after the badge must start at the same x on every
  // row, whatever the state's wording — so the badge reserves the width
  // of its longest label ("implementing queued") instead of sizing to
  // whichever word it happens to carry.
  test("the spec header's badge SLOT reserves one width for every state", () => {
    // The holder, never the pill: a min-width on the badge itself
    // stretched its coloured background.
    expect(NARROW).toMatch(/table\.list tr\.spechead \.badgeslot \{ min-width: [\d.]+rem/);
    expect(NARROW).not.toMatch(/tr\.spechead \.badge \{/);
  });

  // Criterion 2. Three separate renderers write these two cells — the
  // head row, each phase line, and the caption line above them — and
  // hiding one set while another stays visible leaves the table with
  // two empty columns nothing lines up under.
  test("the head row's Started and Cost cells carry the hook", () => {
    const html = rows();
    expect(html).toContain('<td data-col="started">');
    expect(html).toContain('<td class="num" data-col="cost">');
  });

  test("the sortable headings carry it too", () => {
    const html = rows();
    expect(html).toMatch(/<th [^>]*data-col="started"/);
    expect(html).toMatch(/<th [^>]*data-col="cost"/);
  });

  test("an opened row's own phase lines carry it on every line", () => {
    const html = rows(
      { open: "aide/155-x" },
      { modelChoices: [{ name: "opus", budgetUsd: 10 }] },
    );
    const subrows = [...html.matchAll(/<tr class="subrow[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    // Four phase lines plus the caption line above them.
    expect(subrows.length).toBe(5);
    for (const row of subrows) {
      expect(row).toContain('data-col="started"');
      expect(row).toContain('data-col="cost"');
    }
  });
});

// --- spec 317, REQ-8: the Created column at phone width ---------------------
//
// A deliberate choice, not an oversight: the phone's spec-header line
// already carries fold, name, pips, badge, action, duration and cost —
// a phone reader there is oriented to STATE and HOW LONG, not WHEN it
// began. Created is dropped from that line rather than reflowed onto
// it, same treatment Started/Cost already get on the subrow.
describe("Created folds away on the spec header at phone width", () => {
  test("the narrow-width block hides the column on the spec header line", () => {
    expect(NARROW).toContain('table.list tr.spechead [data-col="created"] { display: none; }');
  });

  test("the head row's Created cell carries the hook", () => {
    const html = rows();
    expect(html).toContain('data-col="created"');
  });

  test("the Created cell never breaks its date across two lines", () => {
    const html = rows();
    expect(html).toContain('<td class="created-date" data-col="created">');
    expect(CSS).toContain(".created-date { white-space: nowrap; }");
  });
});

// --- criterion 3: the open row's phase lines stack --------------------------

describe("the phase lines stop being pinned columns at phone width", () => {
  // The stack's cell gave up a fixed 14rem width here until spec 157
  // deleted the cell outright: a row draws one button now, in the
  // State column, and the phase lines lead their own rows. There is no
  // width left to release at this breakpoint.
  test("no stack cell is declared at any width", () => {
    expect(CSS).not.toContain("stackcell");
  });

  // Since the mobile-spec-row handoff (2026-08-24) a phase line is a
  // FLEX line at this width — identically whether its fold is open or
  // shut, because a table computes one column layout from all its rows,
  // and rows disagreeing about their display type scattered controls
  // into other rows' columns (the first attempt's bug). The two cells
  // dissolve: .modelcell and its .row become display:contents, so the
  // tick box and the .aimodel pair are flex items of the row itself,
  // and only .aimodel's own visibility follows the checkbox.
  test("every phase line is one flex row, open or shut", () => {
    expect(NARROW).toMatch(/table\.list tr\.subrow \{ display: flex;/);
    expect(NARROW.replace(/\s+/g, " ")).toContain(
      "table.list tr.subrow .modelcell, table.list tr.subrow .modelcell > .row " +
        "{ display: contents; }",
    );
  });

  test("the AI/model pair hides until the phase's own fold is opened", () => {
    expect(NARROW).toContain("table.list tr.subrow .aimodel { display: none; }");
    expect(NARROW).toMatch(
      /tr\.subrow:has\(\.foldphase:checked\) \.aimodel \{\s*display: flex;/,
    );
  });

  // 6.25rem of floor inside a screen that is 23rem wide. Held here, the
  // table would scroll — which is the whole of what this block exists to
  // prevent. Both caps fall together (min AND max): the model select's
  // 100px max-width outweighed the .aimodel > * rule by selector
  // specificity, so lifting only the minimum left a 90/10 split where
  // 50/50 was asked for.
  test("the width the phase lines reserve on a desktop is given back", () => {
    expect(NARROW).not.toContain("toolcell");
    expect(NARROW).toContain(
      'table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 0; max-width: none; }',
    );
  });

  test("no pinned flex children survive at any width", () => {
    expect(CSS).not.toContain(".phasecell > .row");
    expect(CSS).not.toMatch(/flex:\s*0 0 2\.5rem/);
    expect(CSS).not.toMatch(/flex:\s*0 0 6rem/);
  });

  // The desktop rule must survive verbatim: the override wins by
  // coming later in the cascade, not by replacing it, and
  // design-system.test.ts asserts on the original.
  test("the desktop rule is still declared outside the media query", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect(desktop).toContain("table.list tr.subrow .modelcell > .row { flex-wrap: nowrap; }");
  });
});

// --- criterion 4, 7, 8: a wide table scrolls, the page does not -------------

describe("every wide table scrolls inside its own box", () => {
  // Spec 255: the settings form's own `.project-settings-editor`
  // wrapper (and its narrow-only overrides) is gone with the `<details>`
  // it used to scope. Save/Cancel and the settings table now each sit
  // in a bare `.newspecform .frow`, whose `flex-basis: 100%` already
  // stacks them full-width at every screen size — a stronger guarantee
  // than a narrow-only wrap, not a narrower one.
  test("the inline project settings form's rows each take their own full-width line", () => {
    // The selector picks up a comma-joined sibling now (spec 277's
    // `.scheduledeleteform .frow`, reusing this same rule) — matched up
    // to the `{`, not immediately after `.frow`, so a second selector
    // sharing the rule does not itself break this assertion.
    expect(CSS).toMatch(/\.newspecform \.frow[^{]*\{[^}]*flex-basis:\s*100%/);
  });

  test(".tablewrap is a scroll box at every width, like .specfile", () => {
    expect(CSS).toMatch(/\.tablewrap \{[^}]*overflow-x:\s*auto/);
    // Unconditional: a table three columns wider than the window is not
    // a phone-only problem, and .specfile does not gate it either. A
    // vertical-scroll override for #jobrows now legitimately exists in
    // the narrow block (spec 320, REQ-4), so this checks only that no
    // narrow rule touching .tablewrap sets overflow-x — the horizontal
    // guarantee, not the class name's mere presence.
    expect(NARROW).not.toMatch(/\.tablewrap[^{]*\{[^}]*overflow-x/);
  });

  test("the spec list's table is wrapped", () => {
    expect(rows()).toContain('<div class="tablewrap"><table class="list speclist">');
  });

  // Spec 226. The cap that kept this list short is gone, so the list is
  // as long as the archive is; it scrolls in a box of its own, and the
  // controls above it stay where the reader left them.
  //
  // Scoped to `#jobrows`, not to `.tablewrap` at large: the job page's
  // Steps table and the settings table wear the same class and nobody
  // asked for either of them to be bounded in height.
  describe("the spec list scrolls in its own box (spec 226)", () => {
    /** The `#jobrows .tablewrap` rule's body. */
    const listWrap = (): string => {
      const m = /#jobrows \.tablewrap \{([^}]*)\}/.exec(CSS);
      expect(m).not.toBeNull();
      return m![1]!;
    };

    test("the list's box has a height to scroll inside (criterion 2)", () => {
      expect(listWrap()).toMatch(/overflow-y:\s*auto/);
      expect(listWrap()).toMatch(/flex:\s*1/);
      expect(listWrap()).toMatch(/min-height:\s*0/);
    });

    // The page still scrolls the ordinary way everywhere else — the
    // BARE main/body rules (checked below, "the bare body/main rules
    // stay ordinary") carry no cap; spec 320 adds one, but only on a
    // rule scoped to this one page (`body:has(#jobrows)`), never on
    // the unscoped rules this assertion reads.
    test("nothing else on the page is bounded to make it work", () => {
      expect(CSS).not.toMatch(/\bmain \{[^}]*overflow/);
      expect(CSS).not.toMatch(/\bbody \{[^}]*overflow/);
    });

    // The middle link in the chain (spec 320): #jobrows itself has to
    // be a flex column, or .tablewrap has nothing to grow into.
    test("#jobrows is the flex column .tablewrap grows inside", () => {
      const m = /#jobrows \{([^}]*)\}/.exec(CSS);
      expect(m).not.toBeNull();
      expect(m![1]).toMatch(/display:\s*flex/);
      expect(m![1]).toMatch(/flex-direction:\s*column/);
      expect(m![1]).toMatch(/min-height:\s*0/);
    });

    // Spec 320: the fixed 70vh guess is gone, replaced by a scoped
    // body/main chain that hands the list whatever space is actually
    // left over. Scoped with :has(#jobrows) — the id only this page
    // ever writes — so no other page's body/main is touched (REQ-5).
    test("body/main are capped to the viewport on this page only", () => {
      const body = /body:has\(#jobrows\) \{([^}]*)\}/.exec(CSS);
      expect(body).not.toBeNull();
      expect(body![1]).toMatch(/height:\s*100vh/);
      expect(body![1]).toMatch(/overflow:\s*hidden/);

      const main = /body:has\(#jobrows\) main \{([^}]*)\}/.exec(CSS);
      expect(main).not.toBeNull();
      expect(main![1]).toMatch(/flex:\s*1/);
      expect(main![1]).toMatch(/min-height:\s*0/);
      // Risk 2's mitigation: overflow stays off this scoped `main`
      // rule, or a dropdown opening near the bottom edge gets clipped.
      expect(main![1]).not.toMatch(/overflow/);
    });

    // REQ-5, checked directly rather than only by the scoped rules
    // above existing: the BARE (unscoped) body/main rules must carry
    // none of this page's cap. A regex on the word "height" alone
    // would trip on page.css's own pre-existing `min-height: 100vh`
    // on body and on the new scoped `main` rule's `min-height: 0`, so
    // this excludes anything immediately preceded by the :has() scope.
    test("the bare body/main rules stay ordinary (REQ-5)", () => {
      const bareBody = /(?<!:has\([^)]*\)\s)\bbody \{([^}]*)\}/.exec(CSS);
      expect(bareBody).not.toBeNull();
      expect(bareBody![1]).not.toMatch(/overflow:\s*hidden/);
      expect(bareBody![1]).not.toMatch(/(?<!min-)height:\s*100vh/);

      const bareMain = /(?<!:has\([^)]*\)\s)\bmain \{([^}]*)\}/.exec(CSS);
      expect(bareMain).not.toBeNull();
      expect(bareMain![1]).not.toMatch(/display:\s*flex/);
      expect(bareMain![1]).not.toMatch(/overflow:\s*hidden/);
    });

    // Risk 3: at phone width `.speclist` leaves table layout for
    // stacked flex blocks, and REQ-4 wants the box gone entirely there
    // — a fixed-height box makes no sense once the table is stacked
    // blocks. The narrow block now overrides the desktop chain back to
    // normal flow instead of leaving it untouched.
    test("the narrow-width block undoes the box (REQ-4)", () => {
      expect(NARROW).toMatch(/#jobrows \.tablewrap \{[^}]*overflow-y:\s*visible/);
      expect(NARROW).not.toMatch(/#jobrows \.tablewrap \{[^}]*flex:\s*1/);
      expect(NARROW).toMatch(/body:has\(#jobrows\) \{[^}]*display:\s*block/);
      expect(NARROW).toMatch(/body:has\(#jobrows\) \{[^}]*overflow:\s*visible/);
    });

    // Criterion 2's other half: the chips, the "?", New spec and the
    // search field are OUTSIDE the box, ahead of it in the markup. That
    // is the structural fact a string test can check; that they visibly
    // stay put while the rows move is the Manual testing note.
    test("every control sits ahead of the box, not inside it (criterion 2)", () => {
      const html = rows();
      const box = html.indexOf('<div class="tablewrap">');
      expect(box).toBeGreaterThan(-1);
      const above = html.slice(0, box);
      for (const control of ['data-filter="state"', '<details class="intro">', 'class="specsearch"'])
        expect(above).toContain(control);
      expect(html.slice(box)).not.toContain("specsearch");
    });
  });

  test("the Steps table on the job and spec pages is wrapped", () => {
    const html = stepResults([
      {
        step: "analyze",
        ok: true,
        costUsd: 1.5,
        costMeasured: true,
        terminalReason: "done",
        at: "2026-08-21T10:00:00Z",
      },
    ]);
    expect(html).toContain('<div class="tablewrap"><table>');
    expect(html.endsWith("</table></div>")).toBe(true);
  });

  // A generated page per project carried a spec table and it was
  // wrapped here. Both went on 2026-08-22: the server serves the one
  // project page there is, and the spec list is the Specs tab.
});

// --- criterion 5: two fields side by side become two lines ------------------

describe("the form rows wrap at phone width", () => {
  test("the narrow-width block lets .frow wrap", () => {
    expect(NARROW).toMatch(/\.frow \{[^}]*flex-wrap:\s*wrap/);
  });
});

// --- spec 263: the search row no longer wraps the field onto its own line ---

describe("the search row stays on one line at phone width", () => {
  // Criterion 1: the field's desktop 26rem clamps to the row's full width
  // under 40rem, and flex-wrap: wrap is what then pushes Search and New
  // spec onto a line of their own — the narrow block has to override both
  // the wrap and the width for the three controls to share one line.
  test("the row stops wrapping and the field gets a narrow resting width", () => {
    expect(NARROW).toMatch(/\.specsearch \{[^}]*flex-wrap:\s*nowrap/);
    const m = /\.searchfield \{[^}]*width:\s*([\d.]+)rem/.exec(NARROW);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(26);
  });

  // Criterion 2, first half: focusing the field lets it grow again.
  test("the field grows when its input has focus", () => {
    expect(NARROW).toMatch(/\.searchfield:focus-within \{[^}]*flex(-grow)?:\s*1/);
  });

  // Criterion 2, second half: only New spec (`.btn.primary`) may hide on
  // focus — Search is a plain `.btn` and this selector must not reach it.
  test("New spec hides while the field is focused, Search never does", () => {
    expect(NARROW).toContain(
      ".specsearch:has(.searchfield:focus-within) .btn.primary { display: none; }",
    );
    expect(NARROW).not.toMatch(/\.searchfield:focus-within[^}]*\}\s*\.btn\s*\{[^}]*display:\s*none/);
  });

  // Criterion 3: blurring the field has no CSS event of its own — what
  // proves the return to the resting state is the desktop rule surviving
  // OUTSIDE the narrow block, combined with the focus-within test above
  // (the override only applies while :focus-within matches).
  test("the desktop width rule survives outside the narrow block", () => {
    const desktop = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));
    expect(desktop).toContain("width: 26rem; max-width: 100%");
  });
});

// Spec 325: on the Specs page, `body:has(#jobrows)` (spec 320) makes
// `body` a flex column, and a flex item whose cross-axis margins are
// both `auto` is never stretched to the container's width — it shrinks
// to its own content instead. `header`, the tab bar and `main` need an
// explicit, content-independent width to stay equal there, not just on
// every other page where block layout already gave them one for free.
describe("the frame keeps one width, and the tabs sit in the middle of it", () => {
  /** The shared frame rule's own body. */
  const frameRule = (): string => {
    const m = /header, body > nav\.tabbar, main \{([^}]*)\}/.exec(CSS);
    expect(m).not.toBeNull();
    return m![1]!;
  };

  test("header, the tab bar and main share an explicit, content-independent width (REQ-1, REQ-5)", () => {
    expect(frameRule()).toMatch(/width:\s*100%/);
    expect(frameRule()).toMatch(/box-sizing:\s*border-box/);
    expect(frameRule()).toMatch(/max-width:\s*calc\(72rem \+ 2 \* var\(--sp-6\)\)/);
  });

  test("the frame stays centred (REQ-2)", () => {
    expect(frameRule()).toMatch(/margin-inline:\s*auto/);
  });

  test("the top-level tab bar centres its tabs as a rule of its own (REQ-3)", () => {
    const m = /body > nav\.tabbar \{([^}]*)\}/.exec(CSS);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/justify-content:\s*center/);
  });

  // Guard: the inner (spec/job) tab row shares the `.tabbar` class but
  // is a different selector entirely and must not pick up the same
  // centring — it takes the page's width, not the frame's.
  test("the inner subtabs row is not centred by the same rule", () => {
    const m = /nav\.tabbar\.subtabs \{([^}]*)\}/.exec(CSS);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/justify-content:\s*center/);
  });
});

// --- the States trigger's own margin from the "(?)" popover (spec 338) -----

describe("the States trigger sits further from the (?) popover than the row's own gap", () => {
  test("the desktop rule gives .menu.state its own margin (REQ-7)", () => {
    expect(CSS).toContain(".menu.state { margin-left: var(--sp-3); }");
    // The rest of the row's spacing is untouched: the flex gap itself
    // still carries every other pair of controls apart.
    expect(CSS).toContain(
      ".specsearch { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2);",
    );
  });

  test("the narrow block undoes it, so the phone layout is unchanged (REQ-8)", () => {
    expect(NARROW).toContain(".menu.state { margin-left: 0; }");
  });
});
