import { expect, test } from "bun:test";
import { renderScheduleForm } from "../../../../src/render/pages/schedule-page/form.ts";

test("the schedule form takes no project list and draws no project picker (AC-5)", () => {
  const html = renderScheduleForm({
    action: "/schedule",
    // @ts-expect-error -- the form has no project picker to fill
    projects: ["a", "b"],
  });
  expect(html).not.toContain(`<select name="project">`);
});
