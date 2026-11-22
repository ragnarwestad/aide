// The project page's head: the breadcrumb back to the Projects list and the
// picker that opens another project's page on the same tab.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { projectPageHead } from "../../../../src/render/pages/projects-page/page-head.ts";
import { orderProjects } from "../../../../src/render/pages/projects-page/overview-list.ts";

type Listed = { name: string; icon: { src: string } | null };

function head(o: { name?: string; icon?: { src: string } | null; tab?: string; projects?: Listed[] } = {}) {
  const window = new Window();
  window.document.body.innerHTML = projectPageHead({
    name: o.name ?? "aide",
    icon: o.icon ?? null,
    tab: o.tab ?? "config",
    projects: o.projects ?? [],
    lang: "en",
  });
  return window.document;
}

const pickerLinks = (doc: ReturnType<typeof head>) =>
  [...doc.querySelectorAll("details.projectpicker .menupanel a")].map((a) => a.getAttribute("href"));

describe("projectPageHead()", () => {
  test("is a breadcrumb: Projects links to the list, the project's name is the heading and no link (AC-1)", () => {
    const doc = head();
    const crumb = doc.querySelector("nav.breadcrumb")!;
    const link = crumb.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/projects");
    expect(link.textContent).toBe("Projects");
    const h1 = crumb.querySelector("h1")!;
    expect(h1.textContent).toBe("aide");
    expect(h1.querySelector("a")).toBeNull();
    expect(crumb.querySelectorAll("a").length).toBe(1);
    expect(doc.querySelector("a.backlink")).toBeNull();
  });

  test("the picker's trigger shows the current project's icon and name (AC-2)", () => {
    const doc = head({ icon: { src: "/projects/aide/icon" } });
    const summary = doc.querySelector("details.projectpicker > summary")!;
    expect(summary.querySelector("img.projicon")?.getAttribute("src")).toBe("/projects/aide/icon");
    expect(summary.textContent).toContain("aide");
  });

  test("each project's link opens its page on the tab open now (AC-3)", () => {
    const projects = [{ name: "aide", icon: null }, { name: "paceup", icon: null }, { name: "skjera", icon: null }];
    expect(pickerLinks(head({ tab: "config", projects }))).toEqual([
      "/projects/aide?tab=config", "/projects/paceup?tab=config", "/projects/skjera?tab=config",
    ]);
    expect(pickerLinks(head({ tab: "schedule", projects }))).toEqual([
      "/projects/aide?tab=schedule", "/projects/paceup?tab=schedule", "/projects/skjera?tab=schedule",
    ]);
  });

  test("lists the projects in the Projects list's order, the current one marked (AC-4)", () => {
    const projects = [{ name: "zeta", icon: null }, { name: "aide", icon: null }, { name: "mid", icon: null }];
    const doc = head({ name: "aide", projects });
    expect(pickerLinks(doc)).toEqual(orderProjects(projects).map((p) => `/projects/${p.name}?tab=config`));
    expect(doc.querySelector('.menupanel a[aria-current="true"]')?.getAttribute("href")).toBe("/projects/aide?tab=config");
  });

  test("a current project left out of the list is not added back, and the trigger still names it (AC-3)", () => {
    const doc = head({ name: "aide", projects: [{ name: "zeta", icon: null }] });
    expect(pickerLinks(doc)).toEqual(["/projects/zeta?tab=config"]);
    expect(doc.querySelector('.menupanel a[aria-current="true"]')).toBeNull();
    expect(doc.querySelector("details.projectpicker > summary")!.textContent).toContain("aide");
    expect(doc.querySelector("nav.breadcrumb h1")!.textContent).toBe("aide");
  });
});
