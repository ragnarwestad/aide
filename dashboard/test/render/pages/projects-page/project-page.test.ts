// Spec 296: `renderProjectPage` had no direct test before this — only
// `test/render/pages/projects-page-shell.test.ts`'s exercise of the
// generated static site around it (nav, tabs), never its own heading or
// Back link.

import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render";
import type { ProjectReadiness } from "../../../../src/project/project-admin";
import type { ProjectView } from "../../../../src/render";

const NAV = [{ label: "Projects", path: "/projects" }];

const project = (extra: Partial<ProjectView> = {}): ProjectView => ({
  name: "aide",
  manifest: { ok: false, error: "no manifest" },
  specs: [],
  ...extra,
});

const readiness = (checks: ProjectReadiness["checks"]): ProjectReadiness => ({
  canRun: checks.every((c) => !c.blocking),
  checks,
  note: "",
});

describe("renderProjectPage: title beside ← Back (spec 296)", () => {
  test("the project name sits inside .backhead, right after ← Back, and appears as <h1> exactly once", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    expect(html).toContain(
      '<div class="backhead"><a class="backlink" href="/projects">← Back</a><h1>aide</h1></div>',
    );
    expect(html.match(/<h1>aide<\/h1>/g)?.length ?? 0).toBe(1);
  });
});

// Spec 378: the Health tab is gone, and a checkout-level check (one no
// Config field owns) now reads above the settings table, on Config
// itself — REQ-2/REQ-3 ask for every such check's own text as plain,
// selectable text, never inside a clickable element. `gitRoot` and
// `defaultBranch`/`dashboardCheckout` are checkout-level; a field-owned
// check (`specsRoot`, `worktreeLinks`) is deliberately excluded here —
// it reads on its own settings row instead (see project-settings.test.ts).
describe("renderProjectPage: a checkout-level check shows as plain text on Config (spec 378)", () => {
  const checks: ProjectReadiness["checks"] = [
    { check: "gitRoot", subject: "/repos/aide", ok: false, blocking: true, detail: "Blocking detail text" },
    { check: "defaultBranch", subject: "/repos/aide", ok: true, blocking: false, detail: "passing detail text" },
    { check: "dashboardCheckout", subject: "/repos/aide", ok: false, blocking: false, detail: "Warn detail text" },
  ];

  test("a failing check's detail appears, and none of it sits inside an <a> or a <button> (AC-6)", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      readiness(checks),
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    const failing = checks.filter((c) => !c.ok);
    for (const c of failing) {
      expect(html).toContain(c.detail);
    }
    // AC-6: a check that passed draws nothing at all, not even muted text.
    expect(html).not.toContain("passing detail text");
    const anchors = [...html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
    for (const c of failing) {
      expect(anchors.some((a) => a!.includes(c.detail))).toBe(false);
      expect(buttons.some((b) => b!.includes(c.detail))).toBe(false);
    }
  });

  test("removing a check from the fixture removes its detail from the render (criterion 7)", () => {
    const fewer = checks.slice(0, -1);
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      readiness(fewer),
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    expect(html).not.toContain(checks[checks.length - 1]!.detail);
  });

  // REQ-1: a field-owned check reads on its settings row, never a second
  // time in the checkout-level cards below the summary line. Spec 531's
  // summary line (AC-4) does name a blocking field-owned check's own
  // detail — the reason has to be said somewhere when it is the sole
  // blocker — so the rule this test pins is "appears once", not "never".
  test("a field-owned check's detail appears once (in the summary), never a second time in the checkout-level cards", () => {
    const fieldOwned: ProjectReadiness["checks"] = [
      { check: "specsRoot", subject: "/repos/aide/specs", ok: false, blocking: true, detail: "field-owned detail text" },
    ];
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      readiness(fieldOwned),
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    expect(html.split("field-owned detail text").length - 1).toBe(1);
  });
});

