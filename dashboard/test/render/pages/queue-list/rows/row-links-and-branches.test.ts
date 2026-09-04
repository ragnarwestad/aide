import { describe, expect, test } from "bun:test";
import { renderQueueRows } from "../../../../../src/render.ts";
import { row } from "../../fixtures.ts";

// Split out of grouping.test.ts by theme.

// Criterion 12: the row a reader actually watches is the way in.
//
// Spec 150 changed WHERE in: the name opens the SPEC, not whichever job
// happened to run last — so every spec has somewhere to point, including
// one that has never run anything.
describe("the queue row links to the spec (criterion 12)", () => {
  const SPEC_HREF = "/specs/aide/81-queue-and-runner";

  test("the spec cell links to the spec page", () => {
    const html = renderQueueRows([row()], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
    });
    // The project leads the name since 2026-08-21: a folder number is
    // only unique within its project, and the line under the name — where
    // the project used to sit — now carries what nothing else says.
    expect(html).toContain(
      `<a class="label" data-goto href="${SPEC_HREF}" title="aide:81-queue-and-runner">`+
        `<span class="muted">aide:</span>81-queue-and-runner</a>`,
    );
  });

  // "A spec that has never run has no job page to point at, so the name
  // is text: a link to nothing is worse than no link." That sentence is
  // what the spec page invalidates.
  test("a spec that has never run is a link too", () => {
    const html = renderQueueRows([], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
    });
    expect(html).toContain(`href="${SPEC_HREF}"`);
    expect(html).not.toContain('<span class="label" title="81-queue-and-runner">');
  });

  // Spec 237: a phase line no longer leaves the spec. It opens the tab
  // that shows what that phase MADE — analyze's is 3-solution.md — on
  // the spec page the reader is already looking at.
  test("the phase lines point at the tab their phase wrote", () => {
    const html = renderQueueRows([row({ steps: ["analyze"], state: "done" })], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: { open: "aide/81-queue-and-runner" },
    });
    expect(html).toContain(`href="${SPEC_HREF}?tab=solution"`);
    expect(html).not.toContain('href="/specs/job-1234"');
  });

  // The name clamps to two lines with an ellipsis (reworked 2026-08-26
  // from a one-line clamp that hid most of a long folder name behind a
  // click).
  test("the stylesheet clamps the name", async () => {
    const { CSS } = await import("../../../../../src/render/ui/css.ts");
    expect(CSS).toContain(".spec-name > .label { overflow: hidden;");
    expect(CSS).toContain("-webkit-line-clamp: 2;");
  });

  // Spec 307: a create job's spec has no folder yet, so `named` is
  // false — the row has nothing real to link to.
  test("an un-landed create job names its row by the form's title, drawn as text, not a link", () => {
    const html = renderQueueRows([row({ steps: ["create"], createTitle: "My new idea" })], {
      runnerAvailable: true,
      targets: [],
    });
    expect(html).toContain('<span class="label">My new idea</span>');
    expect(html).not.toContain("data-goto");
  });

  // REQ-4: the name carries the title now, so the line under it must
  // not say it again.
  test("the un-landed row's title appears once, not repeated under the name", () => {
    const html = renderQueueRows([row({ steps: ["create"], createTitle: "My new idea" })], {
      runnerAvailable: true,
      targets: [],
    });
    expect(html.match(/My new idea/g)).toHaveLength(1);
    expect(html).not.toContain('<div class="spec-title">My new idea</div>');
  });
});
