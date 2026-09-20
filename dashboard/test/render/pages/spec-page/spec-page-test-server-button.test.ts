// A test server already running for a spec is findable and stoppable
// from the spec page.

import { describe, expect, test } from "bun:test";
import type { SpecPageView } from "../../../../src/render";
import { page, view } from "../spec-page-fixtures.ts";

const TEST_SERVER_ACTION = "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/test-server";
const TEST_SERVER_STOP_ACTION = "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/test-server/stop";

describe("the board on the spec page", () => {
  const withBoard = (extra: Partial<SpecPageView> = {}) => page(view({ testServerAction: TEST_SERVER_ACTION, ...extra }));

  test("a board that is starting still says so, with its branch and commit", () => {
    const html = withBoard({ testServer: { status: "starting", branch: "aide/150-one-page", commit: "abc1234" } });
    expect(html).toContain("Starting a test server");
    expect(html).toContain("aide/150-one-page");
    expect(html).toContain("abc1234");
  });

  // REQ-3 (spec 411): the "starting" paragraph carries the shared
  // spinner, the same mark every other busy state on this dashboard
  // already uses, until the page's own 10-second reload (RELOADING_TABS,
  // the Steps tab) carries the reader to "running".
  test("a board that is starting shows the shared spinner", () => {
    const html = withBoard({ testServer: { status: "starting", branch: "aide/150-one-page", commit: "abc1234" } });
    expect(html).toContain('class="spin"');
  });

  test("a failed board says so, with the test run's own error", () => {
    const html = withBoard({
      testServer: { status: "failed", branch: "aide/150-one-page", commit: "abc1234", error: "port already held" },
    });
    expect(html).toContain("could not be started");
    expect(html).toContain("port already held");
  });

  // A running board is the one state that still needs controls: its
  // address to reach it, and Stop to end it.
  test("a running board shows its address, branch, commit, whose specs, and Stop", () => {
    const html = withBoard({
      testServerStopAction: TEST_SERVER_STOP_ACTION,
      testServer: {
        status: "running",
        branch: "aide/150-one-page",
        commit: "abc1234",
        url: "http://127.0.0.1:9001/",
      },
    });
    expect(html).toContain('href="http://127.0.0.1:9001/"');
    expect(html).toContain("The specs shown are from the test suite, not the ones on the prod dashboard");
    expect(html).toContain(`action="${TEST_SERVER_STOP_ACTION}"`);
    expect(html).toContain("Stop test server");
  });

  // The words the specs list already uses for this same thing. "Board"
  // is the name of the product this page is part of and "the round" is
  // a word from the machinery that starts it; neither says anything to
  // a reader.
  test("it is a test server, on this page as in the list", () => {
    const html = withBoard({
      testServerStopAction: TEST_SERVER_STOP_ACTION,
      testServer: { status: "running", branch: "aide/150-one-page", commit: "abc1234", url: "http://127.0.0.1:9001/" },
    });
    expect(html).toContain("Test server:");
    expect(html).not.toContain("Board:");
    expect(html).not.toContain("the round");
  });

  // A loopback host and a port: two things a reader does not
  // read. The link says where it goes instead.
  test("the link carries a name, not the address", () => {
    const html = withBoard({
      testServerStopAction: TEST_SERVER_STOP_ACTION,
      testServer: { status: "running", branch: "aide/150-one-page", commit: "abc1234", url: "http://127.0.0.1:9001/" },
    });
    expect(html).toContain(">Open the test server</a>");
    expect(html).not.toContain(">http://127.0.0.1:9001/</a>");
  });

  // The round only ever knows loopback, and a reader on another device
  // reaches nothing at 127.0.0.1 — "the dashboard is on the tailnet, and
  // this device cannot reach it right now". This dashboard's own start
  // route already builds the address the reader CAN reach, from the host
  // they used, so the link goes through it.
  test("the link goes through this dashboard, not straight to loopback", () => {
    const html = withBoard({
      testServerOpenHref: "/specs/aide/150-one-page-shows-the-whole-spec?tab=steps&startTestServer=1",
      testServerStopAction: TEST_SERVER_STOP_ACTION,
      testServer: { status: "running", branch: "aide/150-one-page", commit: "abc1234", url: "http://127.0.0.1:9001/" },
    });
    expect(html).toContain('href="/specs/aide/150-one-page-shows-the-whole-spec?tab=steps&amp;startTestServer=1"');
    expect(html).not.toContain("127.0.0.1:9001");
  });

  test("a full commit id is shortened where it is shown", () => {
    const full = "b67707e9d48ac603caa47e3a4e32ff30fff6ae7d";
    for (const status of ["starting", "running"] as const) {
      const html = withBoard({
        testServerStopAction: TEST_SERVER_STOP_ACTION,
        testServer: { status, branch: "aide/150-one-page", commit: full, url: "http://127.0.0.1:9001/" },
      });
      expect([status, html.includes("@ b67707e"), html.includes(full)]).toEqual([status, true, false]);
    }
  });

  test("no testServerAction at all draws nothing", () => {
    expect(page(view())).not.toContain("Stop test server");
    expect(page(view())).not.toContain(TEST_SERVER_ACTION);
  });

  // REQ-1 (spec 425): an archived spec's own board must stay visible —
  // `testServerAction` (whether a NEW board may be started) is absent, the
  // same as a genuinely boardless spec, but `testServer`/`testServerStopAction`
  // are present because one is already tracked. The old guard read
  // `!view.testServerAction || !view.testServer`, which hid this exact case.
  test("REQ-1: archived-but-tracked — no testServerAction, board present, still renders the link and Stop form", () => {
    const html = page(
      view({
        testServerAction: undefined,
        testServerStopAction: TEST_SERVER_STOP_ACTION,
        testServer: {
          status: "running",
          branch: "aide/150-one-page",
          commit: "abc1234",
          url: "http://127.0.0.1:9001/",
        },
      }),
    );
    expect(html).toContain(">Open the test server</a>");
    expect(html).toContain(`action="${TEST_SERVER_STOP_ACTION}"`);
    expect(html).toContain("Stop test server");
  });
});

