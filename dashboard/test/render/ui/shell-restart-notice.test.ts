// A Deploy press whose restart is held back by running jobs used to be
// visible on the Deploy tab alone: every other page ran on, and the
// jobs it was waiting for — and the ones started during the wait, which
// the deadline kills — gave no sign. pageShell() is the one function
// every page renders through, so the notice lives there, from the same
// list the Deploy tab already reads.
import { afterEach, describe, expect, test } from "bun:test";

import { pageShell } from "../../../src/render/ui/shell.ts";
import { setPendingRestartNotice } from "../../../src/render/ui/pending-restart.ts";
import { createServerState, setPendingRestart, STARTED_AT } from "../../../src/serve/state.ts";

const ENTRIES = [{ label: "Projects", path: "/projects" }];
const render = (): string => pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-14T00:00:00Z");

afterEach(() => setPendingRestartNotice([]));

/** The page's text with its tags removed: the names are links now, and
 *  the tests about WHICH jobs are named read what a reader reads. */
const text = (html: string): string => html.replace(/<[^>]*>/g, "");
const noticeOf = (html: string): string =>
  html.match(/<p [^>]*class="restart-notice rowmsg waiting">.*?<\/p>/s)?.[0] ?? "";

describe("pageShell's waiting-Deploy notice", () => {
  test("the server's own pending-restart writer is what feeds it", () => {
    const state = createServerState();
    setPendingRestart(state, ["aide:457-a-spec"]);
    expect(text(noticeOf(render()))).toContain("aide:457");
    setPendingRestart(state, []);
    expect(render()).not.toContain("restart-notice");
  });

  // The page watches for a process other than this one to answer
  // (`restart-watch.ts`), so the notice carries when this one started.
  test("the server's writer stamps the notice with when this process started", () => {
    const state = createServerState();
    setPendingRestart(state, ["aide:457-a-spec"]);
    expect(noticeOf(render())).toContain(`data-started-at="${STARTED_AT}"`);
  });

  test("a fresh server state clears a notice left by an earlier process life", () => {
    setPendingRestartNotice(["aide:457-a-spec"]);
    createServerState();
    expect(render()).not.toContain("restart-notice");
  });
});

describe("only the newest server's state writes the notice", () => {
  // A server that has been replaced — a test file's harness, a process
  // that lost the port — can still have restartAfterLanding's wait loop
  // running, and that loop writes the pending list every poll. It must
  // not overwrite what the server now serving has published.
  test("an older state's writes are ignored once a newer state exists", () => {
    const older = createServerState();
    const newer = createServerState();
    setPendingRestart(older, ["aide:81-queue-and-runner"]);
    expect(render()).not.toContain("restart-notice");
    setPendingRestart(newer, ["aide:459-a-spec"]);
    setPendingRestart(older, []);
    expect(text(noticeOf(render()))).toContain("aide:459");
    setPendingRestart(newer, []);
    expect(render()).not.toContain("restart-notice");
  });
});
