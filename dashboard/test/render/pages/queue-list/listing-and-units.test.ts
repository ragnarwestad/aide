import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueuePage,
  renderQueueRows,
  type JobDetailView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../src/render.ts";
import { CSS } from "../../../../src/render/ui/css.ts";
import {
  site,
  NAV,
  detail,
  row,
  openKeys,
} from "../fixtures.ts";


describe("spec 101: one line per row for what is going on and what is next (criterion 11)", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(list, { runnerAvailable: true, targets }, Date.parse("2026-08-18T12:00:00Z"));
  // The sentence used to sit in the state cell, under the badge it
  // explained. Spec 174 removed it and the div it filled: the button
  // beside the badge names the phase it would run, so the sentence
  // told a reader to press the control they were looking at. `hint`
  // stays as the reader of that div — it is how these tests say the
  // div is not there.
  const stateCell = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    // The SECOND cell: name, then state. Progress went into the name
    // cell with the pips (2026-08-22).
    return head.split("<td")[2] ?? "";
  };
  const hint = (html: string) =>
    stateCell(html).match(/<div class="muted small">([\s\S]*?)<\/div>\s*<\/td>/)?.[1] ?? "";
  /** Spec 132: the FIRST line — the badge itself. Once nothing is
   *  running it carries the whole sentence, and `hint` above is empty.
   *  The dot comes off first: it is the badge's live mark, not a word. */
  const chip = (html: string) => {
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
    const state = (head.split("<td")[2] ?? "").replace(/<span class="dot"[^>]*><\/span>/g, "");
    return state.match(/<span class="badge b-[a-z]+"[^>]*>([^<]*)<\/span>/)?.[1] ?? "";
  };

  // Spec 174, criteria 1-2: it used to say "never run — tick a phase
  // and press Run", beside a button that already reads "Analyze". The
  // page says what IS; the controls say what can be done.
  test("a spec nothing has run is not told what to press", () => {
    const cell = stateCell(rows([], [target("101-never-run")]));
    expect(cell).not.toContain("press Run");
    expect(cell).not.toContain("tick a phase");
    // The div itself, not only its text: an empty one is a line the
    // row draws and can never fill.
    expect(cell).not.toContain('<div class="muted small">');
    // The badge and the button are untouched — they are what says it.
    // Spec 176 changed the words on a never-run row from "not started"
    // to what comes next; the badge itself is still what says it.
    expect(cell).toContain(">ready<");
  });

  // In flight the sentence says nothing (asked for 2026-08-19): the
  // chip itself reads "analyzing" and the running phase line says the
  // rest — "analyze running — review to follow" was the same fact a
  // third time.
  test("a running job's chip carries the phase word; the sentence stays empty", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze", "implement"], stepIndex: 0, state: "running" })],
      [target("101-a")],
    );
    const head = html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)![0];
    expect(head).toContain(">analyzing<");
    expect(head).not.toContain("to follow");
    expect(hint(html)).toBe("");
  });

  // Spec 174: "press Run to try implement again" sat directly above a
  // button reading "Implement". The four states keep their badge; the
  // sentence goes.
  test("a job that stopped short is not told how to try again", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const cell = stateCell(
        rows([row({ specFolder: "101-a", steps: ["implement"], state })], [target("101-a")]),
      );
      expect(cell).not.toContain("press Run");
      expect(cell).not.toContain('<div class="muted small">');
      // Which of the four it was is still said, in the badge (a
      // cap-stop names its cap there too, hence toContain).
      expect(cell).toContain(state);
    }
  });

  // Spec 132 put the sentence in the badge and had it name WHICH repo
  // was ready to merge. Spec 149 took the naming back out with the
  // button it was for: the badge says what can HAPPEN next instead, and
  // for a branch left open that is the archive step which lands it.
  test("a finished spec with a branch still out says which phase is next", () => {
    const html = rows(
      [
        row({
          specFolder: "101-a",
          state: "done",
          branchUrls: [{ label: "aide", url: "https://example.test/aide" }],
        }),
      ],
      [target("101-a")],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Analyze</button>");
    expect(hint(html)).toBe("");
  });

  // Spec 111: the fixture had no `done` at all, which under spec 111's
  // rule means "nothing has happened yet" — the opposite of what the
  // test's own name claims. It passed only because the sentence never
  // read the files. Every phase is named here, so "nothing left out"
  // is what the fixture actually says.
  //
  // Spec 191 corrected what it expects: a spec on this list is one the
  // archive has not moved, whatever its history says about the step
  // having run. The badge says archive is what remains; the test's own
  // point — that no merge is asked for — is untouched by that.
  test("a finished spec with nothing left out does not ask for a merge", () => {
    const html = rows(
      [row({ specFolder: "101-a", state: "done" })],
      [target("101-a", { done: ["analyze", "implement", "archive"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(chip(html).toLowerCase()).not.toContain("merge");
    expect(hint(html)).toBe("");
  });

  // --- spec 111: the sentence names the next phase, not "nothing waiting" ---

  // "done" is the JOB's state and is correct for the job. What the
  // sentence beneath it used to say — nothing is waiting on you — was a
  // claim about the SPEC, and the spec's own files already knew better.
  // Same rule as spec 108: the files say what has happened.
  test("a spec whose plan is done is ready for implement", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["analyze"], state: "done" })],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Implement</button>");
    expect(chip(html)).not.toBe("done");
    expect(hint(html)).toBe("");
  });

  test("a spec with only archive left says so", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["implement"], state: "done" })],
      [target("101-a", { done: ["analyze", "implement"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Archive</button>");
  });

  // An open branch used to outrank the phase that was ready, because
  // merging it was a thing to do. It is not one since spec 149 — the
  // phase that lands it IS the next phase — so the badge says that.
  test("an open branch does not displace the phase that is ready", () => {
    const html = rows(
      [
        row({
          specFolder: "101-a",
          steps: ["analyze"],
          state: "done",
          branchUrls: [{ label: "aide", url: "https://example.test/aide" }],
        }),
      ],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Implement</button>");
    expect(hint(html)).toBe("");
  });

  // Named "still says nothing is waiting" until spec 191, which is the
  // string the fix removes: every phase behind it INCLUDES an archive
  // that ran, and a spec still on this list is one the move did not
  // happen for. Archive is the floor, so archive is what it says.
  test("a spec with every phase behind it is ready for archive", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["archive"], state: "done" })],
      [target("101-a", { done: ["analyze", "implement", "archive"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Archive</button>");
    expect(hint(html)).toBe("");
  });

  // The bug as reported, on spec 108, 2026-08-19: the plan run finished,
  // its branch was merged, and the row said nothing waited on a reader
  // while implement had never been started.
  test("a merged plan branch with implement still to run says implement is ready", () => {
    const html = rows(
      [
        row({
          specFolder: "101-a",
          steps: ["analyze"],
          state: "done",
          branchUrls: [{ label: "aide", url: "https://example.test/aide" }],
        }),
      ],
      [target("101-a", { done: ["analyze"] })],
    );
    expect(chip(html)).toBe("ready");
    expect(html).toContain(">Implement</button>");
    expect(chip(html)).not.toContain("nothing waiting on you");
  });

  // A run that stopped short says which of the four it was, whatever
  // the spec's files say has been done: "ready for X" must not widen
  // into a state that stopped. Until spec 174 the retry sentence below
  // the badge was what this test read; the badge is what carries it now.
  test("a job that stopped short keeps its own badge, whatever the files say", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ specFolder: "101-a", steps: ["implement"], state })],
        [target("101-a", { done: ["analyze"] })],
      );
      expect(chip(html)).toContain(state);
      expect(chip(html)).not.toContain(">ready<");
      expect(hint(html)).toBe("");
    }
  });

  // Spec 108: archive is the one phase whose "done" the job's own exit
  // status cannot answer, so the sentence reads the file instead.
  test("a spec whose archive run declined says so instead of 'done'", () => {
    const html = rows(
      [row({ specFolder: "101-a", steps: ["archive"], state: "done" })],
      [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
    );
    // Spec 143: the badge keeps the WORD — it is `nowrap`, and the
    // reason is a sentence — and the row's panel says the reason.
    expect(chip(html)).toBe("archive held back");
    expect(chip(html)).not.toContain("nothing waiting on you");
    // Once, not twice: the badge says it, so the line below has nothing
    // left to add (spec 132).
    expect(hint(html)).toBe("");
    expect(html.match(/the Slack webhook/g)).toHaveLength(1);
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "archive held back — the Slack webhook",
    );
  });

  // Spec 132, criterion 11 said the file's reason on the line below the
  // badge for the four states that stopped short. Spec 143 took it to
  // the row's panel instead — the same sentence, the same four states,
  // in the one place on the row that has the width for it. The line
  // below goes back to saying what to press.
  test("a run that stopped short says the held-back reason in the row's panel", () => {
    for (const state of ["failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ specFolder: "101-a", steps: ["archive"], state })],
        [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
      );
      expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
        "archive held back — the Slack webhook",
      );
      // Spec 174: and nothing under the badge at all any more.
      expect(hint(html)).toBe("");
      expect(stateCell(html)).not.toContain('<div class="muted small">');
      expect(html.match(/the Slack webhook/g)).toHaveLength(1);
    }
  });

  test("a run in flight outranks a stale held-back note from an earlier one", () => {
    const text = hint(
      rows(
        [row({ specFolder: "101-a", steps: ["archive"], state: "running" })],
        [target("101-a", { archiveHeldBack: { reason: "the Slack webhook" } })],
      ),
    );
    // The sentence is empty in flight; what must not happen is the
    // stale note upstaging the retry.
    expect(text).not.toContain("held back");
  });

  // Spec 101 asked for the line on EVERY row, so a blank one did not
  // read as a row missing something. Spec 174 took the line off every
  // row instead, which answers the same worry the other way: no row
  // draws it, so none is missing it.
  test("no row draws the line any more", () => {
    const html = rows(
      [row({ specFolder: "101-a", state: "running" })],
      [target("101-a"), target("101-b")],
    );
    // The spec rows only: a phase line has asides of its own in the
    // same class, and those are not what this spec removed.
    const heads = [...html.matchAll(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    expect(heads).toHaveLength(2);
    for (const head of heads) expect(head).not.toContain('<div class="muted small">');
  });
});

