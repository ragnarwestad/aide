// The Projects list's rows: what each one carries, in what order, and which
// rows offer Remove. Where anything sits on the row is not tested.
import { describe, expect, test } from "bun:test";
import { Window, type Element as DomElement } from "happy-dom";
import { projectListBody } from "../../../../src/render/pages/projects-page/overview-list.ts";
import type { ProjectView } from "../../../../src/render";
import { askButton } from "../../../../src/render/ui/components";
import { initialsHue, projectIcon, projectInitials } from "../../../../src/render/ui/components/card/project-icon.ts";

const ok = (name: string): ProjectView => ({ name, manifest: { ok: true, data: { name } }, specs: [] });
const broken = (name: string): ProjectView => ({ name, manifest: { ok: false, error: "bad yaml" }, specs: [] });

const draw = (projects: ProjectView[], removable: (name: string) => boolean): DomElement[] => {
  const window = new Window();
  window.document.body.innerHTML = projectListBody(projects, {
    pageHref: (name) => `/projects/${name}`,
    removable,
    lang: "en",
  });
  return [...window.document.querySelectorAll("[data-project]")];
};

describe("a project's row on the Projects list offers Remove", () => {
  test("the button is the danger ask button labelled Remove, named for the project", () => {
    const [row] = draw([ok("aide")], () => true);
    const buttons = row!.querySelectorAll("button[data-ask]");
    expect(buttons.length).toBe(1);
    const button = buttons[0]!;
    expect(button.outerHTML).toBe(
      askButton({ label: "Remove", dialogId: button.getAttribute("data-ask")!, variant: "danger", ariaLabel: "Remove aide" }),
    );
    expect(button.getAttribute("aria-label")).toBe("Remove aide");
  });

  test("a row whose manifest fails to parse carries it too ", () => {
    const [row] = draw([broken("aide")], () => true);
    expect(row!.classList.contains("error")).toBe(true);
    expect(row!.querySelectorAll("button[data-ask]").length).toBe(1);
  });

  test("a project that may not be removed gets none ", () => {
    const rows = draw([ok("aide"), ok("other")], (name) => name === "aide");
    expect(rows[0]!.querySelectorAll("button[data-ask]").length).toBe(1);
    expect(rows[1]!.querySelectorAll("button[data-ask]").length).toBe(0);
    expect(rows[1]!.querySelectorAll("form").length).toBe(0);
  });

  test("each row opens its own dialog, which posts to its own project's remove route ", () => {
    const rows = draw([ok("aide"), ok("other")], () => true);
    const ids = rows.map((r) => r.querySelector("button[data-ask]")!.getAttribute("data-ask")!);
    expect(new Set(ids).size).toBe(2);
    rows.forEach((r, i) => {
      const name = i === 0 ? "aide" : "other";
      const form = r.querySelector(`dialog[id="${ids[i]}"] form[action]`)!;
      expect(form.getAttribute("action")).toBe(`/api/queue/projects/${name}/remove`);
    });
  });
});

describe("the Projects list's rows", () => {
  const described = (name: string, description: string, archived: number): ProjectView => ({
    name,
    manifest: { ok: true, data: { name, description } },
    specs: [
      { archived: false } as ProjectView["specs"][number],
      ...Array.from({ length: archived }, () => ({ archived: true }) as ProjectView["specs"][number]),
    ],
  });

  test("every project is a row, by name, with its icon, page link, counts and description (AC-1)", () => {
    const window = new Window();
    window.document.body.innerHTML = projectListBody(
      [described("b", "Bee", 0), described("a", "Ay", 2), described("c", "See", 1)],
      { pageHref: (name) => `/projects/${name}`, icon: (name) => (name === "a" ? { src: "/projects/a/icon" } : null) },
    );
    const rows = [...window.document.querySelectorAll("[data-project]")];
    expect(rows.map((r) => r.getAttribute("data-project"))).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.querySelector("a[href]")!.getAttribute("href"))).toEqual(["/projects/a", "/projects/b", "/projects/c"]);
    expect(rows[0]!.textContent).toContain("1 active · 2 archived");
    expect(rows[0]!.textContent).toContain("Ay");
    expect(rows[2]!.textContent).toContain("See");
    expect(rows[0]!.querySelector("img")!.getAttribute("src")).toBe("/projects/a/icon");
    expect(rows[1]!.querySelector("img")).toBeNull();
    expect(rows[1]!.textContent).toContain("B");
  });
});

describe("a project's icon", () => {
  test("is an image of its source, which runs nothing on the board (AC-17)", () => {
    const window = new Window();
    window.document.body.innerHTML = projectIcon("aide", { src: "/projects/aide/icon" });
    const img = window.document.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/projects/aide/icon");
    expect(window.document.querySelectorAll("svg, script, object, iframe, embed").length).toBe(0);
  });

  test("without a source, is the name's first two letters, coloured the same on every call (AC-15)", () => {
    expect(projectInitials("aide")).toBe("AI");
    expect(projectInitials("north-star")).toBe("NO");
    expect(projectInitials("x")).toBe("X");
    expect(projectInitials("-9lives")).toBe("9L");
    expect(initialsHue("aide")).toBe(initialsHue("aide"));
    const hues = new Set(["aide", "paceup", "skjera", "woodstack", "atlasaurus", "north-star"].map(initialsHue));
    expect(hues.size).toBeGreaterThan(1);
    for (const hue of hues) expect(hue >= 1 && hue <= 6).toBe(true);
    const window = new Window();
    window.document.body.innerHTML = projectIcon("aide", null);
    expect(window.document.querySelector("img")).toBeNull();
    expect(window.document.body.textContent).toBe("AI");
    expect(window.document.body.firstElementChild!.getAttribute("data-hue")).toBe(String(initialsHue("aide")));
  });
});
