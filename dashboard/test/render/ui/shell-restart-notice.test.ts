// A Deploy press whose restart is held back by running jobs used to be
// visible on the Deploy tab alone: every other page ran on, and the
// jobs it was waiting for — and the ones started during the wait, which
// the deadline kills — gave no sign. pageShell() is the one function
// every page renders through, so the notice lives there, from the same
// list the Deploy tab already reads.
import { afterEach, describe, expect, test } from "bun:test";

import { pageShell } from "../../../src/render/ui/shell.ts";
import { setPendingRestartNotice } from "../../../src/render/ui/pending-restart.ts";
import { createServerState, setPendingRestart } from "../../../src/serve/state.ts";

const ENTRIES = [{ label: "Projects", path: "/projects" }];
const render = (): string => pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-14T00:00:00Z");

afterEach(() => setPendingRestartNotice([]));

/** The page's text with its tags removed: the names are links now, and
 *  the tests about WHICH jobs are named read what a reader reads. */
const text = (html: string): string => html.replace(/<[^>]*>/g, "");
const noticeOf = (html: string): string =>
  html.match(/<p class="restart-notice rowmsg waiting">.*?<\/p>/s)?.[0] ?? "";

describe("pageShell's waiting-Deploy notice", () => {
  test("names the jobs the restart waits for, as a warning under the header", () => {
    setPendingRestartNotice(["aide:457-a-spec", "aide:458-another"]);
    const html = render();
    const notice = html.match(/<p class="restart-notice rowmsg waiting">.*?<\/p>/s)?.[0];
    expect(notice).toBeDefined();
    expect(text(notice!)).toContain("aide:457-a-spec, aide:458-another");
    // Under the header, before the tab bar: the same slot the install
    // warning already has.
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("restart-notice"));
    expect(html.indexOf("restart-notice")).toBeLessThan(html.indexOf('<nav class="tabbar"', html.indexOf("</header>")));
  });

  test("shows nothing once the wait is over", () => {
    setPendingRestartNotice(["aide:457-a-spec"]);
    setPendingRestartNotice([]);
    expect(render()).not.toContain("restart-notice");
  });

  test("the server's own pending-restart writer is what feeds it", () => {
    const state = createServerState();
    setPendingRestart(state, ["aide:457-a-spec"]);
    expect(text(noticeOf(render()))).toContain("aide:457-a-spec");
    setPendingRestart(state, []);
    expect(render()).not.toContain("restart-notice");
  });

  test("a fresh server state clears a notice left by an earlier process life", () => {
    setPendingRestartNotice(["aide:457-a-spec"]);
    createServerState();
    expect(render()).not.toContain("restart-notice");
  });
});

describe("the jobs the notice names are links (AC-2)", () => {
  test("a spec's name is two links: the project's page and the spec's page (AC-2)", () => {
    setPendingRestartNotice(["aide:457-a-spec", "aide:458-another"]);
    const notice = noticeOf(render());
    expect(notice).toContain(
      '<a data-goto href="/projects/aide">aide</a><a data-goto href="/specs/aide/457-a-spec">:457-a-spec</a>',
    );
    expect(notice).toContain('<a data-goto href="/specs/aide/458-another">:458-another</a>');
    expect(text(notice)).toContain("Deploy is waiting for aide:457-a-spec, aide:458-another; the service restarts");
  });

  test("a short id and a create job's key stay text (AC-2)", () => {
    setPendingRestartNotice(["ab12cd34", "aide:new-1a2b3c4d"]);
    const notice = noticeOf(render());
    expect(notice).not.toContain("<a ");
    expect(text(notice)).toContain("ab12cd34, aide:new-1a2b3c4d");
  });

  test("a scheduled job stays text, with no link to a spec page (AC-4)", () => {
    setPendingRestartNotice(["aide:schedule-nightly"]);
    const notice = noticeOf(render());
    expect(notice).not.toContain("<a ");
    expect(text(notice)).toContain("aide:schedule-nightly");
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
    expect(text(noticeOf(render()))).toContain("aide:459-a-spec");
    setPendingRestart(newer, []);
    expect(render()).not.toContain("restart-notice");
  });
});