// --- spec 118: dollars or tokens, the reader's choice -------------------------
//
// Every consumption figure on the page is rendered TWICE — once in
// dollars, once in tokens — and CSS shows exactly one, driven by the
// `data-unit` attribute `unit-script.ts` sets from the reader's stored
// choice. That is the same mechanism the theme already uses, applied to
// text instead of colour, and it is what makes the choice work on a
// generated page opened from a folder with no server in front of it.
//
// A server-rendered test cannot "switch to token mode" — there is no
// browser here to run the script or apply the CSS. What it CAN prove is
// that both figures are in the HTML, in the right span, with the right
// text: given that, the CSS rule (asserted in css-token-guard.test.ts)
// is the whole of the switch.
describe("spec 118: the Units choice in the … menu", () => {
  const menu = (html: string) => html.match(/<details class="menu">[\s\S]*?<\/details>/)![0];

  test("every page offers $ and Tokens, wrapped with their label in one row", () => {
    for (const page of site) {
      const m = menu(page.html);
      const choices = [...m.matchAll(/data-unit-choice="([^"]+)"[^>]*>([^<]+)</g)].map(
        (x) => [x[1], x[2]],
      );
      expect(choices).toEqual([["usd", "$"], ["tokens", "Tokens"]]);
      expect(m).toContain(">Units</span>");
      // Theme moved to the header (spec 243) — the menu carries no
      // trace of it any more.
      expect(m).not.toContain("data-theme-choice");
      // Units' label and buttons are children of one shared wrapper, not
      // two separate direct children of .menupanel — the structural
      // precondition for them to render on one line rather than
      // stacking under `.menupanel > * { display: block; }` (criterion 6).
      expect(m).toMatch(/<span class="row"><span class="lbl">Units<\/span><span class="filters">/);
    }
  });

  // The wrapper above sits INSIDE .menupanel, where `.menupanel > * {
  // display: block; }` (equal specificity, later in css.ts) would
  // otherwise flatten it right back — losing the flex gap between the
  // label and the buttons even though the stacking bug is gone
  // (criterion 6, plan review should-fix).
  test("css.ts keeps .menupanel > .row flex, or the wrapper above loses its gap", () => {
    const body = CSS.match(/\.menupanel > \.row\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body).toContain("display: flex");
    expect(body).toContain("gap:");
  });

  // Spec 243, criterion 5: Theme is gone and the remaining three keep a
  // fixed order.
  test("the menu panel's children are Units, Settings, About, in that order", () => {
    for (const page of site) {
      const panel = menu(page.html).match(/<div class="menupanel">([\s\S]*?)<\/div>/)?.[1] ?? "";
      const unitsAt = panel.indexOf(">Units</span>");
      const settingsAt = panel.indexOf('href="/settings"');
      const aboutAt = panel.indexOf("data-about");
      expect([unitsAt, settingsAt, aboutAt].every((i) => i >= 0)).toBe(true);
      expect(unitsAt).toBeLessThan(settingsAt);
      expect(settingsAt).toBeLessThan(aboutAt);
    }
  });

  test("the choices are buttons, not links — they go nowhere", () => {
    const m = menu(site[0]!.html);
    expect(m).toMatch(/<button type="button" data-unit-choice="usd"/);
    expect(m).not.toMatch(/<a[^>]*data-unit-choice/);
  });

  test("$ is marked as chosen, because the server cannot know better", () => {
    for (const page of site) {
      const marked = [...menu(page.html).matchAll(/data-unit-choice="([^"]+)" aria-current=/g)].map(
        (x) => x[1],
      );
      expect(marked).toEqual(["usd"]);
    }
  });

  test("one script tag still, carrying both settings", () => {
    for (const page of site) {
      const scripts = [...page.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      // The overview is a redirect and has a second script of its own;
      // every other page has exactly one, and it holds both.
      const shared = scripts[0]!;
      expect(shared).toContain("data-theme-choice");
      expect(shared).toContain("data-unit-choice");
    }
  });
});

