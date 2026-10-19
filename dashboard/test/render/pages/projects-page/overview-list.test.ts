// The Delete on a project's row of the Projects list: which rows carry it and
// which dialog each one opens. Where it sits on the row is not tested.
import { describe, expect, test } from "bun:test";
import { Window, type Element as DomElement } from "happy-dom";
import { projectListBody } from "../../../../src/render/pages/projects-page/overview-list.ts";
import type { ProjectView } from "../../../../src/render";
import { askButton } from "../../../../src/render/ui/components";

const ok = (name: string): ProjectView => ({ name, manifest: { ok: true, data: { name } }, specs: [] });
const broken = (name: string): ProjectView => ({ name, manifest: { ok: false, error: "bad yaml" }, specs: [] });

const draw = (projects: ProjectView[], removable: (name: string) => boolean): DomElement[] => {
  const window = new Window();
  window.document.body.innerHTML = projectListBody(projects, {
    pageHref: (name) => `/projects/${name}`,
    removable,
    lang: "en",
  });
  return [...window.document.querySelectorAll(".proj-row")];
};

describe("a project's row on the Projects list offers Delete", () => {
  test("the button is the danger ask button labelled Delete, named for the project (AC-6)", () => {
    const [row] = draw([ok("aide")], () => true);
    const buttons = row!.querySelectorAll("button[data-ask]");
    expect(buttons.length).toBe(1);
    const button = buttons[0]!;
    expect(button.outerHTML).toBe(
      askButton({ label: "Delete", dialogId: button.getAttribute("data-ask")!, variant: "danger", ariaLabel: "Delete aide" }),
    );
    expect(button.getAttribute("aria-label")).toBe("Delete aide");
  });

  test("a row whose manifest fails to parse carries it too (AC-1)", () => {
    const [row] = draw([broken("aide")], () => true);
    expect(row!.classList.contains("error")).toBe(true);
    expect(row!.querySelectorAll("button[data-ask]").length).toBe(1);
  });

  test("a project that may not be removed gets none (AC-1)", () => {
    const rows = draw([ok("aide"), ok("other")], (name) => name === "aide");
    expect(rows[0]!.querySelectorAll("button[data-ask]").length).toBe(1);
    expect(rows[1]!.querySelectorAll("button[data-ask]").length).toBe(0);
    expect(rows[1]!.querySelectorAll("form").length).toBe(0);
  });

  test("each row opens its own dialog, which posts to its own project's remove route (AC-1)", () => {
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
