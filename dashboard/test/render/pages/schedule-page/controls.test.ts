// A schedule entry's controls on a project's Schedule tab: the Enabled
// box, Run now and Delete — and nothing that leads to an edit page.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { scheduleControlCells } from "../../../../src/render/pages/schedule-page/controls.ts";

const ENTRY = { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true };

function cells(lang: "en" | "nb" | "es" | "de" | "fr" = "en"): HTMLElement {
  const window = new Window();
  window.document.body.innerHTML = `<table><tbody><tr>${scheduleControlCells("aide", ENTRY, lang)}</tr></tbody></table>`;
  return window.document.body as unknown as HTMLElement;
}

describe("scheduleControlCells()", () => {
  test("draws the Enabled box, Run now and Delete, and no link to an edit page", () => {
    const body = cells();
    const base = "/api/queue/schedule/aide/nightly";
    expect(body.querySelector("input.scheduleenabled")?.getAttribute("data-post-to")).toBe(`${base}/enabled`);
    expect(body.querySelector("form.schedulerun")?.getAttribute("action")).toBe(`${base}/run`);
    const ask = body.querySelector("button[data-ask]")!.getAttribute("data-ask")!;
    expect(body.querySelector(`dialog[id="${ask}"] form[action="${base}/delete"]`) !== null).toBe(true);
    const hrefs = [...body.querySelectorAll("a")].map((a) => a.getAttribute("href")!);
    expect(hrefs.filter((h) => h.endsWith("/edit"))).toEqual([]);
  });

  test("exposes the entry identity and translated button states (AC-5)", () => {
    const forms = [cells("en"), cells("nb"), cells("es"), cells("de"), cells("fr")]
      .map((body) => body.querySelector("form.schedulerun") as HTMLFormElement);
    expect(forms.map((form) => form.dataset.project)).toEqual(Array(5).fill("aide"));
    expect(forms.map((form) => form.dataset.entry)).toEqual(Array(5).fill("nightly"));
    expect(forms.map((form) => form.dataset.queued)).toEqual(["Queued", "I kø", "En cola", "In Warteschlange", "En attente"]);
    expect(forms.map((form) => form.dataset.running)).toEqual(["Running", "Kjører", "Ejecutando", "Läuft", "En cours"]);
  });
});
