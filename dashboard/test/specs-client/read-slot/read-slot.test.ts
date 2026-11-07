// A provider's readings (usage, models, installation) are filled into the
// places the page drew for them, once the page is up.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { fillReadings } from "../../../src/specs-client/read-slot/index.ts";

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

const FAILED = "The reading did not come back — open the tab again.";

function pageWith(address: string): { root: HTMLElement; slot: HTMLElement } {
  const win = new Window();
  windows.push(win);
  win.document.body.innerHTML =
    `<div id="slot" data-read-from="${address}" data-read-failed="${FAILED}" aria-busy="true"><p class="muted">Reading the models…</p></div>`;
  const root = win.document.body as unknown as HTMLElement;
  return { root, slot: root.querySelector("#slot") as HTMLElement };
}

const answering = (status: number, body = ""): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;
const throwing: typeof fetch = (async () => { throw new Error("connection refused"); }) as unknown as typeof fetch;

describe("fillReadings", () => {
  test("an answer is written into the place, which then asks for nothing more and is no longer busy (AC-8)", async () => {
    const { root, slot } = pageWith("/settings/providers/models?key=Claude");
    const asked: string[] = [];
    await fillReadings(root, (async (url: string) => { asked.push(url); return new Response("<p>Opus 5.5</p>"); }) as unknown as typeof fetch);
    expect(asked).toEqual(["/settings/providers/models?key=Claude"]);
    expect(slot.innerHTML).toBe("<p>Opus 5.5</p>");
    expect(slot.hasAttribute("data-read-from")).toBe(false);
    expect(slot.hasAttribute("aria-busy")).toBe(false);
  });

  test("an answer that is not 2xx puts the place's own failure sentence in its line (AC-9)", async () => {
    const { root, slot } = pageWith("/settings/providers/models?key=Claude");
    await fillReadings(root, answering(500, "boom"));
    expect(slot.textContent).toBe(FAILED);
    expect(slot.hasAttribute("aria-busy")).toBe(false);
    expect(slot.hasAttribute("data-read-from")).toBe(false);
  });

  test("a fetch that throws puts the place's own failure sentence in its line (AC-9)", async () => {
    const { root, slot } = pageWith("/settings/providers/installation?key=Claude");
    await fillReadings(root, throwing);
    expect(slot.textContent).toBe(FAILED);
    expect(slot.hasAttribute("aria-busy")).toBe(false);
  });
});