describe("spec 118: every consumption figure carries both units", () => {
  const rows = (extra: Partial<QueueRowView>) =>
    renderQueueRows([row({ specFolder: "81-queue-and-runner", ...extra })], {
      runnerAvailable: true,
      targets: [],
      filter: { open: "aide/81-queue-and-runner" },
    });

  // Criterion 4: with no stored choice the page reads exactly as it did
  // before this spec — a plain dollar figure, in the dollar span.
  test("the spec row's Cost cell holds the dollar figure it always did", () => {
    expect(rows({ spentUsd: 0.54 })).toContain('<span class="u-usd">$0.54</span>');
  });

  // Criterion 5: and the token figure beside it, for the reader who
  // asked for tokens.
  test("the same cell holds the token figure beside it", () => {
    const html = rows({ spentUsd: 0.54, spentTokens: 5234 });
    expect(html).toContain('<span class="u-usd">$0.54</span>');
    expect(html).toContain('<span class="u-tok">5.2k tok</span>');
  });

  // Criterion 7: a job that ran before this feature has no token count,
  // and a dash is the only honest answer — never a zero, which would
  // read as "this step used nothing".
  test("a job with no token count shows a dash in the token span", () => {
    const html = rows({ spentUsd: 0.54 });
    expect(html).toContain('<span class="u-tok">–</span>');
  });

  // The phase lines are fed by the same cell, from each attempt's own
  // result — the list and the job page must not disagree about a step.
  test("a phase line shows that step's own tokens, not the job's total", () => {
    const html = rows({
      state: "done",
      steps: ["analyze"],
      spentUsd: 2,
      spentTokens: 9000,
      results: [{ step: "analyze", ok: true, costUsd: 0.5, tokens: 1500 }],
    });
    expect(html).toContain('<span class="u-tok">1.5k tok</span>');
  });

  // The description asks for the Cost column "(header and values)" —
  // the word at the top of the column is a consumption label like the
  // figures under it, and a column of token counts headed "Cost" reads
  // as money.
  test("the column heading flips with the figures under it", () => {
    const html = rows({ spentUsd: 0.54 });
    expect(html).toContain('<span class="u-usd">Cost</span><span class="u-tok">Tokens</span>');
  });

  // The regression the money()/costCell() consolidation could lose: a
  // header with nothing spent owes the reader a dash, while an empty
  // phase line stays EMPTY. Two different blanks, one formatter.
  test("a phase line with nothing spent stays empty, and the header still dashes", () => {
    const html = rows({ state: "queued", steps: ["analyze"], spentUsd: 0 });
    // The spec row's own Cost cell: a dash, because a header with
    // nothing spent still owes the reader an answer.
    expect(html).toContain('<td class="num" data-col="cost">–</td>');
    // The analyze line's, which is EMPTY rather than dashed — two
    // different blanks, and the one formatter must keep both.
    const line = html.match(/data-step="analyze"[\s\S]*?<\/tr>/)![0];
    expect(line).toContain('<td class="num" data-col="cost"></td>');
    expect(line).not.toContain("–");
  });
});

// A Codex-only spec's `spentUsd` is genuinely `0` — never absent, never
// negative (`runner.ts:425` folds an absent `costUsd` into the literal
// number `0`) — while its `spentTokens` is a real, positive figure. The
// block above never exercises that shape: `spentUsd: 0` there always
// comes with no `spentTokens` either.
describe("spec 260: the Cost cell draws on either figure, not just the dollar one", () => {
  const rows = (extra: Partial<QueueRowView>) =>
    renderQueueRows([row({ specFolder: "81-queue-and-runner", ...extra })], {
      runnerAvailable: true,
      targets: [],
      filter: { open: "aide/81-queue-and-runner" },
    });

  // AC1: the spec row's own Cost cell.
  test("the spec row's Cost cell shows tokens, and a dash never $0.00, for a Codex-only spec", () => {
    const html = rows({ spentUsd: 0, spentTokens: 5234 });
    expect(html).toContain('<span class="u-tok">5.2k tok</span>');
    expect(html).toContain('<span class="u-usd">–</span>');
    expect(html).not.toContain("$0.00");
  });

  // AC2: the same shape on a live phase line, fed by `attemptFor()`
  // (that step's own `costUsd`/`tokens`) rather than the job's running
  // total.
  test("a live Codex phase line shows tokens rather than being empty", () => {
    const html = rows({
      state: "done",
      steps: ["analyze"],
      spentUsd: 0,
      spentTokens: 9562,
      results: [{ step: "analyze", ok: true, costUsd: 0, tokens: 9562 }],
    });
    const line = html.match(/data-step="analyze"[\s\S]*?<\/tr>/)![0];
    expect(line).toContain('<span class="u-tok">9.6k tok</span>');
  });

  // The regression the relaxed gate could lose: nothing measured at all
  // must still be a plain dash, not a token figure conjured from
  // `undefined`.
  test("nothing spent and no tokens still shows a plain dash", () => {
    const html = rows({ spentUsd: 0 });
    expect(html).toContain('<td class="num" data-col="cost">–</td>');
  });
});

