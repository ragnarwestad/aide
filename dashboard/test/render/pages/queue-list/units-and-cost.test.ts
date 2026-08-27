import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueuePage,
  renderQueueRows,
  type JobDetailView,
  type QueueRowView,
} from "../../../../src/render.ts";
import { CSS } from "../../../../src/render/ui/css.ts";
import { site, NAV, detail, row } from "../fixtures.ts";

// Split out of listing-and-units.test.ts by theme.
//
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