// The tab row holds BUTTONS. A `<p>` among them is a block element in a
// flex row: the whole action group wraps below the tabs and the buttons
// stack on top of each other, which is what put PDF/Close at the
// foot of every tab.
describe("the spec's actions stay on the tab row", () => {
  const withBoard = (extra: Partial<SpecPageView> = {}) => page(view({ testServerAction: TEST_SERVER_ACTION, ...extra }));

  const trailing = (html: string) => {
    const nav = html.slice(html.indexOf('<nav class="tabbar subtabs">'));
    return nav.slice(nav.indexOf('<span class="row">'), nav.indexOf("</nav>"));
  };

  test("the action group carries no paragraph, in any board state", () => {
    for (const extra of [
      {},
      { testServer: { status: "starting" as const, branch: "b", commit: "c" } },
      { testServer: { status: "failed" as const, branch: "b", commit: "c", error: "port already held" } },
      {
        testServerStopAction: TEST_SERVER_STOP_ACTION,
        testServer: { status: "running" as const, branch: "b", commit: "c", url: "http://127.0.0.1:9001/" },
      },
    ]) {
      const row = trailing(withBoard(extra));
      expect([JSON.stringify(extra).slice(0, 40), row.includes("<p ")]).toEqual([
        JSON.stringify(extra).slice(0, 40),
        false,
      ]);
    }
  });

  // Spec 457: the sentence moved from its own "(?)" (resetCloseNote)
  // into the row's single shared one (actionsHelp) — still a "(?)",
  // never a paragraph under the row.
  test("the Close sentence is a (?) in the row, not a paragraph under it", () => {
    const html = page(view({ closeAction: "/specs/aide/x/close" }));
    expect(html).toContain("Close says this spec will not work and archives it as a record");
    expect(trailing(html)).toContain('<details class="intro">');
    expect(html).not.toMatch(/<p class="small muted">Reset/);
  });

  // A board belongs to the banner entirely now — its address, its state
  // and its Stop button. Nothing board-shaped is left in the tab row.
  test("a running board sits above the tabs, Stop included, and not in the row", () => {
    const html = withBoard({
      testServerStopAction: TEST_SERVER_STOP_ACTION,
      testServer: { status: "running", branch: "aide/150-one-page", commit: "abc1234", url: "http://127.0.0.1:9001/" },
    });
    const navIdx = html.indexOf('<nav class="tabbar subtabs">');
    expect(html.indexOf("The specs shown are from the test suite")).toBeLessThan(navIdx);
    expect(html.indexOf("Stop test server")).toBeLessThan(navIdx);
    expect(trailing(html)).not.toContain("board");
  });
});