// Spec 531: the project's own description heads its page, and the
// Config tab's readiness answer replaces "The checkout itself" section
// with one summary line plus only the checks that did not pass.
describe("renderProjectPage: the project's description heads the page (spec 531)", () => {
  test("appears between the name and the tab bar when the manifest has one (AC-1)", () => {
    const html = renderProjectPage(
      project({ manifest: { ok: true, data: { description: "Watches the queue for stuck jobs." } } }),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    const backheadEnd = html.indexOf("</div>", html.indexOf('class="backhead"')) + "</div>".length;
    const descIndex = html.indexOf('<p class="desc">');
    const tabsIndex = html.indexOf('class="tabbar subtabs"');
    expect(descIndex).toBeGreaterThan(-1);
    expect(descIndex).toBeGreaterThanOrEqual(backheadEnd);
    expect(descIndex).toBeLessThan(tabsIndex);
    expect(html).toContain("Watches the queue for stuck jobs.");
  });

  test("draws no description line when the manifest has none (AC-2)", () => {
    const html = renderProjectPage(
      project({ manifest: { ok: true, data: {} } }),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    expect(html).not.toContain('class="desc"');
  });

  test("draws no description line when the manifest could not be read (AC-2)", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    expect(html).not.toContain('class="desc"');
  });
});

describe("renderProjectPage: the Config tab's one readiness line (spec 531)", () => {
  test("draws exactly one info line and no check card when every check passed (AC-3)", () => {
    const checks: ProjectReadiness["checks"] = [
      { check: "gitRoot", subject: "/repos/aide", ok: true, blocking: false, detail: "git root ok" },
      { check: "defaultBranch", subject: "/repos/aide", ok: true, blocking: false, detail: "default branch ok" },
    ];
    const html = renderProjectPage(
      project(),
      { hasConfigFile: true, rows: [] },
      readiness(checks),
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    expect(html.match(/rowmsg info/g)?.length ?? 0).toBe(1);
    expect(html).not.toMatch(/rowmsg failed/);
    expect(html).not.toMatch(/rowmsg waiting/);
    expect(html).not.toContain("git root ok");
    expect(html).not.toContain("default branch ok");
  });

  test("draws the board's red error card naming every blocking reason when a check blocks (AC-4)", () => {
    const checks: ProjectReadiness["checks"] = [
      { check: "gitRoot", subject: "/repos/aide", ok: false, blocking: true, detail: "no git root here" },
    ];
    const html = renderProjectPage(
      project(),
      { hasConfigFile: true, rows: [] },
      readiness(checks),
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    const failedIndex = html.indexOf("rowmsg failed");
    expect(failedIndex).toBeGreaterThan(-1);
    const failedCard = html.slice(failedIndex, html.indexOf("</div>", failedIndex));
    expect(failedCard).toContain("no git root here");
    expect(html).not.toMatch(/rowmsg info/);
  });

  test("never draws a 'The checkout itself' heading (AC-5)", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      readiness([{ check: "gitRoot", subject: "/repos/aide", ok: false, blocking: true, detail: "no git root here" }]),
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    expect(html).not.toContain("<h3>The checkout itself</h3>");
  });
});

// Spec 431: the restart-waiting sentence on the Deploy tab reads as a
// plain notice (`rowmsg waiting`), not an error, and exists in the
// reader's own language.
describe("renderProjectPage: Deploy tab's restart-waiting sentence (spec 431)", () => {
  const deployOpts = {
    worktreeLinkCandidates: [],
    editing: false,
    tab: "deploy",
    drift: { behind: 0, checkedAt: 1735689600000 },
    serving: { sha: "aaaa111bbbb", checkoutHead: "bbbb222cccc", current: false },
    restartWaiting: ["aide:070-example"],
  };

  test("names the job and the served commit, styled as a waiting notice, in English", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      NAV,
      deployOpts,
    );
    expect(html).toContain("the restart is waiting for running jobs: aide:070-example");
    expect(html).toContain("aaaa111");
    expect(html).toMatch(/rowmsg waiting/);
  });

  test("renders in Norwegian when opts.lang is nb", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      NAV,
      { ...deployOpts, lang: "nb" },
    );
    expect(html).toContain("omstarten venter på disse jobbene: aide:070-example");
  });
});

