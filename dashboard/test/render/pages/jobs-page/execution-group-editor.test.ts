import { expect, test } from "bun:test";
import { executionGroupEditor } from "../../../../src/render/pages/jobs-page/execution-group-editor.ts";

test("New group shows project, name, eligible ids, titles and explicit order (AC-1, AC-2, AC-11)", () => {
  const html = executionGroupEditor({ projects: ["aide"], candidates: [{ project: "aide", specFolder: "765-long", title: "Create and order groups" }] });
  expect(html).toContain("New group");
  expect(html).toContain('name="project"');
  expect(html).toContain('name="name"');
  expect(html).toContain("765-long");
  expect(html).toContain("Create and order groups");
  expect(html).toContain('name="position"');
});

test("Edit addresses the prepared group by id and keeps its name read-only (AC-6, AC-7, AC-10)", () => {
  const html = executionGroupEditor({
    projects: ["aide"], candidates: [{ project: "aide", specFolder: "1-first", title: "First" }],
    group: { id: "group-1", project: "aide", name: "Release", members: ["1-first"], branch: "group/1-first", state: "prepared", completedMembers: [], jobs: [] },
  });
  expect(html).toContain("/api/queue/groups/group-1");
  expect(html).toContain('value="Release" readonly');
  expect(html).toContain('value="1-first" checked');
});

test("New group is drawn closed until it is opened", () => {
  const html = executionGroupEditor({ projects: ["aide"], candidates: [] });
  expect(html).toMatch(/^<details class="execution-group-editor">/);
});
