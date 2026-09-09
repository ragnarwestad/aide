// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import type { SpecCheckView, SpecPageView } from "../../../src/render.ts";
import { lead, page, view } from "./spec-page-fixtures.ts";

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
//
// Spec 294: Overview is gone — this is now the Checks tab, so every
// call below names it explicitly rather than riding the page's default.

describe("the checks block (specs 182, 188, 212)", () => {
  const PHASE = "Acceptance criteria";
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
    const html = page(withChecks(), "checks");
    const checks = section(html);
    expect(checks).toContain('action="/api/queue/specs/aide/150-one-page-shows-the-whole-spec/tick"');
    expect(checks).toMatch(/<form[^>]*method="post"/);
    expect(checks).toContain('type="checkbox"');
    expect(checks).toContain('name="tick"');
    expect(checks).toContain('value="| Manual check at 375px in a real browser | ⬜ | still outstanding |"');
    expect(checks).toContain("Save");
  });

  // Running, or a landing in flight — not queued: a queued job writes
  // nothing yet, and an archive job parked on the acceptance hold-back
  // is queued precisely for this tick (371, 2026-09-03).
  for (const lead_ of [lead({ state: "running" }), lead({ state: "done", landing: true })]) {
    test(`a ${lead_.landing ? "landing" : lead_.state} job leaves every check visible but removes the controls`, () => {
      const checks = section(page(withChecks([check(), DONE, LATER], { lead: lead_ }), "checks"));
      expect(checks).toContain("Manual check at 375px in a real browser");
      expect(checks).toContain("Run the full test suite");
      expect(checks).not.toContain('name="tick"');
      expect(checks).not.toContain("<form");
      expect(checks).not.toContain("<button");
    });
  }

  test("a queued job — parked, or merely waiting for a slot — leaves the controls in place", () => {
    expect(section(page(withChecks([check()], { lead: lead({ state: "queued" }) }), "checks"))).toContain(
      'name="tick"',
    );
  });

  test("a completed job does not make the checks read-only", () => {
    expect(section(page(withChecks([check()], { lead: lead({ state: "done" }) }), "checks"))).toContain(
      'name="tick"',
    );
  });

  // The Save that commits the description and the Save that commits a
  // tick are two forms posting to two actions — that is what turns one
  // commit carrying both into two commits, each carrying its own file.
  test("its Save is its own, not the description's", () => {
    const checks = section(page(withChecks(), "checks"));
    expect(checks).not.toContain("/save");
    expect(checks).not.toContain("<textarea");
  });

  // ONE hidden phase for the whole set, not one per row: every box the
  // page offers is an Acceptance row and belongs to that one section by
  // construction, which is what lets each box's own value be the row's
  // verbatim line (a table row contains `|` and cannot be packed into
  // one field with its phase). `baseSha` is the file's own commit at
  // read time.
  test("the phase and 4-status.md's own commit travel with the form", () => {
    const html = page(withChecks(), "checks");
    expect(html.match(/name="checksPhase"/g)!).toHaveLength(1);
    expect(html).toContain(`value="${PHASE}"`);
    expect(html).toContain('name="statusBaseSha"');
    expect(html).toContain('value="b7c40e2deadbeef"');
  });

  test("carries the token for a browser that got the page with one", () => {
    expect(section(page(withChecks([check()], { token: "s3cret" }), "checks"))).toContain(
      'name="token" value="s3cret"',
    );
  });

  // A check already made is a ticked box, not static text: it was made
  // by a person and a person can have got it wrong, and the only way
  // back used to be editing the markdown table in `4-status.md`.
  test("a done row is a ticked box, and still reads as done", () => {
    const html = page(withChecks([DONE]), "checks");
    expect(html).toContain("Run the full test suite");
    expect(section(html)).toContain('name="tick"');
    expect(section(html)).toContain(" checked>");
    expect(html).toContain("check done");
  });

  // A Phase row is the implement RUN's own record and gates nothing, so
  // this page does not carry it at all — the Status tab is where the
  // whole file is read.
  test("a Phase row is not on this page at all", () => {
    const html = page(withChecks([check(), LATER]), "checks");
    expect(html).not.toContain("Watch the first real run");
    expect(html.match(/name="tick"/g)!).toHaveLength(1);
  });

  // One section means one form, so every box simply sits inside it —
  // no `form="..."` id plumbing to get wrong, and no box stranded
  // outside the form Save posts.
  test("every box sits inside the form that Save posts", () => {
    const checks = section(page(withChecks(), "checks"));
    expect(checks).not.toContain("form=");
    const form = checks.match(/<form[\s\S]*<\/form>/)![0];
    expect(form).toContain('name="tick"');
    expect(form).toContain("Save");
  });

  // Spec 212: the Checks PANEL (Overview until spec 294 renamed it), not
  // the banner. A form that rode the banner onto Steps would be wiped by
  // that tab's ten-second reload halfway through being ticked.
  test("it is on Checks, and on no tab that reloads itself", () => {
    expect(page(withChecks(), "checks")).toContain("Manual check at 375px in a real browser");
    const html = page(withChecks(), "steps");
    expect(html.includes("Manual check at 375px in a real browser")).toBe(false);
  });

  test("the unticked ones are told apart from the done ones in the markup", () => {
    const html = page(withChecks(), "checks");
    expect(html).toContain("check open");
    expect(html).toContain("check done");
  });

  test("the section a row belongs to leads its rows", () => {
    expect(page(withChecks(), "checks")).toContain("Acceptance criteria");
  });

  // Spec 295: the panel opens directly with the checklist markup this
  // suite already pins, with no `<h2>Checks</h2>` above it — the tab bar
  // beside it already names the tab.
  test("the panel opens with the unchanged checklist and no heading of its own", () => {
    const html = page(withChecks(), "checks");
    expect(html).not.toContain("<h2>Checks</h2>");
    expect(html).toContain('<section class="checks">');
  });

  // A spec whose 4-status.md has no Phase section at all — never
  // analysed. A LOW-complexity spec's `## Checklist` heading counts as
  // a phase section since spec 266, so it no longer falls into this
  // case.
  // Spec 294: the run-together "Checks no checks yet" wording becomes
  // its own line, "No checks yet.", styled as a plain status line
  // rather than the small/muted caption treatment `checkshead` gives
  // every other message here. Spec 295: no `<h2>Checks</h2>` sits above
  // it — the tab bar beside the panel already names the tab.
  // Spec 360: the sentence carries the tab's "(?)" mark at its own end,
  // inside the same <p>, rather than the mark sitting ahead of it.
  test("a spec with no rows says 'No acceptance criteria to tick.' as its own line, with no heading above it (criterion 2)", () => {
    const html = page(view({ checks: { rows: [] } }), "checks");
    expect(html).toContain('<p class="muted">No acceptance criteria to tick. <details class="intro">');
    expect(html).not.toContain("<h2>Checks</h2>");
    expect(html).not.toContain('class="checkshead"');
    expect(html).not.toContain("no acceptance criteria");
  });

  test("a spec whose view carries no checks says 'No acceptance criteria to tick.' the same way (criterion 2)", () => {
    const html = page(view(), "checks");
    expect(html).toContain('<p class="muted">No acceptance criteria to tick. <details class="intro">');
    expect(html).not.toContain("<h2>Checks</h2>");
    expect(html).not.toContain('class="checkshead"');
    expect(html).not.toContain("no acceptance criteria");
  });

  // Every row done is not "nothing to do": the form stays, so a check
  // can come back off. What still leaves the page with nothing to press
  // is a section whose rows are none of the person's.
  test("every row done keeps the form — that is what takes a check back off", () => {
    const html = page(view({ checks: { rows: [DONE], phase: PHASE, baseSha: "b7c40e2" } }), "checks");
    expect(html).toContain("Run the full test suite");
    expect(section(html)).toContain("<form");
    // A spec whose only rows are Phase rows: nothing here is the
    // person's, so there is nothing to press.
    expect(page(view({ checks: { rows: [LATER] } }), "checks")).not.toContain('name="tick"');
  });

  // Spec 163: an archived spec is a RECORD. A tick would write, commit
  // and push into `archive/`.
  test("an archived spec is a record — the rows are shown with no control", () => {
    const html = page(withChecks([check()], { archived: true }), "checks");
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
      "checks",
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  // A `4-status.md` git has never committed has no commit to carry,
  // which is not a mismatch — the same convention the description's own
  // field keeps.
  test("a status file with no commit yet draws the boxes all the same", () => {
    const html = page(view({ checks: { rows: [check()], phase: PHASE } }), "checks");
    expect(html).toContain('name="tick"');
    expect(html).not.toContain("undefined");
  });
});

