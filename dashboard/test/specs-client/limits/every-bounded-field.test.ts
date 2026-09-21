import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { closeAskDialog } from "../../../src/render/pages/spec-page/close-ask.ts";
import { renderAddProjectPage, renderCloseSpecPage, renderNewSpecPage, renderProjectPage } from "../../../src/render";
import type { ProjectView } from "../../../src/render";
import { checkControls } from "../../../src/render/ui/check-controls.ts";
import { renderScheduleForm } from "../../../src/render/pages/schedule-page/form.ts";
import { bindLimits } from "../../../src/specs-client/limits/index.ts";

const NAV = [{ label: "Projects", path: "/projects" }];
const NOW = "2026-09-20T00:00:00Z";

const row = (key: string, value: string) => ({ key, purpose: "", value, origin: "configured" as const, source: "project.yaml" });
const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };

const PAGES: Record<string, () => string> = {
  "New spec": () => renderNewSpecPage(NAV, NOW, { createProjects: ["aide"], targets: [] }),
  Close: () => renderCloseSpecPage("aide", "81-x", NAV, NOW, {}),
  "Close, in the spec page's dialog": () => `<body>${closeAskDialog("aide", "81-x", "en")}</body>`,
  "Add project": () => renderAddProjectPage(NAV, NOW, { createProjects: ["aide"] }),
  "project settings": () =>
    renderProjectPage(
      project,
      {
        hasConfigFile: true,
        rows: [
          row("AIDE_SPECS_PATH", "specs"),
          row("AIDE_WORKTREE_LINKS", "node_modules"),
          row("AIDE_INSTALL_CMD", "bun install"),
          row("AIDE_TEST_CMD", "bun test"),
        ] as never,
      },
      null,
      NOW,
      NAV,
      { worktreeLinkCandidates: [], editing: true },
    ),
  "Failed note": () =>
    `<body>${checkControls({ line: "| AC-1: x | Not verified | |", done: true, notVerified: true }, "en", { archivedIndex: 0 })}</body>`,
  Schedule: () => `<body>${renderScheduleForm({ action: "/x", fixedProject: "aide" })}</body>`,
};

let win: Window | undefined;
afterEach(async () => {
  await win?.happyDOM.close();
  win = undefined;
});

describe("every bounded text field the dashboard draws", () => {
  for (const [name, render] of Object.entries(PAGES)) {
    test(`${name}: each has a count naming its own bound (AC-6)`, () => {
      win = new Window();
      win.document.write(render());
      const doc = win.document as unknown as Document;
      bindLimits(doc);
      const fields = [...doc.querySelectorAll('input[type="text"], textarea')].filter(
        (f) => f.hasAttribute("maxlength") || f.hasAttribute("data-maxlength"),
      );
      expect(fields.length).toBeGreaterThan(0);
      for (const f of fields) {
        const bound = f.getAttribute("maxlength") ?? f.getAttribute("data-maxlength");
        const c = f.nextElementSibling as HTMLElement | null;
        expect(c?.hasAttribute("data-limit")).toBe(true);
        expect(c?.textContent).toContain(`of ${bound} characters`);
      }
    });
  }

  test("the bounds among them are 64, 120, 300, 500 and 5000 (AC-6)", () => {
    const seen = new Set<string>();
    for (const render of Object.values(PAGES)) {
      win = new Window();
      win.document.write(render());
      const doc = win.document as unknown as Document;
      bindLimits(doc);
      for (const c of doc.querySelectorAll("[data-limit]")) seen.add(/of (\d+) characters/.exec(c.textContent ?? "")![1]!);
    }
    for (const b of ["64", "120", "300", "500", "5000"]) expect(seen.has(b)).toBe(true);
  });
});
