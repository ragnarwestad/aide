// A schedule entry's Settings tab: what the entry is set to, its Enabled
// box, Run now and Delete, and the same fields as New when Edit is pressed.
import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderScheduleDetailPage, renderScheduleNewPage, scheduleSettingsPath } from "../../../../src/render";
import type { ScheduleDetailPageOptions } from "../../../../src/render";
import { clearCheckoutFaults } from "../../../../src/render/ui/checkout-faults.ts";

beforeEach(() => clearCheckoutFaults());

const NAV = [{ label: "Projects", path: "/projects" }];
const MODELS = [{ name: "sonnet" }, { name: "codex-fast", tool: "codex" as const }];
const ENTRY = {
  name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", model: "codex-fast", notify: "always" as const,
  enabled: true,
};
const BASE = "/api/queue/schedule/aide/nightly-report";

function page(o: Partial<ScheduleDetailPageOptions> = {}): Document {
  const html = renderScheduleDetailPage(NAV, "2026-09-30T00:00:00Z", {
    project: "aide", entry: ENTRY, tab: "settings", history: [], modelChoices: MODELS,
    defaultModels: { default: "sonnet" }, deleteDone: "/projects/aide?tab=schedule", ...o,
  });
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
}

/** The Settings table, label to the value's text. */
function shown(doc: Document): Record<string, string> {
  return Object.fromEntries(
    [...doc.querySelectorAll("table.facts tr")].map((tr) => [tr.children[0]!.textContent, tr.children[1]!.textContent]),
  );
}

/** The names of the fields a user fills in, on the page's schedule form. */
function fieldNames(doc: Document): string[] {
  return [...doc.querySelectorAll("form.scheduleform input, form.scheduleform select")]
    .filter((el) => el.getAttribute("type") !== "hidden" && el.getAttribute("name"))
    .map((el) => el.getAttribute("name")!)
    .sort();
}

describe("the entry's page", () => {
  test("offers the tabs Report, History and Settings (AC-3)", () => {
    for (const tab of ["report", "history", "settings"]) {
      const words = [...page({ tab }).querySelectorAll("nav.subtabs a")].map((a) => a.textContent);
      expect(words).toEqual(["Report", "History", "Settings"]);
    }
  });
});

describe("the Settings tab", () => {
  test("shows every field, the Enabled box, Run now, Delete and Edit (AC-4)", () => {
    const doc = page();
    expect(shown(doc)).toMatchObject({
      Name: "nightly-report", Cron: "0 3 * * *", "Prompt file": "docs/nightly.md", Model: "codex-fast", Notify: "Every run",
    });
    const enabled = [...doc.querySelectorAll("table.facts tr")].find((tr) => tr.children[0]!.textContent === "Enabled")!;
    expect(enabled.querySelector("input.scheduleenabled")?.getAttribute("data-post-to")).toBe(`${BASE}/enabled`);
    expect(doc.querySelector("form.schedulerun")?.getAttribute("action")).toBe(`${BASE}/run`);
    const ask = doc.querySelector("button[data-ask]")!.getAttribute("data-ask")!;
    const ok = doc.querySelector(`dialog[id="${ask}"] form[action="${BASE}/delete"]`);
    expect(ok?.getAttribute("data-done")).toBe("/projects/aide?tab=schedule");
    const edit = [...doc.querySelectorAll("a")].find((a) => a.textContent === "Edit");
    expect(edit?.getAttribute("href")).toBe(scheduleSettingsPath("aide", "nightly-report", true));
    expect(doc.querySelector("form.scheduleform") === null).toBe(true);
  });

  test("an entry naming no model shows what the queue gives the schedule step, or the dash (AC-4)", () => {
    const own = { ...ENTRY, model: undefined };
    const configured = { default: "opus", schedule: "sonnet" };
    expect(shown(page({ entry: own, defaultModels: configured })).Model).toBe("sonnet");
    expect(shown(page({ entry: own, defaultModels: configured, modelChoices: [] })).Model).toBe("sonnet");
    expect(shown(page({ entry: ENTRY, modelChoices: [] })).Model).toBe("codex-fast");
    expect(shown(page({ entry: own, defaultModels: {}, modelChoices: [] })).Model).toBe("–");
  });

  test("Edit draws the entry's form, saving to the entry and coming back here, with Cancel back to the tab (AC-5)", () => {
    const doc = page({ editing: true });
    const form = doc.querySelector("form.scheduleform")!;
    expect(form.getAttribute("action")).toBe(BASE);
    expect((form.querySelector('input[name="name"]') as HTMLInputElement).value).toBe("nightly-report");
    expect((form.querySelector('input[name="cron"]') as HTMLInputElement).value).toBe("0 3 * * *");
    expect((form.querySelector('input[name="back"]') as HTMLInputElement).value).toBe(scheduleSettingsPath("aide", "nightly-report"));
    const cancel = [...form.querySelectorAll("a")].find((a) => a.textContent === "Cancel")!;
    expect(cancel.getAttribute("href")).toBe(scheduleSettingsPath("aide", "nightly-report"));
    expect(cancel.hasAttribute("data-discard-changes")).toBe(true);
  });
});

describe("New", () => {
  test("has the same fields a user fills in as the Settings tab's Edit (AC-7)", () => {
    const html = renderScheduleNewPage(NAV, "2026-09-30T00:00:00Z", {
      project: "aide", values: { name: "", cron: "0 7 * * *", prompt: "" }, backHref: "/projects/aide?tab=schedule",
      modelChoices: MODELS, defaultModels: { default: "sonnet" },
    });
    const window = new Window();
    window.document.body.innerHTML = html;
    const names = fieldNames(window.document as unknown as Document);
    expect(names).toEqual(["cron", "model", "name", "notify", "prompt"]);
    expect(fieldNames(page({ editing: true }))).toEqual(names);
  });
});