// A criterion says what was asked for; only the run knows what it
// actually delivered against it. Spec 340 ticked REQ-3 with "Delivered
// for the no-retry case only" beside it, and the page showed a plain
// green tick — the caveat sat in the file and reached nobody.
describe("the run's own note on an acceptance row", () => {
  const PHASE = "Acceptance criteria";
  const noted = (note: string, done = false): SpecCheckView => ({
    phase: PHASE,
    line: `| REQ-3: the figure follows the same rule | ${done ? "✅" : "⬜"} | ${note} |`,
    task: "REQ-3: the figure follows the same rule",
    done,
    note,
  });
  // The checks SECTION, never the whole page: the shell carries this
  // block's own CSS inline, so `.checknote` appears in the stylesheet
  // whether or not a single row draws one.
  const render = (rows: SpecCheckView[]): string => {
    const html = page(view({ checks: { rows, phase: PHASE, baseSha: "b7c40e2deadbeef" } }), "checks");
    return html.match(/<section class="checks">[\s\S]*?<\/section>/)?.[0] ?? "";
  };

  test("it is on the page, beside the criterion it belongs to", () => {
    const html = render([noted("Delivered for the no-retry case only")]);
    expect(html).toContain('<span class="checknote">Delivered for the no-retry case only</span>');
  });

  test("a row with no note draws none — an empty line under every criterion says nothing", () => {
    const html = render([noted("")]);
    expect(html).not.toContain("checknote");
  });

  // The caveat is the record of what was accepted, so it survives the
  // acceptance: a done row keeps it, outside the struck-through text.
  test("a criterion already ticked keeps its note, outside the struck-through text", () => {
    const html = render([noted("Delivered for the no-retry case only", true)]);
    const item = html.match(/<li class="check done">[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(item).toContain('<span class="checknote">');
    expect(item).not.toMatch(/<span class="checktask">[^<]*Delivered/);
  });

  test("a note is escaped, never rendered as markup", () => {
    const html = render([noted("see <b>3-solution.md</b>")]);
    expect(html).toContain("see &lt;b&gt;3-solution.md&lt;/b&gt;");
  });
});

// An Acceptance section the parser reads nothing out of is not the same
// answer as no section at all, and the page must not give the same one:
// the archive gate reads the same file, so an unreadable table means
// nothing holds the spec back either.
describe("an Acceptance table written in a shape this page cannot read", () => {
  const render = (unreadable: boolean): string =>
    page(view({ checks: { rows: [], phase: "Acceptance criteria", baseSha: "b7c40e2", unreadable } }), "checks");

  test("it says the table cannot be read, and what to do about it", () => {
    const html = render(true);
    expect(html).toContain("cannot read");
    expect(html).toContain("Run analyze again");
    expect(html).not.toContain("No acceptance criteria to tick");
  });

  test("a spec that genuinely has none still says so plainly", () => {
    const html = render(false);
    expect(html).toContain("No acceptance criteria to tick");
    expect(html).not.toContain("cannot read");
  });
});
