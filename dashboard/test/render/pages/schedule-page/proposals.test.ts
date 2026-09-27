// The "Proposed specs" list under a run's report: what was created, what was
// skipped and why, in the reader's language.
import { describe, expect, test } from "bun:test";
import { renderProposalsPanel, scheduleRunPath, schedulePagePath } from "../../../../src/render";
import type { ProposalsRecord } from "../../../../src/queue/spec-proposals.ts";

const RECORD: ProposalsRecord = {
  at: "2026-09-26T18:00:09Z",
  proposals: [
    { title: "Made one", result: "created", jobId: "b1" },
    { title: "Closed before", result: "skipped", why: { code: "exists", folder: "412-closed-before", kind: "closed" } },
    { title: "Old", result: "skipped", why: { code: "exists", folder: "12-old", kind: "archived" } },
    { title: "Live", result: "skipped", why: { code: "exists", folder: "13-live", kind: "active" } },
    { title: "Waiting", result: "skipped", why: { code: "queued", jobId: "j9" } },
    { title: "", result: "skipped", why: { code: "invalid", what: "title-missing" } },
    { title: "Long title", result: "skipped", why: { code: "invalid", what: "title-long", max: 120 } },
    { title: "Long text", result: "skipped", why: { code: "invalid", what: "description-long", max: 4700 } },
    { title: "Odd", result: "skipped", why: { code: "invalid", what: "not-an-object" } },
    { title: "Lines", result: "skipped", why: { code: "invalid", what: "title-lines" } },
    { title: "Bare", result: "skipped", why: { code: "invalid", what: "description-missing" } },
    { title: "Refused", result: "skipped", why: { code: "refused" } },
  ],
};

const html = (record: ProposalsRecord | null, lang: "en" | "nb" = "en") =>
  renderProposalsPanel({ lang, project: "aide", record });

describe("renderProposalsPanel", () => {
  test("no record draws nothing (AC-4)", () => {
    expect(html(null)).toBe("");
  });

  test("a created proposal links to its job, and a skipped one that exists links to that spec with its state (AC-3)", () => {
    const out = html(RECORD);
    expect(out).toContain('id="proposals"');
    expect(out).toContain('href="/jobs/b1"');
    expect(out).toContain('href="/specs/aide/412-closed-before"');
    expect(out).toContain('href="/specs/aide/12-old"');
    expect(out).toContain('href="/specs/aide/13-live"');
    expect(out).toContain('href="/jobs/j9"');
  });

  test("every reason draws words, with no placeholder left over (AC-3)", () => {
    const out = html(RECORD);
    expect(out).not.toMatch(/\{\w+\}/);
    expect(out.match(/<li>/g)).toHaveLength(RECORD.proposals.length);
    expect(out).toContain("120");
    expect(out).toContain("4700");
  });

  test("a title that contains markup is escaped (AC-3)", () => {
    const out = html({
      at: "t",
      proposals: [{ title: '<script>alert("x")</script>', result: "created", jobId: "b1" }],
    });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  test("adds no class and no title attribute of its own (AC-3)", () => {
    const out = html(RECORD);
    expect(out).not.toContain("title=");
    const classes = [...out.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));
    for (const c of classes) expect(["reportpanel", "muted"].includes(c) || c.startsWith("b-") || c === "badge").toBe(true);
  });

  test("a problem draws a sentence with what resolves it, above what was decided before it (AC-3)", () => {
    const out = html({ at: "t", problem: "unreadable", detail: "Unexpected token", proposals: [] });
    expect(out).toContain("Unexpected token");
    expect(out).toMatch(/[Ff]ix|[Rr]un the job again|[Ww]rite/);
    const failed = html({ at: "t", problem: "failed", detail: "disk full", proposals: [RECORD.proposals[0]!] });
    expect(failed.indexOf("disk full")).toBeLessThan(failed.indexOf("/jobs/b1"));
    expect(html({ at: "t", problem: "no-specs-root", proposals: [] })).toContain("<p");
  });

  test("the words follow the reader's language (AC-3)", () => {
    expect(html(RECORD, "nb")).not.toBe(html(RECORD, "en"));
    expect(html(RECORD, "nb")).not.toMatch(/\{\w+\}/);
  });
});

describe("scheduleRunPath", () => {
  test("is the entry's page with the run and the report anchor (AC-5)", () => {
    expect(scheduleRunPath("aide", "nyhetssjekk", "run 1")).toBe(`${schedulePagePath("aide", "nyhetssjekk")}?run=run%201#report`);
    expect(scheduleRunPath("aide", "nyhetssjekk", "run-1")).toBe("/schedule/aide/nyhetssjekk?run=run-1#report");
  });
});
