// Spec 296: `renderProjectPage` had no direct test before this — only
// `test/render/pages/site.test.ts`'s exercise of the generated static
// site around it (nav, tabs), never its own heading or Back link.

import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render/pages/site/project-page.ts";
import type { ProjectReadiness } from "../../../../src/project/project-admin.ts";
import type { ProjectView } from "../../../../src/render/pages/site/types.ts";

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
    { check: "gitRoot", subject: "/repos/aide", ok: false, blocking: true, detail: "blocking detail text" },
    { check: "defaultBranch", subject: "/repos/aide", ok: true, blocking: false, detail: "passing detail text" },
    { check: "dashboardCheckout", subject: "/repos/aide", ok: false, blocking: false, detail: "warn detail text" },
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
