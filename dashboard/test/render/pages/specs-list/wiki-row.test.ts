// A wiki build shows on the Specs list as one row named <project>:wiki. It is
// a job and not a spec: its name links to the job's own page, its one control
// is Cancel while it is unfinished, and it has no phases and no run button.
import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type SpecTarget } from "../../../../src/render";
import { row } from "../fixtures.ts";

const KEY = "wiki-aide";
const build = (state: string, extra: Record<string, unknown> = {}) =>
  row({ id: "wiki-job-1", specFolder: KEY, steps: ["wiki"], stepIndex: 0, state: state as never, ...extra });
const targets: SpecTarget[] = [{ project: "aide", specFolder: "81-queue-and-runner", done: ["analyze"] }];

// The wiki row's own two lines, up to the gap that closes its group.
const wikiRowOf = (html: string): string =>
  html.match(/<tr class="spechead"[^>]*data-folder="wiki-aide"[\s\S]*?<tr class="specgap"/)?.[0] ?? "";
const draw = (list: ReturnType<typeof build>[], view: Record<string, unknown> = {}, t: SpecTarget[] = targets) =>
  wikiRowOf(renderSpecsRows(list, { runnerAvailable: true, targets: t, ...view } as never));

describe("the Specs list's row for a wiki build (AC-1)", () => {
  test.each(["queued", "running", "done", "failed"])("a %s build has a row named <project>:wiki that links to the job's page", (state) => {
    const html = draw([build(state)]);
    expect(html).not.toBe("");
    expect(html).toContain('href="/specs/wiki-job-1?tab=steps"');
    expect(html).toContain(">wiki<");
    expect(html).toContain("aide");
  });

  test("the row is there in a project that has no specs too", () => {
    expect(draw([build("done")], {}, [])).not.toBe("");
  });

  test("Cancel is offered while the build is unfinished, and never a spec's controls", () => {
    for (const state of ["queued", "running"]) {
      const html = draw([build(state)]);
      expect(html).toContain('action="/api/queue/wiki-job-1/cancel"');
      expect(html).not.toContain('action="/api/queue"');
      expect(html).not.toContain("btn primary\" data-pending=\"starting");
    }
    for (const state of ["done", "failed", "cancelled"]) {
      const html = draw([build(state)]);
      expect(html).not.toContain("/cancel");
      expect(html).not.toContain('action="/api/queue"');
    }
  });

  test("the row has no fold and draws no phase lines, even when ?open= names it", () => {
    const opened = draw([build("done")], { filter: { open: `aide/${KEY}` } });
    expect(opened).not.toContain('<a class="fold');
    expect(opened).not.toContain('class="subrow"');
  });
});
