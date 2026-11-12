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
  test("asks for every pending provider before any answer is put in (AC-7)", async () => {
    const asks: string[] = [];
    const window = new Window();
    window.document.body.innerHTML = '<details id="usage-dialog" data-src="/usage"><summary>Usage</summary><div data-usage-content></div></details>';
    const fetch = async (url: string) => {
      asks.push(url);
      const html = url === "/usage" ? '<div data-usage-pending="Claude"></div><div data-usage-pending="Codex"></div>' : "<p>answer</p>";
      return { ok: true, text: async () => html };
    };
    new Function("document", "fetch", "location", SOURCE)(window.document, fetch, { reload() {} });
    const menu = window.document.querySelector("details")!;
    menu.open = true;
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(asks).toEqual(["/usage", "/usage?read=Claude", "/usage?read=Codex"]);
  });
});
