// Spec 388 put a Start board button in the spec page's tab row. It is
// gone: it took the width that made that row wider than the fields and
// the editor below it, and a press costing minutes and real model spend
// needs a home of its own. The POST route is untouched — what these
// tests pin is that the page offers no button to it, and that a board
// already running is still findable and stoppable.

import { describe, expect, test } from "bun:test";
import type { SpecPageView } from "../../../src/render.ts";
import { page, view } from "./spec-page-fixtures.ts";

const BOARD_ACTION = "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/board";
const BOARD_STOP_ACTION = "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/board/stop";

describe("the board: no Start button on the spec page", () => {
  const withBoard = (extra: Partial<SpecPageView> = {}) => page(view({ boardAction: BOARD_ACTION, ...extra }));

  test("no Start board button, and nothing posting to the start route", () => {
    expect(withBoard()).not.toContain("Start board");
    expect(withBoard()).not.toContain(`action="${BOARD_ACTION}"`);
  });

  test("its cost warning went with it — there is no press left to warn about", () => {
    expect(withBoard()).not.toContain("real model spend");
  });

  test("a board that is starting still says so, with its branch and commit", () => {
    const html = withBoard({ board: { status: "starting", branch: "aide/150-one-page", commit: "abc1234" } });
    expect(html).toContain("Starting a test server");
    expect(html).toContain("aide/150-one-page");
    expect(html).toContain("abc1234");
  });

  // REQ-3 (spec 411): the "starting" paragraph carries the shared
  // spinner, the same mark every other busy state on this dashboard
  // already uses, until the page's own 10-second reload (RELOADING_TABS,
  // the Steps tab) carries the reader to "running".
  test("a board that is starting shows the shared spinner", () => {
    const html = withBoard({ board: { status: "starting", branch: "aide/150-one-page", commit: "abc1234" } });
    expect(html).toContain('class="spin"');
  });

  test("a failed board says so, with the test run's own error", () => {
    const html = withBoard({
      board: { status: "failed", branch: "aide/150-one-page", commit: "abc1234", error: "port already held" },
    });
    expect(html).toContain("could not be started");
    expect(html).toContain("port already held");
  });

  // A running board is the one state that still needs controls: its
  // address to reach it, and Stop to end it.
  test("a running board shows its address, branch, commit, whose specs, and Stop", () => {
    const html = withBoard({
      boardStopAction: BOARD_STOP_ACTION,
      board: {
        status: "running",
        branch: "aide/150-one-page",
        commit: "abc1234",
        url: "http://127.0.0.1:9001/?token=t0ken",
      },
    });
    expect(html).toContain('href="http://127.0.0.1:9001/?token=t0ken"');
    expect(html).toContain("The specs shown are from the test suite, not the ones on the prod dashboard");
    expect(html).toContain(`action="${BOARD_STOP_ACTION}"`);
    expect(html).toContain("Stop test server");
  });

  // The words the specs list already uses for this same thing. "Board"
  // is the name of the product this page is part of and "the round" is
  // a word from the machinery that starts it; neither says anything to
  // a reader.
  test("it is a test server, on this page as in the list", () => {
    const html = withBoard({
      boardStopAction: BOARD_STOP_ACTION,
      board: { status: "running", branch: "aide/150-one-page", commit: "abc1234", url: "http://127.0.0.1:9001/" },
    });
    expect(html).toContain("Test server:");
    expect(html).not.toContain("Board:");
    expect(html).not.toContain("the round");
  });

  // A loopback host, a port and a token: three things a reader does not
  // read. The link says where it goes instead.
  test("the link carries a name, not the address", () => {
    const html = withBoard({
      boardStopAction: BOARD_STOP_ACTION,
      board: { status: "running", branch: "aide/150-one-page", commit: "abc1234", url: "http://127.0.0.1:9001/?token=t0ken" },
    });
    expect(html).toContain(">Open the test server</a>");
    expect(html).not.toContain(">http://127.0.0.1:9001/?token=t0ken</a>");
  });

  test("a full commit id is shortened where it is shown", () => {
    const full = "b67707e9d48ac603caa47e3a4e32ff30fff6ae7d";
    for (const status of ["starting", "running"] as const) {
      const html = withBoard({
        boardStopAction: BOARD_STOP_ACTION,
        board: { status, branch: "aide/150-one-page", commit: full, url: "http://127.0.0.1:9001/" },
      });
      expect([status, html.includes("@ b67707e"), html.includes(full)]).toEqual([status, true, false]);
    }
  });

  test("no boardAction at all draws nothing", () => {
    expect(page(view())).not.toContain("Stop test server");
    expect(page(view())).not.toContain(BOARD_ACTION);
  });
});

// The tab row holds BUTTONS. A `<p>` among them is a block element in a
// flex row: the whole action group wraps below the tabs and the buttons
// stack on top of each other, which is what put PDF/Reset/Close at the
// foot of every tab.
describe("the spec's actions stay on the tab row", () => {
  const withBoard = (extra: Partial<SpecPageView> = {}) => page(view({ boardAction: BOARD_ACTION, ...extra }));

  const trailing = (html: string) => {
    const nav = html.slice(html.indexOf('<nav class="tabbar subtabs">'));
    const row = nav.slice(nav.indexOf('<span class="row">'), nav.indexOf("</nav>"));
    return row;
  };

  test("the action group carries no paragraph, in any board state", () => {
    for (const extra of [
      {},
      { board: { status: "starting" as const, branch: "b", commit: "c" } },
      { board: { status: "failed" as const, branch: "b", commit: "c", error: "port already held" } },
      {
        boardStopAction: BOARD_STOP_ACTION,
        board: { status: "running" as const, branch: "b", commit: "c", url: "http://127.0.0.1:9001/" },
      },
    ]) {
      const row = trailing(withBoard(extra));
      expect([JSON.stringify(extra).slice(0, 40), row.includes("<p ")]).toEqual([
        JSON.stringify(extra).slice(0, 40),
        false,
      ]);
    }
  });

  test("the Reset-or-Close sentence is a (?) in the row, not a paragraph under it", () => {
    const html = page(view({ resetAction: "/specs/aide/x/reset", closeAction: "/specs/aide/x/close" }));
    expect(html).toContain("Reset or Close");
    expect(trailing(html)).toContain('<details class="intro">');
    expect(html).not.toMatch(/<p class="small muted">Reset/);
  });

  // A board belongs to the banner entirely now — its address, its state
  // and its Stop button. Nothing board-shaped is left in the tab row.
  test("a running board sits above the tabs, Stop included, and not in the row", () => {
    const html = withBoard({
      boardStopAction: BOARD_STOP_ACTION,
      board: { status: "running", branch: "aide/150-one-page", commit: "abc1234", url: "http://127.0.0.1:9001/" },
    });
    const navIdx = html.indexOf('<nav class="tabbar subtabs">');
    expect(html.indexOf("The specs shown are from the test suite")).toBeLessThan(navIdx);
    expect(html.indexOf("Stop test server")).toBeLessThan(navIdx);
    expect(trailing(html)).not.toContain("board");
  });
});
