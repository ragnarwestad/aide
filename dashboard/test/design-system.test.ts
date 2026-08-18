// Spec 102: the brand, the components, and the four things the design
// sheet did not have an example of.
//
// The rest of the suite asserts what a page SAYS. This file asserts the
// handful of things the design foundation itself promises: that the
// mark and the favicons are on every page, that a phase's technical
// name never reaches the reader, that each of the ten job states picks
// a badge, and that the row's rarely-set controls sit behind one
// disclosure rather than three places.
import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueueRows,
  renderSite,
  type JobDetailView,
  type ProjectView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../src/render.ts";
import { ICON_LINKS, WORDMARK } from "../src/render/brand.ts";

const NAV = [{ label: "Overview", path: "projects.html" }];
const AT = "2026-08-18T12:00:00Z";
const NOW = Date.parse("2026-08-18T12:00:00Z");

const row = (extra: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "job-1",
  project: "aide",
  specFolder: "102-design-foundation",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  spentUsd: 0,
  timeoutSec: 1200,
  createdAt: "2026-08-18T10:00:00Z",
  ...extra,
});

const target = (extra: Partial<QueueTarget> = {}): QueueTarget => ({
  project: "aide",
  specFolder: "102-design-foundation",
  ...extra,
});

const rows = (list: QueueRowView[], opts: Partial<QueuePageOptions> = {}) =>
  renderQueueRows(list, { runnerAvailable: true, targets: [], ...opts }, NOW);

const detail = (extra: Partial<JobDetailView> = {}): JobDetailView => ({
  ...row(),
  steps: ["analyze", "review-plan", "implement", "archive"],
  stepIndex: 1,
  results: [],
  ...extra,
});

// --- the brand ---------------------------------------------------------------

describe("the mark is on the page (description item 3)", () => {
  const project: ProjectView = { name: "aide", manifest: { ok: true, data: { name: "aide" } }, specs: [] };
  const site = new Map(renderSite([project], AT).map((p) => [p.path, p.html]));

  test("the favicons go in <head>, before the stylesheet", () => {
    const html = site.get("projects.html")!;
    expect(html).toContain(ICON_LINKS);
    expect(html.indexOf(ICON_LINKS)).toBeLessThan(html.indexOf("<style>"));
  });

  test("the wordmark opens the nav", () => {
    for (const html of site.values()) expect(html).toContain(`<nav>${WORDMARK}<ul>`);
  });

  test("the mark ships as inline SVG and data URIs — the site is opened from a folder too", () => {
    const html = site.get("projects.html")!;
    expect(html).not.toContain('href="/favicon');
    expect(html).not.toContain("<img");
    expect(ICON_LINKS).toContain("data:image/svg+xml,");
  });

  test("the overview's tab title carries the tagline; its heading does not change", () => {
    const html = site.get("projects.html")!;
    expect(html).toContain("<title>aide — from spec to merge</title>");
    expect(html).toContain("<h1>aide dashboard</h1>");
  });

  test("a sub-page keeps its own tab title", () => {
    expect(site.get("about.html")!).toContain("<title>About</title>");
  });
});

// --- the step's name is not the reader's word --------------------------------

describe("review-plan is shown as review (description item 4)", () => {
  test("the phase chip shows the label and keeps the technical value", () => {
    const html = rows([], { targets: [target()] });
    expect(html).toMatch(/data-phase="review-plan"[^>]*>[\s\S]*?<span>review<\/span>/);
    expect(html).toContain('value="review-plan"');
    // The word only ever appears as an attribute, never as text a
    // reader sees.
    expect(html).not.toMatch(/>[^<]*review-plan[^<]*</);
  });

  test("the phase line under the row shows it too", () => {
    const html = rows([], { targets: [target()] });
    expect(html).toMatch(/data-step="review-plan"[\s\S]*?>review</);
  });

  test("the job page's step pips use the same word", () => {
    // The facts table, where the pips live: a running job opens on its
    // activity instead.
    const html = renderJobDetailPage(detail(), AT, NAV, { tab: "overview" });
    expect(html).toContain('title="review"');
    expect(html).not.toContain('title="review-plan"');
  });
});

// --- every state picks a badge -----------------------------------------------

// Five of the ten had an example on the design sheet. These four did
// not, so the mapping was decided in the plan and is asserted by name
// here rather than left to the general "the page still renders" cover.
describe("the four states with no example on the design sheet", () => {
  const badgeOf = (state: QueueRowView["state"], extra: Partial<QueueRowView> = {}) => {
    const html = rows([row({ state, stepIndex: 0, ...extra })]);
    return html.match(/<span class="badge (b-[a-z]+)"/)?.[1] ?? "";
  };

  test("stopped is a notice, not a failure — the same amber as waiting", () => {
    expect(badgeOf("stopped", { stopReason: "budget" })).toBe("b-waiting");
  });

  test("failed is danger", () => {
    expect(badgeOf("failed")).toBe("b-refused");
  });

  test("interrupted is danger, grouped with failed as it always was", () => {
    expect(badgeOf("interrupted")).toBe("b-refused");
  });

  test("cancelled is a deliberate ending, not a failure", () => {
    expect(badgeOf("cancelled")).toBe("b-idle");
  });
});

describe("refused and running are told apart by more than the word", () => {
  test("the refused badge carries a border the running one does not", async () => {
    const { CSS } = await import("../src/render/css.ts");
    const refused = CSS.match(/\.b-refused\s*\{([^}]*)\}/)?.[1] ?? "";
    const running = CSS.match(/\.b-running\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(refused).toContain("border-color: var(--danger)");
    expect(running).not.toContain("border-color:");
    expect(refused).toContain("var(--danger-soft)");
    expect(running).toContain("var(--accent-soft)");
  });

  test("a refusal on the row is a message with the warning mark, not colour alone", () => {
    const html = rows([row({ state: "failed" })], {
      targets: [target()],
      error: "cannot merge aide/102-… into main — conflict",
      errorSpec: "aide/102-design-foundation",
    });
    expect(html).toContain('class="refused rowmsg err"');
    expect(html).toMatch(/class="refused rowmsg err">\s*<svg/);
  });
});