describe("spec 118: the job page's figures carry both units", () => {
  const page = (extra: Partial<JobDetailView> = {}, tab: "overview" | "steps" = "overview") =>
    renderJobDetailPage(detail(extra), "2026-08-17T10:00:00Z", NAV, { tab });

  const step = (extra: Record<string, unknown> = {}) => ({
    step: "analyze",
    ok: true,
    costUsd: 0.42,
    costMeasured: true,
    terminalReason: "completed",
    at: "2026-08-16T10:01:00Z",
    ...extra,
  });

  test("the Steps table's Cost column holds both figures (criteria 4, 5)", () => {
    const html = page({ results: [step({ tokens: 12_300 })] }, "steps");
    expect(html).toContain('<span class="u-usd">$0.42</span>');
    expect(html).toContain('<span class="u-tok">12.3k tok</span>');
  });

  test("a step recorded before this feature dashes rather than guessing (criterion 7)", () => {
    const html = page({ results: [step()] }, "steps");
    expect(html).toContain('<span class="u-usd">$0.42</span>');
    expect(html).toContain('<span class="u-tok">–</span>');
  });

  // The same argument as the list's column heading: a row labelled
  // "Cost so far" above a token count reads as money. The label flips
  // with the figure, and dollar mode is byte-for-byte what it was.
  test("the Steps table's column heading flips too", () => {
    const html = page({ results: [step()] }, "steps");
    expect(html).toContain('<span class="u-usd">Cost</span><span class="u-tok">Tokens</span>');
  });

  test("the Cost so far label flips with its figure", () => {
    const html = page({ spentUsd: 1.5 });
    expect(html).toContain('<span class="u-usd">Cost so far</span><span class="u-tok">Tokens so far</span>');
  });

  test("the job's Cost so far row carries both (criteria 4, 5)", () => {
    const html = page({ spentUsd: 1.5, spentTokens: 2_000_000 });
    expect(html).toContain('<span class="u-usd">$1.50</span>');
    expect(html).toContain('<span class="u-tok">2.0M tok</span>');
  });

  // The live panel had a Cost so far row of its own; spec 150 removed
  // the panel. The job's own row above is the one that is left, and it
  // is asserted directly above this.
});

describe("the day total that used to sit under the list", () => {
  // Spec 118 put "Spent today" under the list; the user had it removed
  // on 2026-08-19 — one more figure about money on a page that should
  // talk about work. The per-row cost/token column is the display.
  test("no page shows a day total", () => {
    const html = renderQueuePage([row()], "2026-08-16T00:00:00Z", NAV, {
      runnerAvailable: true,
      targets: [],
    });
    expect(html).not.toContain("Spent today");
  });
});
// --- spec 123: the model is chosen on the phase line -------------------------

