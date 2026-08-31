// Spec 296: `renderProjectPage` had no direct test before this — only
// `test/render/pages/site.test.ts`'s exercise of the generated static
// site around it (nav, tabs), never its own heading or Back link.

import { describe, expect, test } from "bun:test";
import { renderProjectPage } from "../../../../src/render/pages/site/project-page.ts";
import type { ProjectView } from "../../../../src/render/pages/site/types.ts";

const NAV = [{ label: "Projects", path: "/projects" }];

const project = (extra: Partial<ProjectView> = {}): ProjectView => ({
  name: "aide",
  manifest: { ok: false, error: "no manifest" },
  specs: [],
  ...extra,
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
