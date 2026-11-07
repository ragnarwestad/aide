import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { bindPageSwap, swapPage } from "../../../src/specs-client/page-swap";

afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function install() {
  GlobalRegistrator.register({ url: "http://board.test/specs" });
  document.body.innerHTML = `<header>Board</header><nav class="tabbar">Specs</nav><main>Old</main><dialog class="about"></dialog><dialog id="leaveapp"></dialog>`;
  const events: string[] = [];
  document.addEventListener("aide-page-fetching", () => events.push("fetching"));
  document.addEventListener("aide-page-drawn", () => events.push("drawn"));
  globalThis.fetch = (async () => new Response(`<html><head><title>Settings</title></head><body><header>Board</header><nav class="tabbar">Settings</nav><main>New</main></body></html>`, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  return events;
}

test("fetches and places a board page with its address and lifecycle events (AC-1, AC-3, AC-9)", async () => {
  const events = install();
  expect(await swapPage("/settings", { history: "push" })).toBe(true);
  expect(location.pathname).toBe("/settings");
  expect(document.title).toBe("Settings");
  expect(document.querySelector("main")?.textContent).toBe("New");
  expect(events).toEqual(["fetching", "drawn"]);
});

test("keeps the requested fragment when the fetch answer omits it (AC-3)", async () => {
  install();
  const response = new Response(`<html><head><title>Solution</title></head><body><header>Board</header><nav class="tabbar">Specs</nav><main><strong id="approach-b">Approach B</strong></main></body></html>`, { headers: { "content-type": "text/html" } });
  Object.defineProperty(response, "url", { value: "http://board.test/specs/aide/81-x?tab=solution" });
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  await swapPage("/specs/aide/81-x?tab=solution#approach-b", { history: "push" });
  expect(location.hash).toBe("#approach-b");
});

test("asks the dirty-form guard before fetching (AC-7)", async () => {
  install();
  let fetched = false;
  globalThis.fetch = (async () => { fetched = true; return new Response(); }) as unknown as typeof fetch;
  document.addEventListener("aide-page-leave", (event) => event.preventDefault(), { once: true });
  expect(await swapPage("/settings", { history: "push" })).toBe(false);
  expect(fetched).toBe(false);
});

test("keeps scroll only for an action on the same page (AC-8)", async () => {
  install();
  const calls: [number, number][] = [];
  Object.defineProperty(globalThis, "scrollY", { value: 80, configurable: true });
  globalThis.scrollTo = ((x: number, y: number) => { calls.push([x, y]); }) as unknown as typeof scrollTo;
  await swapPage("/specs", { history: "replace", keepScroll: true });
  expect(calls.at(-1)?.[1]).toBe(80);
});

test("restores the shown address when a dirty form stays after Back or Forward (AC-3, AC-7)", async () => {
  install();
  bindPageSwap(document);
  document.addEventListener("aide-page-leave", (event) => {
    event.preventDefault();
    (event as CustomEvent<{ stay(): void }>).detail.stay();
  });
  history.replaceState(null, "", "/settings");
  globalThis.dispatchEvent(new PopStateEvent("popstate"));
  await Promise.resolve();
  await Promise.resolve();
  expect(location.pathname).toBe("/specs");
});

/** The board page `/settings` answers with, drawn by the server process `servedBy`. */
function answerServedBy(servedBy: string) {
  globalThis.fetch = (async () => new Response(`<html><head><title>Settings</title><meta name="aide-served-by" content="${servedBy}"></head><body><header>Board</header><nav class="tabbar">Settings</nav><main>New</main></body></html>`, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
}

test("loads the whole page when a newer server drew it, so its script is the new one too", async () => {
  install();
  document.head.insertAdjacentHTML("beforeend", `<meta name="aide-served-by" content="2026-11-07T10:00:00.000Z">`);
  answerServedBy("2026-11-07T12:13:06.000Z");
  const assigned: string[] = [];
  Object.defineProperty(window.location, "assign", { value: (url: string) => assigned.push(url), configurable: true });
  expect(await swapPage("/settings", { history: "push" })).toBe(false);
  expect(assigned).toEqual(["/settings"]);
  expect(document.querySelector("main")?.textContent).toBe("Old");
});

test("draws the page in place when the same server drew both", async () => {
  install();
  document.head.insertAdjacentHTML("beforeend", `<meta name="aide-served-by" content="2026-11-07T12:13:06.000Z">`);
  answerServedBy("2026-11-07T12:13:06.000Z");
  expect(await swapPage("/settings", { history: "push" })).toBe(true);
  expect(document.querySelector("main")?.textContent).toBe("New");
});