// One dropdown for the whole row used to sit on the controls line
// between Run and the other rarely-set fields, carrying option labels
// like "fable — $12 per step". It landed beside the State column by
// accident of content width, tied to nothing around it, and the phase
// lines below it showed their model as dead text with a wide empty gap
// before it.
//
// The choice belongs where the phase is: each phase line carries its
// own picker, under a "Phase"/"Model" caption, and the budget figure
// moves off the label into the option's own tooltip — the number still
// reachable, no longer read out on every option.
describe("spec 123: each phase line picks its own model", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const CHOICES = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "fable", budgetUsd: 12 },
  ];

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("123-picks")],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: CHOICES,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const controlsLine = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** The caption line: a subrow with no phase of its own, above them
   *  all. Marked by a data attribute rather than a class — it needs no
   *  rule of its own, and the render vocabulary is a closed set
   *  (`css-token-guard.test.ts`). */

  // --- criterion 1 -----------------------------------------------------------

  test("the row's own controls carry no shared Model select any more", () => {
    const html = rows([]);
    expect(controlsLine(html, "123-picks")).not.toBe("");
    expect(controlsLine(html, "123-picks")).not.toContain('name="model"');
    // Nor anywhere else on the row: the whole-job field is gone, not moved.
    expect(html).not.toContain('<select name="model"');
  });

  // --- criterion 2 -----------------------------------------------------------

  test("every phase line carries its own select, on the row's Run form", () => {
    const html = rows([]);
    const id = controlsLine(html, "123-picks").match(/<form id="([^"]+)"/)![1];
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      expect(line).not.toBe("");
      const select = line.match(new RegExp(`<select name="model\\.${step}"[^>]*>`))?.[0] ?? "";
      expect(select).not.toBe("");
      // It is written outside the form's own tags, so only the `form`
      // attribute carries it back — an id that drifts runs the job on
      // the defaults instead, silently.
      expect(select).toContain(`form="${id}"`);
    }
  });

  // No "default" entry (asked for 2026-08-19): the select holds real
  // names only, pre-filled with what the configuration would give the
  // step when the phase has not run yet.
  test("the options are the real names, pre-filled with the configured model", () => {
    const line = subRow(rows([], [target("123-picks")], { defaultModels: { default: "sonnet" } }), "analyze");
    expect(line).not.toContain('<option value=""');
    expect(line).toMatch(/<option value="sonnet"[^>]*selected/);
    expect(line).toContain('value="fable"');
  });

  test("a per-step configured model beats the catch-all default", () => {
    const line = subRow(
      rows([], [target("123-picks")], { defaultModels: { analyze: "fable", default: "sonnet" } }),
      "analyze",
    );
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  test("no option label reads out a budget figure", () => {
    const html = rows([]);
    for (const option of html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)) {
      expect(option[1]).not.toContain("$");
    }
  });

  test("the figure is still reachable — it moved to the option's tooltip", () => {
    const line = subRow(rows([]), "analyze");
    expect(line).toContain('title="$12 per step"');
  });

  // --- criterion 3 -----------------------------------------------------------

  /** The caption line above the phase lines. */
  const caption = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";

  test("a Phase/Model caption sits directly above the phase lines", () => {
    const html = rows([]);
    const cap = caption(html);
    expect(cap).toContain(">Phase<");
    // `CHOICES` is one tool's models, so there is no AI to choose
    // between and no column headed for one: the caption is the phase
    // and the model. Two tools add a word — the case below.
    expect(cap).toContain(">Model<");
    expect(cap).not.toContain(">AI<");
    // Between the spec's own line and the first phase line. (The
    // caption itself is compared with its stack cell stripped, so the
    // ordering is read off the row tag rather than the text.)
    const at = html.indexOf('<tr class="subrow" data-caption="1">');
    expect(at).toBeGreaterThan(html.indexOf('data-folder="123-picks"'));
    expect(at).toBeLessThan(html.indexOf('data-step="create"'));
  });

  // The tool is no longer a choice made once for the row (spec 169) and
  // it has a picker on every phase line (spec 179), so the caption
  // names two columns where it named one. It read "AI - Model" over the
  // model's column alone in between.
  test("with two tools configured the caption names the AI column too", () => {
    const cap = caption(
      rows([], [target("123-picks")], {
        modelChoices: [...CHOICES, { name: "gpt-fast", budgetUsd: 5, tool: "codex" as const }],
      }),
    );
    expect(cap).toContain(">Phase<");
    expect(cap).toContain(">AI<");
    expect(cap).toContain(">Model<");
    expect(cap).not.toContain("AI - Model");
  });

  // --- criterion 4 -----------------------------------------------------------

  test("with no model configured there is no picker and no caption at all", () => {
    const html = rows([], [target("123-picks")], { modelChoices: undefined });
    expect(controlsLine(html, "123-picks")).not.toBe("");
    expect(html).not.toContain("<select");
    expect(caption(html)).toBe("");
    expect(html).not.toContain(">Phase<");
  });

  // --- criterion 11 ----------------------------------------------------------

  // "last ran: X" is not spelled out any more (asked for 2026-08-19) —
  // the select's pre-filled value IS the answer.
  test("a phase that has run pre-fills its select with the model it ran on", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" })],
      [target("123-picks", { done: ["analyze"] })],
    );
    const line = subRow(html, "analyze");
    expect(line).not.toContain("last ran");
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  test("a phase run more than once keeps its attempt count", () => {
    const html = rows(
      [
        row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" }),
        row({ id: "j2", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "sonnet" }),
      ],
      [target("123-picks", { done: ["analyze"] })],
    );
    const line = subRow(html, "analyze");
    expect(line).toContain("2 attempts");
    expect(line).toContain('<select name="model.analyze"');
  });

  // Spec 176, criterion 4: the note used to sit in a `<div>` of its
  // own under the badge, so a phase line that had one was taller than
  // a phase line that had not — and everything beside it moved. It
  // rides on the badge's own line now.
  test("the attempt count rides beside the badge, not on a line of its own (spec 176)", () => {
    const html = rows(
      [
        row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" }),
        row({ id: "j2", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "sonnet" }),
      ],
      [target("123-picks", { done: ["analyze"] })],
    );
    const line = subRow(html, "analyze");
    expect(line).not.toMatch(/<div class="muted small">\s*<span class="muted small">2 attempts<\/span><\/div>/);
    expect(line).not.toContain('<div class="muted small">2 attempts</div>');
    // The note is still there, and now sits in the same flow as the
    // badge — no block-level wrapper between the two.
    expect(line).toMatch(/<\/span>\s*<span class="muted small">2 attempts<\/span>/);
  });

  // --- the gap the description asked to close --------------------------------

  test("nothing sits between the phase name and its picker", () => {
    const line = subRow(rows([]), "analyze");
    // The two shared one cell from spec 123 until spec 165 gave each a
    // real column of its own — with the row's AI between them, which
    // is the choice that comes first. What the gap was for is still
    // gone: no empty column stands between the name and the model.
    // `analyze` is not the first phase line, so the AI column's slot
    // here is the first line's `rowspan` and no cell of its own
    // stands between the two.
    expect(line).toMatch(/<td class="phasecell">[\s\S]*?<\/td><td class="modelcell">/);
    expect(line).toContain('<select name="model.analyze"');
  });

  // --- the lock spec 105 put on the shared field follows it here -------------

  test("a busy spec's phase pickers lock exactly as the shared one did", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("123-picks")],
    );
    const select = subRow(html, "analyze").match(/<select name="model\.analyze"[^>]*>/)![0];
    expect(select).toContain("disabled");
    expect(select).toContain('title="implement is running"');
  });

  test("a settled spec's phase pickers are live again", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["implement"], stepIndex: 0, state: "done" })],
      [target("123-picks")],
    );
    const select = subRow(html, "analyze").match(/<select name="model\.analyze"[^>]*>/)![0];
    expect(select).not.toContain("disabled");
  });

  // A collapsed row has no phase lines, so it has no picker either —
  // the same promise spec 103 made about the shared field.
  test("a collapsed row offers no picker", () => {
    const html = rows([], [target("123-picks")], { filter: {} });
    expect(html).not.toContain("<select");
    expect(html).not.toContain('<tr class="subrow');
  });
});

