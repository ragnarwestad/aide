// The message under a job's state on its page: the Problem line and, when
// the message has a fix, the Solution line under it.

import { describe, expect, test } from "bun:test";
import { renderJobFollowParts } from "../../../../src/render/pages/job-page";
import { writtenMessage } from "../../../../src/format/error-sentence.ts";
import { row } from "../fixtures.ts";

const banner = (error: unknown): string =>
  renderJobFollowParts(
    {
      ...row({ steps: ["implement"], state: "failed", error: error as never }),
      results: [],
    } as never,
    { now: 0, lang: "en" },
  );

describe("the job page's banner", () => {
  test("shows a message with a fix as a Problem line and a Solution line (AC-7)", () => {
    const html = banner(writtenMessage("the push failed", "push it by hand"));
    expect(html).toContain(
      "Problem: The push failed\nSolution: Push it by hand",
    );
  });

  test("shows a message without a fix as the Problem line alone (AC-7)", () => {
    const html = banner(writtenMessage("this spec is archived"));
    expect(html).toContain("Problem: This spec is archived");
    expect(html).not.toContain("Solution:");
  });
});
