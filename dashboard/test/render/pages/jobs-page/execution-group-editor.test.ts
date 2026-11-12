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

test("New group is drawn closed until it is opened", () => {
  const html = executionGroupEditor({ projects: ["aide"], candidates: [] });
  expect(html).toMatch(/^<details class="execution-group-editor">/);
});
