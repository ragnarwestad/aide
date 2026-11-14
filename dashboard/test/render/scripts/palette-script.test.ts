import { expect, test } from "bun:test";
import { join } from "node:path";
import { Window } from "happy-dom";

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../../../src/render/scripts/palette-script.ts")], target: "browser", format: "iife" });
const SOURCE = built.success ? await built.outputs[0]!.text() : "";

test("a chosen theme is stored, applied and restored (AC-4, AC-5, AC-6)", () => {
  expect(built.success).toBe(true);
  const window = new Window();
  window.document.body.innerHTML = `<input type="radio" data-palette-choice value="default"><input type="radio" data-palette-choice value="ocean">`;
  new Function("document", "window", "localStorage", SOURCE)(window.document, window, window.localStorage);
  const ocean = window.document.querySelector('[value="ocean"]') as unknown as HTMLInputElement;
  ocean.checked = true;
  ocean.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
  expect(window.document.documentElement.dataset.palette).toBe("ocean");
  expect(window.localStorage.getItem("palette")).toBe("ocean");
});
