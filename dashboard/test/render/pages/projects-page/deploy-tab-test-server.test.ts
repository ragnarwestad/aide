// A project's Deploy tab offers a test server only where one can start: a
// project that cannot is not told about it at all.
import { describe, expect, test } from "bun:test";
import { renderProjectPage, type ProjectView } from "../../../../src/render";

function deployTab(testServerAvailable: boolean): string {
  const project: ProjectView = { name: "paceup", manifest: { ok: false, error: "no manifest" }, specs: [] };
  return renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-10-05T00:00:00Z", [], {
    worktreeLinkCandidates: [],
    editingGroup: null,
    tab: "deploy",
    testServerAvailable,
  });
}

describe("the test server on a project's Deploy tab", () => {
  test("is left out where no test server can start, with nothing said about why", () => {
    expect(deployTab(false)).not.toContain("/api/queue/projects/paceup/test-server");
    expect(deployTab(false)).not.toContain("Test server with the test specs");
  });

  test("is offered where one can start", () => {
    expect(deployTab(true)).toContain("/api/queue/projects/paceup/test-server");
  });
});
