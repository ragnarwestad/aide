// Spec 495, criteria 1, 3, 11, 13 and 15 as rendering: the panel that shows a
// run's report on the entry's page.
import { describe, expect, test } from "bun:test";
import { renderReportPanel, type QueueRowView } from "../../../../src/render";

const view = (state: QueueRowView["state"], extra: Partial<QueueRowView> = {}): QueueRowView =>
  ({ state, timeoutSec: 1200, ...extra }) as QueueRowView;

const HREF = "/schedule-output/aide/schedule-nightly/runs/j1/index.html";

describe("renderReportPanel", () => {
  test("a run with a report: heading, start time, outcome chip, sandboxed frame and the bare link", () => {
    const html = renderReportPanel({
      lang: "en",
      run: { view: view("done"), startedAt: "2026-09-18T03:00:04Z", document: "<p>All green</p>", bareHref: HREF },
    });
    expect(html).toContain('id="report"');
    expect(html).toContain("2026-09-18T03:00:04Z");
    expect(html).toContain("b-done");
    expect(html).toMatch(/<iframe\b[^>]*data-report-frame/);
    expect(html).toContain("&lt;p&gt;All green&lt;/p&gt;");
    expect(html).toContain(`href="${HREF}"`);
  });

  test("the sandbox attribute is exactly the three tokens, and never allows scripts", () => {
    const html = renderReportPanel({
      lang: "en",
      run: { view: view("done"), startedAt: "t", document: "<p>x</p>", bareHref: HREF },
    });
    expect(html).toContain('sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
    expect(html).not.toContain("allow-scripts");
  });

  test("a document that tries to close the srcdoc attribute cannot", () => {
    const html = renderReportPanel({
      lang: "en",
      run: { view: view("done"), startedAt: "t", document: '"><script>alert(1)</script>', bareHref: HREF },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  for (const state of ["done", "failed", "cancelled", "interrupted", "running", "queued"] as const) {
    test(`a ${state} run that wrote no report says so, with the state, and has no frame`, () => {
      const html = renderReportPanel({ lang: "en", run: { view: view(state), startedAt: "t" } });
      expect(html).toContain("No report from this run");
      expect(html).toContain(`(${state})`);
      expect(html).not.toContain("<iframe");
    });
  }

  // The state, in the word the badge beside it uses: why the run stopped
  // is the run's own error sentence, not something written after the
  // state wherever the state is said.
  test("a stopped run says it stopped, and no more than that", () => {
    const html = renderReportPanel({
      lang: "en",
      run: { view: view("stopped", { stopReason: "timeout", timeoutSec: 1200 }), startedAt: "t" },
    });
    expect(html).toContain("No report from this run (stopped)");
    expect(html).not.toContain("20 min");
    expect(html).not.toContain("<iframe");
  });

  test("an entry that has never run says so, with no header and no frame", () => {
    const html = renderReportPanel({ lang: "en" });
    expect(html).toContain("This entry has not run yet.");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<h2");
  });

  test("the sentence follows the page's language", () => {
    expect(renderReportPanel({ lang: "nb" })).not.toContain("This entry has not run yet.");
  });
});
