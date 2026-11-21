// The one tab strip: a caller that builds each tab's whole address and takes
// its words from the catalogue draws through the same `tabBar()` as a caller
// that hands it a base path.
import { describe, expect, test } from "bun:test";
import { tabBar, tabBarHelp } from "../../../src/render/ui/tabs.ts";
import { esc } from "../../../src/render/ui/html.ts";
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

describe("tabBar() with icons", () => {
  const html = tabBar(["jobs", "specs"] as const, (tab) => `/${tab}`, "specs", {}, "", {
    label: (tab) => (tab === "jobs" ? "Jobs" : "Specs"),
    icon: (tab) => `<i data-icon="${tab}"></i>`,
  });

  test("keeps each icon, word and address inside one link (AC-5)", () => {
    expect(html).toContain('<a class="tab" data-nav data-goto href="/jobs" title="Jobs"><i data-icon="jobs"></i><span>Jobs</span></a>');
    expect(html).toContain('<a class="tab" data-nav data-goto href="/specs" title="Specs" aria-current="page"><i data-icon="specs"></i><span>Specs</span></a>');
  });

  test("leaves a strip with no icons unchanged (AC-5)", () => {
    const plain = tabBar(["jobs"] as const, "/", "jobs", {});
    expect(plain).toContain('>Jobs</a>');
    expect(plain).not.toContain("title=");
    expect(plain).not.toContain("<span>Jobs</span>");
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

  test("lists each tab's icon, word and one-line description (AC-3)", () => {
    const html = tabBarHelp("en", [...TABS]);
    const tabList = list(html);
    for (const tab of TABS) {
      expect(tabList).toContain(`data-tab="${tab.kind}"`);
      expect(tabList).toContain(tab.word);
      expect(tabList).toContain(esc(t("en", `shell.tabHelp.${tab.kind}`)));
    }
  });

  test("a section with no icon of its own is listed by its word alone", () => {
    const html = tabBarHelp("en", [{ word: "Other" }]);
    expect(list(html)).toContain("Other");
    expect(list(html)).not.toContain("data-tab=");
  });

  test("says what the Jobs and Specs numbers count, each on its own line after the tab list (AC-5)", () => {
    const html = tabBarHelp("en", [...TABS]);
    const counts = html.split(esc(t("en", "shell.tabHelpCounts")))[1] ?? "";
    expect(list(html)).not.toContain(esc(t("en", "shell.tabHelpCount.jobs")));
    expect(counts).toContain(`<br>• Jobs: ${esc(t("en", "shell.tabHelpCount.jobs"))}`);
    expect(counts).toContain(`<br>• Specs: ${esc(t("en", "shell.tabHelpCount.specs"))}`);
    for (const state of ["Created", "Idle", "Reopened"]) expect(t("en", "shell.tabHelpCount.specs")).toContain(state);
  });

  test("is in the page's language (AC-6)", () => {
    const html = tabBarHelp("nb", [...TABS]);
    expect(html).toContain(`aria-label="${esc(t("nb", "shell.tabHelpTitle"))}"`);
    expect(html).toContain(esc(t("nb", "shell.tabHelpCounts")));
    expect(html).toContain(esc(t("nb", "shell.tabHelp.schedule")));
    expect(t("nb", "shell.tabHelpCounts")).not.toBe(t("en", "shell.tabHelpCounts"));
  });
});
