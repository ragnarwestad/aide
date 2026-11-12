import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Window } from "happy-dom";

const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "..", "..", "..", "src", "render", "scripts", "usage-dialog.ts")],
  target: "browser", format: "iife",
});
if (!built.success) throw new AggregateError(built.logs, "usage-dialog.ts failed to bundle");
const SOURCE = await built.outputs[0]!.text();

describe("usage dialog script", () => {
  test("opening the panel asks once and puts the answer in place of its content (AC-7)", async () => {
    const asks: string[] = [];
    const window = new Window();
    window.document.body.innerHTML =
      '<details id="usage-dialog" data-src="/usage"><summary>Usage</summary><div data-usage-content><p>as the page came</p></div></details>';
    const fetch = async (url: string) => {
      asks.push(url);
      const html = url === "/usage" ? '<div class="sharebar" data-usage-pending="Claude"></div><p>answer</p>' : "<p>another answer</p>";
      return { ok: true, text: async () => html };
    };
    new Function("document", "fetch", "location", SOURCE)(window.document, fetch, { reload() {} });
    const menu = window.document.querySelector("details")!;
    menu.open = true;
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(asks).toEqual(["/usage"]);
    expect(window.document.querySelector("[data-usage-content]")!.textContent).toBe("answer");
  });
});
