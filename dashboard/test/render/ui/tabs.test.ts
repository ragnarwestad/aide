// The one tab strip: a caller that builds each tab's whole address and takes
// its words from the catalogue draws through the same `tabBar()` as a caller
// that hands it a base path.
import { describe, expect, test } from "bun:test";
import { tabBar, tabBarHelp } from "../../../src/render/ui/tabs.ts";
import { esc } from "../../../src/render/ui/html.ts";
import { KIND_ICONS, type RowKind } from "../../../src/render/ui/components/icons.ts";
import { t } from "../../../src/i18n";

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

  test("links each tab to the function's address, escaped once, and shows the label function's word", () => {
    expect(html).toContain('href="/jobs/j1?tab=steps&amp;step=0&amp;steptab=log"');
    expect(html).toContain('href="/jobs/j1?tab=steps&amp;step=0&amp;steptab=files"');
    expect(html).not.toContain("&amp;amp;");
    expect(html).toContain("&lt;log&gt;");
  });

  test("draws a tab the function gives no address as text with no link", () => {
    expect(html).toContain("&lt;errors&gt;");
    expect(html.match(/href=/g)?.length).toBe(2);
  });
});

describe("tabBarHelp(), the site tab bar's \"?\"", () => {
  const TABS = [
    { word: "Jobs", kind: "jobs" },
    { word: "Specs", kind: "specs" },
    { word: "Projects", kind: "projects" },
    { word: "Schedule", kind: "schedule" },
  ] as const;
  // The list runs from its marker to the counts sentence that follows it.
  const list = (html: string): string =>
    html.split("<span data-tab-list>")[1]?.split(esc(t("en", "shell.tabHelpCounts")))[0] ?? "";

  test("lists every kind of job under Jobs, each with the icon its rows have", () => {
    const tabList = list(tabBarHelp("en", [...TABS]));
    const jobs = tabList.split('data-tab="specs"')[0] ?? "";
    for (const kind of Object.keys(KIND_ICONS) as RowKind[]) {
      expect(jobs).toContain(`data-kind="${kind}"`);
      expect(jobs).toContain(esc(t("en", `shell.tabHelpJobKind.${kind}`)));
    }
  });

  test("is in the page's language (AC-6)", () => {
    const html = tabBarHelp("nb", [...TABS]);
    expect(html).toContain(`aria-label="${esc(t("nb", "shell.tabHelpTitle"))}"`);
    expect(html).toContain(esc(t("nb", "shell.tabHelpCounts")));
    expect(html).toContain(esc(t("nb", "shell.tabHelp.schedule")));
    expect(t("nb", "shell.tabHelpCounts")).not.toBe(t("en", "shell.tabHelpCounts"));
  });
});