// --- spec 124: one phase list, and the actions in a stack of their own -------
//
// An expanded row used to say its phases TWICE: a horizontal strip of
// checkboxes on the controls line (a green check behind every phase
// already done) and, two rows down, the phase lines saying "done" in
// their own State column. One fact, drawn twice with two different
// marks.
//
// The checkbox moves onto the phase's own line and drops the check;
// the controls line goes with it. The action buttons left the last
// column for a stack of their own — and left that too in spec 157,
// which draws ONE control per row, in the State column, and gives the
// phase lines the left edge. What this block still guards is the half
// that did not move: one phase list, one box per line, and the six
// columns every row kind has to agree on.
describe("spec 124: one phase list, and one action beside the state", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("124-stack")],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide"],
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";

  /** Every cell of one row, in order — the content between one cell's
   *  opening tag and the next one's. */
  const cells = (tr: string): string[] =>
    tr
      .split(/<t[dh]\b[^>]*>/)
      .slice(1)
      .map((s) => s.replace(/<\/t[dh]>[\s\S]*$/, ""));
  /** How many COLUMNS a row declares: a plain cell is one, a spanning
   *  cell is what it says. The number every row kind has to agree on. */
  const columnUnits = (tr: string): number =>
    [...tr.matchAll(/<t[dh]\b([^>]*)>/g)].reduce(
      (n, m) => n + Number(m[1]!.match(/colspan="(\d+)"/)?.[1] ?? 1),
      0,
    );
  /** The whole row group: the header line and the phase lines under it. */
  const group = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the State cell, the head row's
   *  THIRD, open or shut alike (spec 157). It was a column of its own
   *  at the front of the table in spec 124, which put every button in
   *  the page's left gutter and pushed the whole table sideways; then
   *  the spec column's own spanning cell (2026-08-19); and the
   *  header's LAST cell for a shut row all along. */
  const actionCell = (chunk: string): string => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    return cells(headRow)[1] ?? "";
  };

  const CHOICES = [{ name: "sonnet", budgetUsd: 3 }];
  const branch = [{ label: "aide", url: "https://example.test/c" }];

  // --- the structural invariant, before any behaviour ------------------------

  // Four functions decide a row's cells (`sortableHead`, `specHeadRow`,
  // `phaseCaptionRow`, `phaseSubRows`) and nothing in the type system
  // makes them agree. A row short of a column does not fail loudly —
  // it shifts every column after it, on some rows and not others.
  test("every row kind declares the same five columns, and none is blank", () => {
    const html = renderQueuePage(
      [row({ id: "j1", specFolder: "124-stack", state: "done", branchUrls: branch })],
      "2026-08-19T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      {
        runnerAvailable: true,
        targets: [target("124-stack")],
        projects: ["aide"],
        modelChoices: CHOICES,
        filter: { open: "aide/124-stack" },
      },
    );
    const thead = html.match(/<thead><tr>.*?<\/tr><\/thead>/)?.[0] ?? "";
    const spechead = head(html, "124-stack");
    const firstSub = html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
    const firstPhase = subRow(html, "create");
    expect([thead, spechead, firstSub, firstPhase, subRow(html, "analyze")].every(Boolean)).toBe(true);
    // Five since the blank trailing column went on 2026-08-23. It was
    // seven under spec 165, which gave the row's AI a column of its
    // own between the phase name and the model; six when the pips
    // moved in beside the name and the Progress column went.
    for (const tr of [thead, spechead, firstSub, firstPhase]) {
      expect([tr.slice(0, 40), columnUnits(tr)]).toEqual([tr.slice(0, 40), 5]);
    }
    // And the same on every phase line after the first as well, since
    // spec 179: the AI column is a cell of each line's own, so no line
    // borrows a slot from a `rowspan` on the one above it.
    expect(columnUnits(subRow(html, "analyze"))).toBe(5);
    // No spare cell at either end since 2026-08-23: the one action a
    // shut row drew in the last column moved beside the state in spec
    // 157, and the column stood blank until it went. The header and
    // both row types end on Cost.
    expect(thead).toMatch(/data-col="cost"[\s\S]*<\/th><\/tr><\/thead>$/);
    expect(thead).not.toMatch(/<th><\/th>/);
    expect(spechead).toMatch(/data-col="cost">[\s\S]*<\/td><\/tr>$/);
    // And the phase lines lead with their own cell, hard left.
    expect(firstSub).toMatch(/^<tr class="subrow" data-caption="1"><td class="phasecell">/);
  });

  // --- criteria 1, 3, 4, 5, 15: the checkbox lives on the phase line ---------

  test("each runnable phase carries its own box, on its own line (criterion 1)", () => {
    const html = rows([]);
    const id = "rowrun-aide/124-stack";
    for (const step of ["analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      expect(line).toContain(`<input type="checkbox" name="steps" value="${step}"`);
      expect(box(line, step)).toContain(`form="${id}"`);
    }
    // The browser posts checkboxes in document order, so the order the
    // LINES are drawn in is the order `steps` arrives in.
    const order = [...html.matchAll(/<input type="checkbox" name="steps" value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["analyze", "implement", "archive"]);
  });

  // It carried no box at all until 2026-08-21 and the hole read as a
  // different kind of line. It has one now — ticked, disabled, nameless
  // — and what criterion 15 was really about survives: create is
  // history, and no press can run it again.
  test("create's box is ticked, disabled and unpostable — it is history (criterion 15)", () => {
    const line = subRow(rows([]), "create");
    expect(line).toMatch(/<input type="checkbox" value="create" checked disabled/);
    expect(line).not.toContain('name="steps" value="create"');
  });

  test("no strip of phase boxes and no controls line survive (criterion 2)", () => {
    const html = rows([], [target("124-stack")], { modelChoices: CHOICES });
    expect(html).not.toContain("data-controls");
    // The only `.phases` group left on this page is "also touches",
    // and this row has no other project to offer.
    expect(html).not.toContain('<span class="phases">');
    // Every box the row draws is on a phase line, so each is inside a
    // `<tr>` that names its own step.
    for (const m of html.matchAll(/<label class="phase[^"]*" data-phase="([^"]+)"/g)) {
      expect(subRow(html, m[1]!)).toContain(`data-phase="${m[1]}"`);
    }
  });

  test("a spec nothing has run pre-ticks every phase (criterion 3)", () => {
    const html = rows([]);
    expect(box(subRow(html, "analyze"), "analyze")).toContain('value="analyze" checked');
    expect(box(subRow(html, "implement"), "implement")).toContain('value="implement" checked');
    expect(box(subRow(html, "archive"), "archive")).toContain('value="archive" checked');
  });

  // The whole reason this spec exists: "done" was said by the State
  // column AND by a green check on the box. The box says nothing about
  // it any more — and stays tickable, because a rerun is the same
  // submission it always was.
  test("a done phase's box carries no check and no dimming (criterion 4)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "124-stack", state: "done" })],
      [target("124-stack", { done: ["analyze"] })],
    );
    for (const step of ["analyze"]) {
      const b = box(subRow(html, step), step);
      expect(b).not.toContain("already done");
      expect(b).not.toContain("phase done");
      expect(b).not.toContain("checked");
      expect(b).not.toContain("disabled");
      // Said once, by the column whose job it is.
      expect(subRow(html, step)).toContain('class="badge b-done"');
    }
    expect(box(subRow(html, "implement"), "implement")).toContain('value="implement" checked');
  });

  test("the running phase's box reads ticked; the others go inert with the reason (criterion 5)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "124-stack", steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("124-stack")],
    );
    const running = box(subRow(html, "implement"), "implement");
    expect(running).toContain('class="phase checked"');
    expect(running).toContain("disabled");
    expect(running).not.toContain('class="spin"');
    for (const step of ["analyze", "archive"]) {
      const b = box(subRow(html, step), step);
      // Not in this job's steps, so unticked — and unticked is what it
      // looks like, no padlock over it (spec 145).
      expect(b).toContain('class="phase default"');
      expect(b).toContain("disabled");
      expect(b).toContain('title="implement is running"');
    }
    // Nothing is offered as ticked while nothing can be started.
    expect(html).not.toContain('value="analyze" checked');
  });

  // --- criteria 6-12: the row's one action ----------------------------------

  test("the button sits beside the state; the header keeps its own cells (criterion 6)", () => {
    const html = rows([]);
    expect(actionCell(group(html, "124-stack"))).toContain(">Analyze</button>");
    // Four cells: name, state, started, cost. The Progress column went
    // into the name cell with the pips (2026-08-22), and the blank
    // spare after Cost went on 2026-08-23 — the row ends on the money.
    expect(cells(head(html, "124-stack"))).toHaveLength(4);
    expect(head(html, "124-stack")).toMatch(
      /<td class="num" data-col="cost">[^<]*<\/td><\/tr>$/,
    );
  });

  test("a spec no job has ever touched offers its next phases alone (criterion 8)", () => {
    const cell = actionCell(group(rows([]), "124-stack"));
    expect(cell).toContain(">Analyze</button>");
    expect(cell).not.toContain("/approve");
    expect(cell).not.toContain("/cancel");
    expect(cell).not.toContain("/merge");
  });

  // --- spec 149: the buttons that merged and approved are gone ------------
  //
  // Every step lands the work it produced, so there is nothing left for a
  // person to merge by hand and no stop between steps to approve. The
  // routes are gone (`queue-routes.test.ts`); this is the half that says
  // nothing draws a form for them either.
  test("no row draws a Merge or an Approve, in any state (spec 149)", () => {
    for (const state of ["queued", "running", "done", "failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ id: "j1", specFolder: "124-stack", state, branchUrls: branch })],
        [target("124-stack")],
      );
      expect(`${state}: ${html.includes(">Merge</button>")}`).toBe(`${state}: false`);
      expect(`${state}: ${html.includes(">Approve</button>")}`).toBe(`${state}: false`);
      expect(`${state}: ${html.includes("mergeform")}`).toBe(`${state}: false`);
      expect(`${state}: ${html.includes("/merge")}`).toBe(`${state}: false`);
      expect(`${state}: ${html.includes("/approve")}`).toBe(`${state}: false`);
      // "ready to merge" stops being a state the row reports: there is
      // no press behind it any more. The branch badge says what the
      // branch is waiting FOR instead, which is not an instruction.
      expect(`${state}: ${html.includes("ready to merge")}`).toBe(`${state}: false`);
    }
  });

  test("a job with no stored reason offers the ordinary next phase", () => {
    const clean = [row({ id: "j1", specFolder: "124-stack", state: "done", branchUrls: branch })];
    const cleanCell = actionCell(group(rows(clean, [target("124-stack")]), "124-stack"));
    // One phase, not the fresh spec's pair: this spec HAS a job.
    expect(cleanCell).toContain(">Analyze</button>");
  });

  // Spec 171. The sixth phase is gone: a merge that fails is the
  // merging step's problem, not a step of its own. A conflict archive
  // could not resolve still SHOWS — the failure text names the branch —
  // but the row offers what every other failed step offers, an ordinary
  // re-run, and nothing on the page queues a `resolve` any more.
  test("no Resolve control is drawn for any errorReason (spec 171)", () => {
    for (const state of ["done", "failed"] as const) {
      const conflicted = [
        row({
          id: "j1",
          specFolder: "124-stack",
          state,
          branchUrls: branch,
          error: "cannot bring aide/124-stack up to date with origin/main in /repos/aide (conflict — merge it by hand)",
          errorReason: "conflict",
        }),
      ];
      const html = rows(conflicted, [target("124-stack")]);
      const cell = actionCell(group(html, "124-stack"));
      expect(`${state}: ${cell.includes(">Resolve</button>")}`).toBe(`${state}: false`);
      expect(`${state}: ${cell.includes("resolveform")}`).toBe(`${state}: false`);
      expect(`${state}: ${cell.includes('value="resolve"')}`).toBe(`${state}: false`);
      // And the ordinary way back in is there instead: the same Run
      // control every other failed step's row carries.
      expect(`${state}: ${/<button[^>]*form="rowrun/.test(cell)}`).toBe(`${state}: true`);
    }
  });

  test("a shut row offers the same one control an open one does (criterion 12)", () => {
    // Until spec 157 a collapsed row offered the way out of a conflict
    // and nothing else. It offers whatever the open row offers now —
    // the same function draws both — minus the choosing.
    const conflicted = [
      row({ id: "j1", specFolder: "124-stack", state: "done", errorReason: "conflict" }),
    ];
    const shut = actionCell(group(rows(conflicted, [target("124-stack")], { filter: {} }), "124-stack"));
    // Since spec 171 a conflict draws no control of its own: the shut
    // row offers the same ordinary re-run the open one does.
    expect(shut).not.toContain(">Resolve</button>");
    expect(shut).toMatch(/<button[^>]*form="rowrun/);
    expect(shut).not.toContain("/cancel");
    // The choosing stays behind the fold: no boxes, no "also touches".
    // The run form itself is there as the button's carrier — a shut row
    // posts its phases as hidden fields, which is what the carrier is
    // for; the boxes a reader would tick are what stays behind the fold.
    expect(shut).not.toContain('type="checkbox"');
    expect(shut).not.toContain('name="extraProjects"');
    // A spec with every phase behind it still offers Archive: a row
    // that exists is a spec that is not archived (2026-08-21). What
    // criterion 12 is about is that the SHUT row and the OPEN one draw
    // the same one control, and that holds.
    const done = ["analyze", "implement", "archive"];
    const idle = actionCell(
      group(rows([], [target("124-stack", { done })], { filter: {} }), "124-stack"),
    );
    expect(idle).toContain(">Archive</button>");
    expect(idle).not.toContain('type="checkbox"');
  });

  // The run form itself is a carrier now: the button that submits it
  // and every box it posts are written OUTSIDE its tags, reaching it by
  // `form="…"` alone (the trick spec 123 introduced for the model).
  test("the Run form carries the hidden fields, and the button posts it by id", () => {
    const cell = actionCell(group(rows([], [target("124-stack")], { token: "s3cret" }), "124-stack"));
    expect(cell).toContain('<form id="rowrun-aide/124-stack" method="post" action="/api/queue"');
    expect(cell).toContain('name="project" value="aide"');
    expect(cell).toContain('name="specFolder" value="124-stack"');
    expect(cell).toContain('name="token" value="s3cret"');
    expect(cell).toMatch(/<button[^>]*form="rowrun-aide\/124-stack"[^>]*>Analyze<\/button>/);
    // Open, so the boxes on the phase lines are the only source of
    // `steps` — the form carries none of its own.
    expect(cell).not.toContain('name="steps"');
  });

  // A greyed-out Run with the reason in its title was how a busy row
  // read until spec 157. One control per row now, and while a job is
  // in flight that control is Cancel — the reason is the badge beside
  // it, which says "implementing" in the same breath.
  test("no Run at all while the spec is busy — Cancel stands in its place", () => {
    const cell = actionCell(
      group(
        rows(
          [row({ id: "j1", specFolder: "124-stack", steps: ["implement"], stepIndex: 0, state: "running" })],
          [target("124-stack")],
        ),
        "124-stack",
      ),
    );
    expect(cell).not.toMatch(/<button[^>]*form="rowrun/);
    expect(cell.match(/<button/g)).toHaveLength(1);
    expect(cell).toContain(">Cancel</button>");
  });
});

