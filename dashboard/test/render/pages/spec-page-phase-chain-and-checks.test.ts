// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import type { Phase, SpecCheckView, SpecPageView } from "../../../src/render.ts";
import { lead, page, view } from "./spec-page-fixtures.ts";

describe("spec 239: the phase chain on Overview", () => {
  const STEPS = ["create", "analyze", "implement", "archive"];
  const phase = (step: string, extra: Partial<Phase> = {}): Phase => ({
    step,
    attempts: [],
    history: {},
    ...extra,
  });
  const pipKind = (html: string, step: string): string =>
    html.match(new RegExp(`<span class="pip ([a-z]+)"[^>]* title="${step}">`))?.[1] ?? "";

  test("a spec that has run create, analyze and implement but not archive shows all four phases (criterion 4)", () => {
    const html = page(
      view({
        phases: STEPS.map((step) => phase(step)),
        done: ["create", "analyze", "implement"],
      }),
    );
    expect(html).toContain('class="pips"');
    expect(pipKind(html, "create")).toBe("past");
    expect(pipKind(html, "analyze")).toBe("past");
    expect(pipKind(html, "implement")).toBe("past");
    expect(pipKind(html, "archive")).toBe("todo");
  });

  // Spec 241: `pips()` is caption-free by design (it is shared with the
  // front page's row, which already has the spec's name beside it) —
  // hoisted alone onto Overview it needs a label of its own, the same
  // `checkshead` convention `checklist()` already uses for "Checks".
  test("the pips carry a 'Progress' caption, the front page row's own name for this call (criterion 1)", () => {
    const html = page(view({ phases: STEPS.map((step) => phase(step)), done: ["create"] }));
    expect(html).toContain('<p class="checkshead"><strong>Progress</strong></p>');
  });

  test("a spec with no job ever run still shows the phase chain rather than being omitted (criterion 5)", () => {
    const html = page(view({ phases: STEPS.map((step) => phase(step)), done: [] }));
    expect(html).toContain('class="pips"');
    for (const step of STEPS) expect([step, pipKind(html, step)]).not.toEqual([step, ""]);
  });

  test("an archive held back with a reason reaches the tab the same way the front page's row shows it (criterion 6)", () => {
    const phases = [
      ...STEPS.slice(0, 3).map((step) => phase(step)),
      phase("archive", { heldBack: { reason: "the Slack webhook" } }),
    ];
    const html = page(view({ phases, done: ["create", "analyze", "implement"] }));
    // The pips strip cannot itself tell held-back from not-yet-run apart
    // — the front page's own row does not either (render.test.ts's
    // `pipFor` asserts "todo" for both cases, spec 108). What this pins
    // is that the held-back `Phase` reaches this tab and renders through
    // the identical composer without throwing.
    expect(pipKind(html, "archive")).toBe("todo");
  });

  test("nothing is drawn for a view carrying no phase data at all — no pips and no caption (criterion 2)", () => {
    const html = page(view());
    expect(html).not.toContain('class="pips"');
    expect(html).not.toContain('<strong>Progress</strong>');
  });
});

// --- spec 182, ticked again by spec 212: the spec's remaining checks --------
//
// A check only a person can make — look at the page at 375px and say
// whether it holds — was a row buried near the bottom of the fourth
// file. The rows came to the top of the page instead.
//
// Spec 188 made every row inert and moved the tick onto the Edit form,
// because a second way of changing a spec was one too many to learn.
// Spec 212 gives the boxes back, on the Overview PANEL rather than in
// the banner: the description's own editor is now a tab beside it
// rather than a page behind a link, so a reader still has one place to
// tick — and a form in the banner would ride onto Activity and Steps,
// which reload every ten seconds and would wipe a half-ticked list.

