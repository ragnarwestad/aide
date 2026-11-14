import { expect, test } from "bun:test";
import { join } from "node:path";
import { Window } from "happy-dom";

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../../../src/render/scripts/theme-script.ts")], target: "browser", format: "iife" });
if (!built.success) throw new AggregateError(built.logs, "theme-script.ts failed to bundle");
const SOURCE = await built.outputs[0]!.text();

test("the Appearance radio makes the same colour-scheme choice as the header (AC-2)", () => {
  const window = new Window();
  window.document.body.innerHTML = `<button data-theme-choice="dark"></button><input type="radio" value="dark" data-theme-choice="dark">`;
  new Function("document", "window", "localStorage", SOURCE)(window.document, window, window.localStorage);
  (window.document.querySelector('input') as unknown as HTMLInputElement).click();
  expect(window.document.documentElement.dataset.theme).toBe("dark");
  expect((window.document.querySelector('input') as unknown as HTMLInputElement).checked).toBe(true);
  expect(window.document.querySelector('button')?.getAttribute("aria-current")).toBe("true");
});