// Spec 125: a step run by Codex says two things the page has to honour.
// There is no `claude-usage` for a Codex session, so the Live panel is
// not "unknown" — it is absent, because nothing will ever fill it. And
// there is no dollar figure anywhere in Codex's output, so the Cost
// column shows the token count and a dash where the money would be.
describe("a job run by Codex", () => {
  test("shows no Live right now panel — nothing watches a Codex session", () => {
    const html = renderJobDetailPage(
      detail({ state: "running", tool: "codex" }),
      "2026-08-20T10:05:00Z",
      NAV,
      { tab: "overview" },
    );
    expect(html).not.toContain("Live right now");
  });

  // Spec 125's other half — that a running CLAUDE job still showed the
  // panel — is gone with the panel itself (spec 150). Both tools are
  // asserted panel-free in "Live right now is gone" below.

  test("a Codex step's Cost column is tokens and a dash, never $0.00", () => {
    const html = renderJobDetailPage(
      detail({
        state: "done",
        results: [
          {
            step: "implement", ok: true, tool: "codex", costUsd: 0, costMeasured: false,
            tokens: 9_562, terminalReason: "completed", at: "2026-08-20T10:01:00Z",
          },
        ],
      }),
      "2026-08-20T10:05:00Z",
      NAV,
      { tab: "steps" },
    );
    expect(html).not.toContain("$0.00");
    expect(html).toContain("9.6k tok");
  });
});

