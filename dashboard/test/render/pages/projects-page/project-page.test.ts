// Spec 296: `renderProjectPage` had no direct test before this — only
// `test/render/pages/projects-page-shell.test.ts`'s exercise of the
// generated static site around it (nav, tabs), never its own heading or
// Back link.

import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render/pages/projects-page/project-page.ts";
import type { ProjectReadiness } from "../../../../src/project/project-admin.ts";
import type { ProjectView } from "../../../../src/render/pages/projects-page/types.ts";

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

  test("every check's detail appears, and none of it sits inside an <a> or a <button>", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      readiness(checks),
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false },
    );
    for (const c of checks) {
      expect(html).toContain(c.detail);
    }
    const anchors = [...html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
    for (const c of checks) {
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
  // time in the checkout-level section above it.
  test("a field-owned check's detail does not appear in the checkout-level section", () => {
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
    expect(html).not.toContain("field-owned detail text");
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
    expect(html).toContain('class="testserverform"');
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
    expect(html).not.toContain('class="testserverform"');
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
    const form = html.match(/<form[^>]*class="testserverform"[^>]*>/)?.[0] ?? "";
    expect(form).not.toBe("");
    expect(form).not.toMatch(/class="[^"]*\b(deployform|actionform|rowrun)\b/);
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
