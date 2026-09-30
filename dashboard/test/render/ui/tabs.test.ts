// The one tab strip: a caller that builds each tab's whole address and takes
// its words from the catalogue draws through the same `tabBar()` as a caller
// that hands it a base path.
import { describe, expect, test } from "bun:test";
import { tabBar } from "../../../src/render/ui/tabs.ts";

describe("tabBar() with a link function and a label function", () => {
  const TABS = ["log", "files", "errors"] as const;
  const html = tabBar(
    TABS,
    (tab) => (tab === "errors" ? undefined : `/jobs/j1?tab=steps&step=0&steptab=${tab}`),
    "files",
    {},
    "",
    { label: (tab) => `<${tab}>` },
  );

  test("links each tab to the function's address, escaped once, and shows the label function's word (AC-2)", () => {
    expect(html).toContain('href="/jobs/j1?tab=steps&amp;step=0&amp;steptab=log"');
    expect(html).toContain('href="/jobs/j1?tab=steps&amp;step=0&amp;steptab=files"');
    expect(html).not.toContain("&amp;amp;");
    expect(html).toContain("&lt;log&gt;");
  });

  test("draws a tab the function gives no address as text with no link (AC-2)", () => {
    expect(html).toContain("&lt;errors&gt;");
    expect(html.match(/href=/g)?.length).toBe(2);
  });
});
