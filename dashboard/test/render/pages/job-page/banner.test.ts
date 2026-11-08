// The message under a job's state on its page: the Problem line and, when
// the message has a fix, the Solution line under it.

import { describe, expect, test } from "bun:test";
import { renderJobFollowParts } from "../../../../src/render/pages/job-page";
import { writtenMessage } from "../../../../src/format/error-sentence.ts";
import { row } from "../fixtures.ts";

const banner = (error: unknown): string =>
  renderJobFollowParts(
    { ...row({ steps: ["implement"], state: "failed", error: error as never }), results: [] } as never,
    { now: 0, lang: "en" },
  );

describe("the job page's banner", () => {
  test("shows a message with a fix as a Problem line and a Solution line (AC-7)", () => {
    const html = banner(writtenMessage("the push failed", "push it by hand"));
    expect(html).toContain("Problem: The push failed\nSolution: Push it by hand");
  });

  test("omits an event owned by the landing step while retaining a distinct event (AC-2)", () => {
    const event = { key: "landing.testsRedOnMerge", values: { count: 1, branch: "aide/81-x", button: "Archive" }, lists: { tests: ["one"] } } as const;
    const same = renderJobFollowParts(
      { ...row({ steps: ["archive"], state: "failed", error: event as never, landingError: { key: "landing.stepStopped", values: { step: "archive" }, inner: event } as never }), results: [] } as never,
      { now: 0, lang: "en" },
    );
    expect(same).not.toContain("1 of the project's tests");
    expect(banner({ key: "runner.notAnalyzed" })).toContain("not analyzed yet");
  });

  test("shows a message without a fix as the Problem line alone (AC-7)", () => {
    const html = banner(writtenMessage("this spec is archived"));
    expect(html).toContain("Problem: This spec is archived");
    expect(html).not.toContain("Solution:");
  });

  test("shows named implement failures behind the banner's detail control (AC-3)", () => {
    const html = banner({
      key: "runner.testsRedFailing",
      values: { n: "2", total: "10", tests: ["first failure", "second failure"], button: "Implement" },
    });
    expect(html).toContain("2 of 10 tests fail");
    expect(html).toContain("first failure\nsecond failure");
    expect(html).toContain('summary title="more detail"');
  });
});