// --- one disclosure, not three ------------------------------------------------

describe("the row's rarely-set controls sit behind one disclosure (item 4)", () => {
  const html = () =>
    rows([], {
      targets: [target()],
      projects: ["aide", "atlasaurus"],
      modelChoices: [{ name: "opus", budgetUsd: 15 }],
    });

  const more = (h: string) => h.match(/<details class="more">[\s\S]*?<\/details>/)?.[0] ?? "";

  test("model, gate and also-touches are all inside it", () => {
    const inside = more(html());
    expect(inside).toContain('name="model"');
    expect(inside).toContain('name="gate"');
    expect(inside).toContain('name="extraProjects"');
  });

  test("nothing of the three is left outside it", () => {
    const h = html();
    const outside = h.replace(more(h), "");
    expect(outside).not.toContain('name="model"');
    expect(outside).not.toContain('name="gate"');
    expect(outside).not.toContain('name="extraProjects"');
  });

  test("the summary says what is behind it", () => {
    expect(more(html())).toContain("model, gate, also touches");
  });
});

// --- the button says what pressing it does ------------------------------------

describe("the primary button's label per row state (the design sheet's table)", () => {
  const buttons = (html: string) =>
    [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]*>/g, "").trim(),
    );

  test("a spec nothing has ever run offers Run", () => {
    expect(buttons(rows([], { targets: [target()] }))).toContain("Run");
  });

  test("a spec that has run before offers Run again", () => {
    expect(buttons(rows([row({ state: "done" })], { targets: [target()] }))).toContain("Run again");
  });

  test("a job waiting for approval offers Approve and Cancel", () => {
    const b = buttons(rows([row({ state: "awaiting-approval" })], { targets: [target()] }));
    expect(b).toContain("Approve");
    expect(b).toContain("Cancel");
  });

  test("a running job offers Cancel, and its Run control reads as busy", () => {
    const html = rows([row({ state: "running" })], { targets: [target()] });
    expect(buttons(html)).toContain("Cancel");
    expect(html).toMatch(/<button[^>]*class="btn busy"/);
  });

  test("the merge button still says what it merges", () => {
    const html = rows(
      [
        row({
          state: "done",
          branchUrls: [{ label: "aide-specs", url: "https://example.test/c", merged: false }],
        }),
      ],
      { targets: [target()] },
    );
    expect(buttons(html)).toContain("Merge the plan");
  });

  test("after a refusal the merge button says Merge again", () => {
    const html = rows(
      [
        row({
          state: "done",
          branchUrls: [{ label: "aide-specs", url: "https://example.test/c", merged: false }],
        }),
      ],
      {
        targets: [target()],
        error: "conflict — merge it by hand",
        errorSpec: "aide/102-design-foundation",
      },
    );
    expect(buttons(html)).toContain("Merge again");
  });
});

// --- dark mode is implemented, not merely declared ----------------------------

describe("every token has a dark-surface value (acceptance criterion 13)", () => {
  // Contrast can only be judged in a browser. What a test CAN close is
  // that no token is left behind: a page half in dark mode is the one
  // failure mode a missing override produces.
  const PAIRED = [
    "--bg", "--surface", "--surface-2", "--text", "--muted", "--line", "--line-strong",
    "--accent", "--accent-strong", "--accent-soft", "--ok", "--ok-soft",
    "--warn", "--warn-soft", "--danger", "--danger-soft",
  ];

  test("the dark block overrides every colour token", async () => {
    const { CSS } = await import("../src/render/css.ts");
    const dark = CSS.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(dark).not.toBe("");
    for (const token of PAIRED) expect(dark).toContain(`${token}:`);
  });

  test("the mark swaps to its dark-surface copy", async () => {
    const { CSS } = await import("../src/render/css.ts");
    expect(CSS).toContain(".mark-d");
    expect(CSS).toContain(".mark-l");
  });
});

// --- one name, one question ------------------------------------------------

// `active` and `archived` used to be two class names meaning two
// unrelated things: on the spec list, whether a job is in flight; on a
// project page, whether the spec folder has been archived on disk.
// Nothing pinned either, so nothing would have noticed them drifting
// into each other.
describe("the two row-state vocabularies are distinct (acceptance criterion 9)", () => {
  test("the spec list says whether a job is in flight", () => {
    expect(rows([], { targets: [target()] })).toContain('class="spechead run-new"');
    expect(rows([row({ state: "running" })], { targets: [target()] })).toContain(
      'class="spechead run-live"',
    );
    expect(rows([row({ state: "done" })], { targets: [target()] })).toContain(
      'class="spechead run-past"',
    );
  });

  test("a project page says whether the spec folder is archived on disk", () => {
    const project: ProjectView = {
      name: "aide",
      manifest: { ok: true, data: { name: "aide" } },
      specs: [
        { folder: "101-x", dir: "/x/101-x", archived: false, title: "Open", description: null, status: null },
        { folder: "99-y", dir: "/x/archive/99-y", archived: true, title: "Done", description: null, status: null },
      ],
    };
    const html = renderSite([project], AT).find((p) => p.path === "aide.html")!.html;
    expect(html).toContain('<tr class="spec-open">');
    expect(html).toContain('<tr class="spec-archived">');
    // Neither vocabulary borrows the other's words.
    expect(html).not.toContain('<tr class="archived">');
    expect(html).not.toContain('<tr class="active">');
  });
});
