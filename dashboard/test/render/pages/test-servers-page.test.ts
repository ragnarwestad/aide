// REQ-3/REQ-4 (spec 425): one board-wide place listing every tracked
// test server, with a Stop button on every row regardless of status —
// a stuck "starting" entry holds a port exactly as a "running" one
// does, and a "failed" entry otherwise has no way to be cleared from
// this page (Plan review, Scope guardian must-fix).

import { describe, expect, test } from "bun:test";
import { renderTestServersPage, type TestServerRow } from "../../../src/render";

const NAV = [{ label: "Overview", path: "projects.html" }];
const GENERATED = "2026-09-09T10:00:00Z";

const row = (extra: Partial<TestServerRow> = {}): TestServerRow => ({
  project: "aide",
  specFolder: "150-one-page-shows-the-whole-spec",
  specHref: "/specs/aide/150-one-page-shows-the-whole-spec",
  branch: "aide/150-one-page-shows-the-whole-spec",
  status: "running",
  url: "http://127.0.0.1:8801/",
  stopAction: "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/test-server/stop",
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
        stopAction: "/api/queue/specs/woodstack/9-x/test-server/stop",
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

  test("a running row links to the board, by its host and port, not by the word Open", () => {
    const html = renderTestServersPage(NAV, GENERATED, [row()]);
    expect(html).toContain('href="http://127.0.0.1:8801/"');
    expect(html).toContain(">127.0.0.1:8801</a>");
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
  // (the existing, already-tested `.../test-server/stop` route and
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
        stopAction: "/api/queue/specs/woodstack/9-x/test-server/stop",
      }),
    ];
    const before = renderTestServersPage(NAV, GENERATED, rows);
    expect(before).toContain("woodstack");
    const after = renderTestServersPage(NAV, GENERATED, rows.slice(0, 1));
    expect(after).not.toContain("woodstack");
    expect(after).toContain("aide");
  });

  // AC-7 (spec 441): a board started from the Deploy tab is tracked under
  // "main" — not a real spec folder — and posts its Stop form to the
  // project-scoped route rather than a spec-scoped one that would 404.
  test("a non-spec specFolder ('main') renders as plain text, not a link", () => {
    const r = row({
      specFolder: "main",
      branch: "main",
      stopAction: "/api/queue/projects/aide/test-server/stop",
    });
    const html = renderTestServersPage(NAV, GENERATED, [r]);
    expect(html).not.toContain(`<a href="${r.specHref}">main</a>`);
    expect(html).toContain('<td data-col="ts-spec">main</td>');
    expect(html).toContain(`action="${r.stopAction}"`);
  });

  // A real spec-folder row is unaffected — every existing row still links.
  test("a real spec-folder row is unchanged, byte for byte", () => {
    const r = row();
    const html = renderTestServersPage(NAV, GENERATED, [r]);
    expect(html).toContain(`<a href="${r.specHref}">${r.specFolder}</a>`);
  });

  test("the table is a list table wrapped in .tablewrap, with six named columns (AC-1)", () => {
    const html = renderTestServersPage(NAV, GENERATED, [row()]);
    expect(html).toContain('<div id="test-servers-rows" class="tablewrap"><table class="list testservers">');
    const cols = [...html.matchAll(/<col data-col="([\w-]+)">/g)].map((m) => m[1]);
    const names = ["ts-project", "ts-spec", "ts-branch", "ts-status", "ts-address", "ts-stop"];
    expect(cols).toEqual(names);
    for (const n of names) {
      expect(html).toContain(`<th data-col="${n}">`);
      expect(html).toContain(`<td data-col="${n}">`);
    }
  });

  test("the link's text is the host and port, without scheme, path or token (AC-5)", () => {
    const html = renderTestServersPage(NAV, GENERATED, [
      row({ url: "https://rw-macmini.ts.net:8801/?token=t0ken" }),
    ]);
    expect(html).toContain(">rw-macmini.ts.net:8801</a>");
    expect(html).not.toContain(">Open<");
    expect(html).not.toMatch(/>[^<]*t0ken[^<]*</);
  });

  test("an address that does not parse is shown as it is, escaped (AC-5)", () => {
    const html = renderTestServersPage(NAV, GENERATED, [row({ url: "not a <url>" })]);
    expect(html).toContain(">not a &lt;url&gt;</a>");
  });

  // Spec 529: the Stop button's own refusal slot, empty until the
  // browser code writes into it (AC-3).
  test("a row's Stop form carries an empty .refused slot (AC-3)", () => {
    const html = renderTestServersPage(NAV, GENERATED, [row()]);
    expect(html).toContain('<p class="refused rowmsg failed"></p>');
  });
});
