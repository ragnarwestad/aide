// REQ-3/REQ-4 (spec 425): one board-wide place listing every tracked
// test server, with a Stop button on every row regardless of status —
// a stuck "starting" entry holds a port exactly as a "running" one
// does, and a "failed" entry otherwise has no way to be cleared from
// this page (Plan review, Scope guardian must-fix).

import { describe, expect, test } from "bun:test";
import { renderTestServersPage, type TestServerRow } from "../../../src/render.ts";

const NAV = [{ label: "Overview", path: "projects.html" }];
const GENERATED = "2026-09-09T10:00:00Z";

const row = (extra: Partial<TestServerRow> = {}): TestServerRow => ({
  project: "aide",
  specFolder: "150-one-page-shows-the-whole-spec",
  specHref: "/specs/aide/150-one-page-shows-the-whole-spec",
  branch: "aide/150-one-page-shows-the-whole-spec",
  status: "running",
  url: "http://127.0.0.1:8801/?token=t0ken",
  stopAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/board/stop",
  ...extra,
});

describe("the test servers overview", () => {
  test("one row per board, across more than one project", () => {
    const html = renderTestServersPage(NAV, GENERATED, [
      row(),
      row({
        project: "woodstack",
        specFolder: "9-x",
        specHref: "/specs/woodstack/9-x",
        branch: "aide/9-x",
        status: "starting",
        url: undefined,
        stopAction: "/api/queue/specs/woodstack/9-x/board/stop",
      }),
    ]);
    expect(html).toContain("aide");
    expect(html).toContain("150-one-page-shows-the-whole-spec");
    expect(html).toContain("woodstack");
    expect(html).toContain("9-x");
  });

  test("a row names its own project, spec, branch and status", () => {
    const html = renderTestServersPage(NAV, GENERATED, [row({ status: "failed", url: undefined })]);
    expect(html).toContain("aide");
    expect(html).toContain("150-one-page-shows-the-whole-spec");
    expect(html).toContain("aide/150-one-page-shows-the-whole-spec");
    expect(html).toContain("failed");
  });

  // REQ-4's own text is unconditional: every row, whatever its status.
  test("a Stop form on a starting row, not only a running one", () => {
    const r = row({ status: "starting", url: undefined });
    const html = renderTestServersPage(NAV, GENERATED, [r]);
    expect(html).toContain(`action="${r.stopAction}"`);
  });

  test("a Stop form on a failed row too — the one page that can clear it", () => {
    const r = row({ status: "failed", url: undefined });
    const html = renderTestServersPage(NAV, GENERATED, [r]);
    expect(html).toContain(`action="${r.stopAction}"`);
  });

  test("a running row links to the board, by name, not by its raw address", () => {
    const html = renderTestServersPage(NAV, GENERATED, [row()]);
    expect(html).toContain('href="http://127.0.0.1:8801/?token=t0ken"');
    expect(html).toContain(`action="${row().stopAction}"`);
  });

  // This codebase's own "nothing to show, show nothing" rule — most of
  // the time zero boards are running, and a table with no rows in it
  // reads as broken rather than as the ordinary case.
  test("zero rows draws the empty-state sentence, not an empty table", () => {
    const html = renderTestServersPage(NAV, GENERATED, []);
    expect(html).not.toContain("<table");
    expect(html.toLowerCase()).toContain("no test server");
  });

  // REQ-4's end-to-end clause: pressing Stop already removes the entry
  // (the existing, already-tested `.../board/stop` route and
  // `stopBoard()`); what this page adds is that the NEXT load no longer
  // shows the row for it.
  test("a row whose entry is gone is not drawn on the next load", () => {
    const rows = [
      row(),
      row({
        project: "woodstack",
        specFolder: "9-x",
        specHref: "/specs/woodstack/9-x",
        branch: "aide/9-x",
        stopAction: "/api/queue/specs/woodstack/9-x/board/stop",
      }),
    ];
    const before = renderTestServersPage(NAV, GENERATED, rows);
    expect(before).toContain("woodstack");
    const after = renderTestServersPage(NAV, GENERATED, rows.slice(0, 1));
    expect(after).not.toContain("woodstack");
    expect(after).toContain("aide");
  });
});
