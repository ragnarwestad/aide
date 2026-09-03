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

// Spec 369: the readiness sentence moved off `/projects` onto this tab —
// REQ-2 asks for every check's own text as plain, selectable text, never
// inside a clickable element.
describe("renderProjectPage: the Health tab shows every check as plain text (spec 369)", () => {
  const checks: ProjectReadiness["checks"] = [
    { check: "gitRoot", subject: "/repos/aide", ok: false, blocking: true, detail: "blocking detail text" },
    { check: "specsRoot", subject: "/repos/specs", ok: true, blocking: false, detail: "passing detail text" },
    { check: "worktreeLinks", subject: "/repos/aide", ok: false, blocking: false, detail: "warn detail text" },
  ];

  test("every check's detail appears, and none of it sits inside an <a> or a <button>", () => {
    const html = renderProjectPage(
      project(),
      { hasConfigFile: false, rows: [] },
      readiness(checks),
      "2026-08-31T00:00:00Z",
      NAV,
      { worktreeLinkCandidates: [], editing: false, tab: "health" },
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
      { worktreeLinkCandidates: [], editing: false, tab: "health" },
    );
    expect(html).not.toContain(checks[checks.length - 1]!.detail);
  });
});
