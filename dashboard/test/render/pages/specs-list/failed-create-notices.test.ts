// A create that ended without a spec is a message at the top of the Specs
// list, one per failed create (spec 506).
import { describe, expect, test } from "bun:test";
import { renderSpecsRows } from "../../../../src/render/pages/specs-list";
import { renderFailedCreateNotices } from "../../../../src/render/pages/specs-list/failed-create-notices.ts";
import type { FailedCreate } from "../../../../src/push/failed-creates.ts";

const rec = (id: string, over: Partial<FailedCreate> = {}): FailedCreate => ({
  id, project: "aide", title: "Layout of the new dashboard", description: "text",
  reason: "the session could not start", failedAt: "2026-09-19T17:05:00.000Z", ...over,
});

describe("the message for a failed create", () => {
  test("names the project, the title and the reason (AC-2)", () => {
    const html = renderFailedCreateNotices([rec("j1")], "en");
    expect(html).toContain("Creating “Layout of the new dashboard” in aide failed: the session could not start");
  });

  test("the reason is in the reader's language (AC-2)", () => {
    const r = rec("j1", { reason: { key: "runner.serverRestarted", values: { button: "Create" } } });
    expect(renderFailedCreateNotices([r], "en")).toContain("the server restarted while this step was running");
    expect(renderFailedCreateNotices([r], "nb")).toContain("serveren startet på nytt mens dette steget kjørte");
    expect(renderFailedCreateNotices([r], "nb")).toContain("Prøv igjen");
  });

  test("a job with no reason still names project and title, with the generic sentence (AC-2)", () => {
    const html = renderFailedCreateNotices([rec("j1", { reason: { key: "runner.createEndedNoReason" } })], "en");
    expect(html).toContain("in aide failed: creating the spec ended without a reason on record");
  });

  test("typed text is escaped and appears as typed (AC-2)", () => {
    const html = renderFailedCreateNotices([rec("j1", { title: `<script>x</script> "q" $&`, reason: "a <b>" })], "en");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt; &quot;q&quot; $&amp;");
    expect(html).toContain("a &lt;b&gt;");
  });

  test("offers Try again to the form and Dismiss as a form of its own (AC-3, AC-5)", () => {
    const html = renderFailedCreateNotices([rec("j1")], "en");
    expect(html).toContain(`href="/new?retry=j1"`);
    expect(html).toContain(`<form class="actionform" method="post" action="/api/queue/failed-creates/j1/dismiss">`);
    expect(html).toContain("Dismiss");
  });

  test("one message per record, in the order given, each with its own Dismiss (AC-5)", () => {
    const html = renderFailedCreateNotices([rec("b", { title: "Second" }), rec("a", { title: "First" })], "en");
    expect(html.match(/failed-creates\/[ab]\/dismiss/g)).toEqual(["failed-creates/b/dismiss", "failed-creates/a/dismiss"]);
    expect(html.indexOf("Second")).toBeLessThan(html.indexOf("First"));
  });

  test("none when there are none (AC-7)", () => {
    expect(renderFailedCreateNotices([], "en")).toBe("");
  });
});

describe("in the list", () => {
  const base = { runnerAvailable: true, targets: [] };
  test("the messages come first, before the filter bar and the table (AC-2)", () => {
    const html = renderSpecsRows([], { ...base, failedCreates: [rec("j1")] });
    expect(html.startsWith(`<div class="failedcreate rowmsg failed">`)).toBe(true);
    expect(html.indexOf("failed:")).toBeLessThan(html.indexOf("<table"));
    expect(html.indexOf("failed:")).toBeLessThan(html.indexOf("specsearch"));
  });

  test("no block at all without a failed create (AC-7)", () => {
    const html = renderSpecsRows([], base);
    expect(html).not.toContain("failedcreate");
    expect(html).not.toContain("/new?retry=");
  });
});