describe("the checks block (specs 182, 188, 212)", () => {
  const PHASE = "Phase 4: REFACTOR - Test suite";
  const check = (extra: Partial<SpecCheckView> = {}): SpecCheckView => ({
    phase: PHASE,
    line: "| Manual check at 375px in a real browser | ⬜ | still outstanding |",
    task: "Manual check at 375px in a real browser",
    done: false,
    ...extra,
  });

  const DONE = check({ task: "Run the full test suite", line: "| Run the full test suite | ✅ | |", done: true });
  const LATER = check({
    phase: "Phase 5: SHIP",
    task: "Watch the first real run",
    line: "| Watch the first real run | ⬜ | |",
  });

  const withChecks = (rows = [check(), DONE], extra: Partial<SpecPageView> = {}) =>
    view({ checks: { rows, phase: PHASE, baseSha: "b7c40e2deadbeef" }, ...extra });

  /** The checks section alone. The page has real forms on it — Update,
   *  for one — so a claim about "the form" is a claim about this
   *  section and not about the document. */
  const section = (html: string): string => {
    const found = html.match(/<section class="checks">[\s\S]*?<\/section>/);
    expect(found).not.toBeNull();
    return found![0];
  };

  test("an open row in the current phase is a real checkbox, in a form with its own Save", () => {
    const html = page(withChecks());
    const checks = section(html);
    expect(checks).toContain('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/tick"');
    expect(checks).toMatch(/<form[^>]*method="post"/);
    expect(checks).toContain('type="checkbox"');
    expect(checks).toContain('name="tick"');
    expect(checks).toContain('value="| Manual check at 375px in a real browser | ⬜ | still outstanding |"');
    expect(checks).toContain("Save");
  });

  for (const state of ["queued", "running"] as const) {
    test(`a ${state} job leaves every check visible but removes the controls`, () => {
      const checks = section(page(withChecks([check(), DONE, LATER], { lead: lead({ state }) })));
      expect(checks).toContain("Manual check at 375px in a real browser");
      expect(checks).toContain("Run the full test suite");
      expect(checks).toContain("Watch the first real run");
      expect(checks).not.toContain('name="tick"');
      expect(checks).not.toContain("<form");
      expect(checks).not.toContain("<button");
    });
  }

  test("a completed job does not make the checks read-only", () => {
    expect(section(page(withChecks([check()], { lead: lead({ state: "done" }) })))).toContain('name="tick"');
  });

  // The Save that commits the description and the Save that commits a
  // tick are two forms posting to two actions — that is what turns one
  // commit carrying both into two commits, each carrying its own file.
  test("its Save is its own, not the description's", () => {
    const checks = section(page(withChecks()));
    expect(checks).not.toContain("/save");
    expect(checks).not.toContain("<textarea");
  });

  // ONE hidden phase for the whole set, not one per row: every box the
  // page offers belongs to the same phase by construction, which is
  // what lets each box's own value be the row's verbatim line (a table
  // row contains `|` and cannot be packed into one field with its
  // phase). `baseSha` is the file's own commit at read time.
  test("the phase and 4-status.md's own commit travel with the form", () => {
    const html = page(withChecks());
    expect(html.match(/name="checksPhase"/g)!).toHaveLength(1);
    expect(html).toContain(`value="${PHASE}"`);
    expect(html).toContain('name="statusBaseSha"');
    expect(html).toContain('value="b7c40e2deadbeef"');
  });

  test("carries the token for a browser that got the page with one", () => {
    expect(section(page(withChecks([check()], { token: "s3cret" })))).toContain('name="token" value="s3cret"');
  });

  // "A check already made" — a done row is still SHOWN, because a list
  // that only ever shrinks says nothing about how far the spec got —
  // but it is not a box to press.
  test("a done row is shown, marked done, and is not a box", () => {
    const html = page(withChecks([DONE]));
    expect(html).toContain("Run the full test suite");
    expect(section(html)).not.toContain('name="tick"');
    expect(html).toContain("check done");
  });

  // "A check nothing is waiting on" — a phase the workflow has not
  // reached is sitting at its template default.
  test("an open row in a later phase is shown but is not a box", () => {
    const html = page(withChecks([check(), LATER]));
    expect(html).toContain("Watch the first real run");
    expect(html.match(/name="tick"/g)!).toHaveLength(1);
  });

  // Every box on the page is inside the ONE form that posts them: a box
  // outside it posts nothing at all when Save is pressed.
  test("no box sits outside the form that Save posts", () => {
    const html = page(withChecks());
    const checks = section(html);
    expect(checks.indexOf('name="tick"')).toBeGreaterThan(checks.indexOf("<form"));
  });

  // Spec 212: the Overview PANEL, not the banner. A form that rode the
  // banner onto Steps would be wiped by that tab's ten-second reload
  // halfway through being ticked.
  test("it is on Overview, and on no tab that reloads itself", () => {
    expect(page(withChecks())).toContain("Manual check at 375px in a real browser");
    const html = page(withChecks(), "steps");
    expect(html.includes("Manual check at 375px in a real browser")).toBe(false);
  });

  test("the unticked ones are told apart from the done ones in the markup", () => {
    const html = page(withChecks());
    expect(html).toContain("check open");
    expect(html).toContain("check done");
  });

  test("the phase a row belongs to travels with it", () => {
    expect(page(withChecks())).toContain("Phase 4");
  });

  // A spec whose 4-status.md has no Phase section at all — never
  // analysed. A LOW-complexity spec's `## Checklist` heading counts as
  // a phase section since spec 266, so it no longer falls into this
  // case.
  // Spec 241: an empty checklist used to render nothing at all — combined
  // with a phase-chain that has no caption either, a not-yet-analysed
  // spec's Overview tab showed literally nothing. "no checks yet" is the
  // third value the existing summary span already carries ("all done" /
  // "N still open"), not a new kind of message.
  test("a spec with no rows says 'no checks yet' rather than rendering no block at all (criterion 3)", () => {
    const html = page(view({ checks: { rows: [] } }));
    expect(html).not.toContain('class="checklist"');
    expect(html).toContain('<p class="checkshead"><strong>Checks</strong> <span class="small muted">no checks yet</span></p>');
  });

  test("a spec whose view carries no checks says 'no checks yet' rather than rendering no block at all (criterion 3)", () => {
    const html = page(view());
    expect(html).not.toContain('class="checklist"');
    expect(html).toContain('<p class="checkshead"><strong>Checks</strong> <span class="small muted">no checks yet</span></p>');
  });

  // Nothing left to tick — every row done, or the current phase not
  // named at all — leaves the rows on the page and the form off it.
  test("nothing tickable, no form", () => {
    const html = page(view({ checks: { rows: [DONE], phase: PHASE, baseSha: "b7c40e2" } }));
    expect(html).toContain("Run the full test suite");
    expect(section(html)).not.toContain("<form");
    expect(page(view({ checks: { rows: [check()] } }))).not.toContain('name="tick"');
  });

  // Spec 163: an archived spec is a RECORD. A tick would write, commit
  // and push into `archive/`.
  test("an archived spec is a record — the rows are shown with no control", () => {
    const html = page(withChecks([check()], { archived: true }));
    expect(html).toContain("Manual check at 375px in a real browser");
    expect(section(html)).not.toContain("<form");
    expect(section(html)).not.toContain("<button");
    expect(section(html)).not.toContain('name="tick"');
  });

  // A task cell is arbitrary text off disk, and so is the row it came
  // from — both go into the document, one as text and one as an
  // attribute value.
  test("the row and its task are escaped", () => {
    const html = page(
      withChecks([
        check({ line: '| <img src=x onerror="alert(1)"> | ⬜ | |', task: '<img src=x onerror="alert(1)">' }),
      ]),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  // A `4-status.md` git has never committed has no commit to carry,
  // which is not a mismatch — the same convention the description's own
  // field keeps.
  test("a status file with no commit yet draws the boxes all the same", () => {
    const html = page(view({ checks: { rows: [check()], phase: PHASE } }));
    expect(html).toContain('name="tick"');
    expect(html).not.toContain("undefined");
  });
});
