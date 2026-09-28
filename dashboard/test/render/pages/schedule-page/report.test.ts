// Spec 495, criteria 1, 3, 11, 13 and 15 as rendering: the panel that shows a
// run's report on the entry's page.
import { describe, expect, test } from "bun:test";
import { renderReportPanel, type QueueRowView } from "../../../../src/render";

const view = (state: QueueRowView["state"], extra: Partial<QueueRowView> = {}): QueueRowView =>
  ({ state, timeoutSec: 1200, ...extra }) as QueueRowView;

const HREF = "/schedule-output/aide/schedule-nightly/runs/j1/index.html";

describe("renderReportPanel", () => {
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
});
