// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import type { SpecCheckView, SpecPageView } from "../../../../src/render";
import { file, lead, page, view } from "../spec-page-fixtures.ts";

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
    const html = page(withChecks(), "status");
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
      const checks = section(page(withChecks([check(), DONE, LATER], { lead: lead_ }), "status"));
      expect(checks).toContain("Manual check at 375px in a real browser");
      expect(checks).toContain("Run the full test suite");
      expect(checks).not.toContain('name="tick"');
      expect(checks).not.toContain("<form");
      expect(checks).not.toContain("<button");
    });
  }

  test("a queued job — parked, or merely waiting for a slot — leaves the controls in place", () => {
    expect(section(page(withChecks([check()], { lead: lead({ state: "queued" }) }), "status"))).toContain(
      'name="tick"',
    );
  });

  test("a completed job does not make the checks read-only", () => {
    expect(section(page(withChecks([check()], { lead: lead({ state: "done" }) }), "status"))).toContain(
      'name="tick"',
    );
  });

  // The Save that commits the description and the Save that commits a
  // tick are two forms posting to two actions — that is what turns one
  // commit carrying both into two commits, each carrying its own file.
  test("its Save is its own, not the description's", () => {
    const checks = section(page(withChecks(), "status"));
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
    const html = page(withChecks(), "status");
    expect(html.match(/name="checksPhase"/g)!).toHaveLength(1);
    expect(html).toContain(`value="${PHASE}"`);
    expect(html).toContain('name="statusBaseSha"');
    expect(html).toContain('value="b7c40e2deadbeef"');
  });

  // A check already made is a ticked box, not static text: it was made
  // by a person and a person can have got it wrong, and the only way
  // back used to be editing the markdown table in `4-status.md`.
  test("a done row is a ticked box, and still reads as done", () => {
    const html = page(withChecks([DONE]), "status");
    expect(html).toContain("Run the full test suite");
    expect(section(html)).toContain('name="tick"');
    expect(section(html)).toContain(" checked aria-label=");
    expect(html).toContain("check done");
  });

  // A Phase row is the implement RUN's own record and gates nothing, so
  // this page does not carry it at all — the Status tab is where the
  // whole file is read.
  test("a Phase row is not on this page at all", () => {
    const html = page(withChecks([check(), LATER]), "status");
    expect(html).not.toContain("Watch the first real run");
    expect(html.match(/name="tick"/g)!).toHaveLength(1);
  });

  // One section means one form, so every box simply sits inside it —
  // no `form="..."` id plumbing to get wrong, and no box stranded
  // outside the form Save posts.
  test("every box sits inside the form that Save posts", () => {
    const checks = section(page(withChecks(), "status"));
    expect(checks).not.toContain("form=");
    const form = checks.match(/<form[\s\S]*<\/form>/)![0];
    expect(form).toContain('name="tick"');
    expect(form).toContain("Save");
  });

  // Spec 212: the Checks PANEL (Overview until spec 294 renamed it), not
  // the banner. A form that rode the banner onto Steps would be wiped by
  // that tab's ten-second reload halfway through being ticked.
  test("it is on Status, and on no tab that reloads itself", () => {
    expect(page(withChecks(), "status")).toContain("Manual check at 375px in a real browser");
    const html = page(withChecks(), "steps");
    expect(html.includes("Manual check at 375px in a real browser")).toBe(false);
  });

  test("the unticked ones are told apart from the done ones in the markup", () => {
    const html = page(withChecks(), "status");
    expect(html).toContain("check open");
    expect(html).toContain("check done");
  });

  // A spec whose 4-status.md has no Phase section at all — never
  // analysed. A LOW-complexity spec's `## Checklist` heading counts as
  // a phase section since spec 266, so it no longer falls into this
  // case.
  // A file with no readable rows is shown whole: no block, no line
  // saying there is nothing to tick, the file's own text instead (AC-3).
  test("a spec with no rows draws no checks block and shows the file whole (AC-3)", () => {
    const html = page(view({ checks: { rows: [] } }), "status");
    expect(html).not.toContain('<section class="checks">');
    expect(html).not.toContain("No acceptance criteria to tick");
    expect(html).toContain("Phase 1: RED");
  });

  test("a spec whose view carries no checks draws the same (AC-3)", () => {
    const html = page(view(), "status");
    expect(html).not.toContain('<section class="checks">');
    expect(html).not.toContain("No acceptance criteria to tick");
  });

  // Every row done is not "nothing to do": the form stays, so a check
  // can come back off. What still leaves the page with nothing to press
  // is a section whose rows are none of the person's.
  test("every row done keeps the form — that is what takes a check back off", () => {
    const html = page(view({ checks: { rows: [DONE], phase: PHASE, baseSha: "b7c40e2" } }), "status");
    expect(html).toContain("Run the full test suite");
    expect(section(html)).toContain("<form");
    // A spec whose only rows are Phase rows: nothing here is the
    // person's, so there is nothing to press.
    expect(page(view({ checks: { rows: [LATER] } }), "status")).not.toContain('name="tick"');
  });

  // A task cell is arbitrary text off disk, and so is the row it came
  // from — both go into the document, one as text and one as an
  // attribute value.
  test("the row and its task are escaped", () => {
    const html = page(
      withChecks([
        check({ line: '| <img src=x onerror="alert(1)"> | ⬜ | |', task: '<img src=x onerror="alert(1)">' }),
      ]),
      "status",
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  // A `4-status.md` git has never committed has no commit to carry,
  // which is not a mismatch — the same convention the description's own
  // field keeps.
  test("a status file with no commit yet draws the boxes all the same", () => {
    const html = page(view({ checks: { rows: [check()], phase: PHASE } }), "status");
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
    const html = page(view({ checks: { rows, phase: PHASE, baseSha: "b7c40e2deadbeef" } }), "status");
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
    page(view({ checks: { rows: [], phase: "Acceptance criteria", baseSha: "b7c40e2", unreadable } }), "status");

  test("it says the table cannot be read, and what to do about it", () => {
    const html = render(true);
    expect(html).toContain("cannot read");
    expect(html).toContain("Run analyze again");
    expect(html).not.toContain("No acceptance criteria to tick");
  });

  test("a spec that genuinely has none draws no warning (AC-8)", () => {
    const html = render(false);
    expect(html).not.toContain("cannot read");
  });

  test("a spec whose acceptance ticking is switched off gets no warning either (AC-8)", () => {
    const html = page(
      view({
        acceptanceNotRequired: true,
        checks: { rows: [], phase: "Acceptance criteria", baseSha: "b7c40e2", unreadable: true },
      }),
      "status",
    );
    expect(html).not.toContain("cannot read");
    expect(html).toContain("Phase 1: RED");
  });
});

// --- spec 499: the criteria live on the Status tab, above the rendered file --

describe("the Status tab draws the criteria, then the rest of the file (AC-1, AC-3, AC-5)", () => {
  const PHASE = "Acceptance criteria";
  const ROWS = [
    "| AC-1: The total keeps counting | ⬜ | delivered for one case |",
    "| AC-2: The total is saved | ✅ | |",
  ];
  const STATUS = [
    "# X - Status",
    "",
    "## Tracking info",
    "",
    "- **Task:** `x/`",
    "",
    "## Phase 1: RED",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    "| write the test | ✅ | |",
    "",
    "## Acceptance criteria",
    "",
    "| Task | Status | Notes |",
    "|------|--------|-------|",
    ...ROWS,
    "",
    "## Notation",
    "",
    "- Not started",
    "",
  ].join("\n");
  const rows = (): SpecCheckView[] =>
    ROWS.map((line) => ({
      phase: PHASE, line, task: line.split("|")[1]!.trim(), done: line.includes("✅"),
      note: line.split("|")[3]!.trim(),
    }));
  const withStatus = (extra: Partial<SpecPageView> = {}) =>
    view({
      files: [file("4-status.md", STATUS)],
      checks: { rows: rows(), phase: PHASE, baseSha: "b7c40e2" },
      ...extra,
    });
  const raw = (html: string): string => html.match(/<pre class="specfile spec-editor-raw">([\s\S]*?)<\/pre>/)?.[1] ?? "";

  test("one form with a box per criterion, its note, and Save and Cancel in the block's head (AC-1)", () => {
    const html = page(withStatus(), "status");
    expect(html.match(/<form class="specform"/g)?.length).toBe(1);
    expect(html.match(/name="tick"/g)?.length).toBe(2);
    expect(html).toMatch(/name="tick" value="[^"]*AC-2[^"]*" checked/);
    expect(html).not.toMatch(/name="tick" value="[^"]*AC-1[^"]*" checked/);
    expect(html).toContain('<span class="checknote">delivered for one case</span>');
    const head = html.match(/<div class="panelhead"><p data-checkshead>[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(head).toContain("Save");
    expect(head).toContain("Cancel");
  });

  test("each criterion appears once: the rendered file has no Acceptance section, and the block sits above it (AC-1)", () => {
    const html = page(withStatus(), "status");
    expect(raw(html)).not.toContain("## Acceptance criteria");
    expect(raw(html)).not.toContain("AC-1");
    expect(html.indexOf('<section class="checks">')).toBeGreaterThan(html.indexOf("<h2>4-status.md"));
    expect(html.indexOf('<section class="checks">')).toBeLessThan(html.indexOf('id="spec-editor-host"'));
  });

  test("every other line of the file is shown, in order, unchanged (AC-3)", () => {
    const html = page(withStatus(), "status");
    expect(raw(html)).toBe(
      STATUS.split("\n").filter((_l, i, a) => {
        const from = a.indexOf("## Acceptance criteria");
        const to = a.indexOf("## Notation");
        return i < from || i >= to;
      }).join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    );
  });

  test("an archived spec shows mark, note and no form or box (AC-5)", () => {
    const html = page(withStatus({ archived: true }), "status");
    expect(html).toContain("✅");
    expect(html).toContain("☐");
    expect(html).toContain("delivered for one case");
    expect(html).not.toContain('name="tick"');
    expect(html).not.toContain('<form class="specform"');
    expect(raw(html)).not.toContain("AC-1");
  });

  test("an old ?tab=checks draws the Status tab with the form (AC-4)", () => {
    const html = page(withStatus(), "checks");
    expect(html).toContain('name="tick"');
    expect(html).toMatch(/aria-current="page"[^>]*>Status/);
    expect(html).not.toContain("?tab=checks");
  });
});