// Spec 441: the Deploy tab gets a second, headed section for a test
// server seeded with the round's own test specs, beside the existing
// "Deploy for prod" section (now itself headed for the first time).
describe("renderProjectPage: the Deploy tab's two headed sections (spec 441)", () => {
  const deployTab = (extra: Record<string, unknown> = {}) => ({
    worktreeLinkCandidates: [],
    editing: false,
    tab: "deploy",
    ...extra,
  });

  // AC-1
  test("shows both headings, 'Deploy for prod' and 'Test server with the test specs'", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-09-13T00:00:00Z",
      NAV,
      deployTab({ testServerAvailable: true }),
    );
    expect(html).toContain("<h3>Deploy for prod</h3>");
    expect(html).toContain("<h3>Test server with the test specs</h3>");
  });

  // AC-2: the prod section's existing sentence and button survive
  // unchanged under its new heading.
  test("the prod section's own sentence and button are unchanged", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-09-13T00:00:00Z",
      NAV,
      deployTab({ testServerAvailable: true }),
    );
    expect(html).toMatch(/install command/i);
    expect(html).not.toContain('class="deployform"');
  });

  // AC-3, AC-4: the test-board section's own explanatory sentence and
  // button, when the round is available.
  test("the test-board section shows its sentence and button when available (AC-3, AC-4)", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-09-13T00:00:00Z",
      NAV,
      deployTab({ testServerAvailable: true }),
    );
    expect(html).toContain("Starts a test server from the latest main");
    expect(html).toContain("the server shows up under Test servers");
    expect(html).toContain("data-testserverform");
    expect(html).toContain("Start test server");
  });

  // AC-8: the heading stays, with a sentence explaining why, and no
  // button at all, when the round is not available.
  test("the test-board section names why, with no button, when unavailable (AC-8)", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-09-13T00:00:00Z",
      NAV,
      deployTab({ testServerAvailable: false }),
    );
    expect(html).toContain("<h3>Test server with the test specs</h3>");
    expect(html).toContain("This project does not carry the dashboard's own source");
    expect(html).not.toContain("data-testserverform");
  });

  // Risk analysis's own must-catch case: the button's form must NOT carry
  // any of the three classes `specs-client.ts` intercepts and replaces
  // with an XHR — doing so would silently defeat target="_blank" (AC-5).
  test("the button's form carries none of deployform/actionform/rowrun", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-09-13T00:00:00Z",
      NAV,
      deployTab({ testServerAvailable: true }),
    );
    const form = html.match(/<form[^>]*data-testserverform[^>]*>/)?.[0] ?? "";
    expect(form).not.toBe("");
    expect(form).not.toContain("class=");
    expect(form).toContain('target="_blank"');
  });

  test("in Norwegian (nb), both headings and the note are Norwegian", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-09-13T00:00:00Z",
      NAV,
      deployTab({ testServerAvailable: true, lang: "nb" }),
    );
    expect(html).toContain("<h3>Deploy for prod</h3>");
    expect(html).toContain("<h3>Testserver med testspecene</h3>");
    expect(html).toContain("Starter en testserver fra siste main");
    expect(html).toContain("Start testserver");
  });
});

describe("renderProjectPage: no site-level tab bar (spec 437)", () => {
  test('draws no <nav class="tabbar">', () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    expect(html).not.toContain('<nav class="tabbar">');
  });
});

// Spec 486: the Save form still wears "newspecform" for its look, but
// needs a class of its own so specs-client's NEW_SPEC_FORM selector can
// exclude it — the same treatment the Add-project form got under spec
// 115 (test/specs-client/projects-panel.test.ts).
describe("renderProjectPage: the settings form carries its own JS hook (spec 486)", () => {
  test('the Save form is class="newspecform projectsettingsform", not "newspecform" alone', () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: true },
    );
    expect(html).toContain('class="newspecform projectsettingsform"');
  });
});

describe("renderProjectPage: an added project's Code landing select (AC-6)", () => {
  test("offers merge and pr only, with the stored answer selected", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      null,
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: true, codeLanding: "pr" },
    );
    const start = html.indexOf('<select name="codeLanding"');
    const options = html.slice(start, html.indexOf("</select>", start)).match(/<option[^>]*>/g) ?? [];
    expect(options.map((o) => o.match(/value="([^"]*)"/)![1])).toEqual(["merge", "pr"]);
    expect(options.filter((o) => o.includes("selected")).map((o) => o.match(/value="([^"]*)"/)![1])).toEqual(["pr"]);
  });
});
