// Spec 388: a spec whose own branch carries code offers to start a
// board running it. Follows spec-page-pdf-button.test.ts's own shape —
// disabled with a reason rather than hidden, and the REQ-3 warning has
// to be visible page text, never only a hover title.

import { describe, expect, test } from "bun:test";
import type { SpecPageView } from "../../../src/render.ts";
import { page, view } from "./spec-page-fixtures.ts";

const BOARD_ACTION = "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/board";
const BOARD_STOP_ACTION = "/api/queue/specs/aide/150-one-page-shows-the-whole-spec/board/stop";

describe("spec 388: the board control", () => {
  const withBoard = (extra: Partial<SpecPageView> = {}) => page(view({ boardAction: BOARD_ACTION, ...extra }));

  test("no boardAction at all draws nothing", () => {
    expect(page(view())).not.toContain("Start board");
    expect(page(view())).not.toContain(BOARD_ACTION);
  });

  test("REQ-3: the cost is stated as visible page text before the button is ever pressed", () => {
    const html = withBoard();
    expect(html).toContain("Start board");
    expect(html).toContain(`action="${BOARD_ACTION}"`);
    // Not only a title attribute: the warning has to be readable on the
    // page itself, with no hover.
    expect(html).toMatch(/full round[\s\S]*minutes[\s\S]*model spend/);
    const beforeTitleStrip = html.replace(/title="[^"]*"/g, "");
    expect(beforeTitleStrip).toMatch(/full round/);
  });

  test("it is a form, never a bare link — a reload cannot repeat it", () => {
    const html = withBoard();
    expect(html).toContain(`<form class="actionform" method="post" action="${BOARD_ACTION}">`);
  });

  test("when the round is unavailable or the branch carries no code, the disabled reason still shows", () => {
    const html = withBoard({ boardUnavailableReason: "another job for this spec is still running" });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("another job for this spec is still running");
    expect(html).not.toContain(`action="${BOARD_ACTION}"`);
    expect(html).toContain(">Start board</span>");
  });

  test("REQ-4: a starting board says so, with its branch and commit", () => {
    const html = withBoard({ board: { status: "starting", branch: "aide/150-one-page", commit: "abc1234" } });
    expect(html).toContain("Starting a board");
    expect(html).toContain("aide/150-one-page");
    expect(html).toContain("abc1234");
    expect(html).not.toContain("Start board</button>");
  });

  test("a failed board says so, with the round's own error", () => {
    const html = withBoard({
      board: { status: "failed", branch: "aide/150-one-page", commit: "abc1234", error: "port already held" },
    });
    expect(html).toContain("failed to start");
    expect(html).toContain("port already held");
  });

  test("REQ-4/REQ-5: a running board shows its address, branch, commit, and whose specs they are", () => {
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
    expect(html).toContain("aide/150-one-page");
    expect(html).toContain("abc1234");
    expect(html).toContain("the round's own fixture specs, not this project's");
    expect(html).toContain(`action="${BOARD_STOP_ACTION}"`);
    expect(html).toContain("Stop board");
  });
});