// The picker used to append the tool to a non-Claude entry's label
// (spec 125), so two entries starting different CLIs could be told
// apart. Spec 167 took it back off: the entries are called `codex-sol`
// and `codex-luna`, so the name already says it, and since spec 169 the
// option sits under a group named after its tool, which says it a
// second time while the list is open. A model name that does not say
// which tool it starts is a name to fix in queue-config.json, not a
// label to patch.
describe("the model picker shows the model's name and nothing else", () => {
  const codexTarget: QueueTarget = { project: "aide", specFolder: "125-codex" };

  test("a codex entry's option text is exactly its name, with no suffix", () => {
    const html = renderQueueRows(
      [],
      {
        runnerAvailable: true,
        targets: [codexTarget],
        modelChoices: [
          { name: "sonnet", budgetUsd: 3 },
          // Deliberately a name that does NOT contain "codex": a name
          // that did would pass this test whether or not the suffix is
          // still being appended.
          { name: "gpt-fast", budgetUsd: 5, tool: "codex" },
        ],
        filter: { open: openKeys([], [codexTarget]) },
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );
    expect(html).toMatch(/<option value="gpt-fast"[^>]*>gpt-fast<\/option>/);
    // Nothing on the option says the tool to a READER: the option's
    // group says it while the list is open, the name itself while it
    // is closed. `data-tool` is there for the phase's AI select to
    // read (spec 179) — it says which AI a model belongs to, and
    // hides nothing, which is what spec 169 removed the filter for.
    expect(html).toMatch(/<option value="gpt-fast" data-tool="codex"/);
    expect(html).not.toContain("(codex)");
    expect(html).not.toContain("(codex)");
    // The claude entries are left exactly as they were.
    expect(html).toMatch(/<option value="sonnet"[^>]*>sonnet<\/option>/);
  });
});
