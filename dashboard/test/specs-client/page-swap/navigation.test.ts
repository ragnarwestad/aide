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

function heldAnswer(html = `<html><head><title>Fresh</title></head><body><header>Board</header><nav class="tabbar">Fresh</nav><main>Fresh</main></body></html>`) {
  let answer!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>((resolve) => { answer = resolve; })) as unknown as typeof fetch;
  return async () => {
    await Promise.resolve();
    answer(new Response(html, { headers: { "content-type": "text/html" } }));
  };
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

test("binds a stand-in page that has no History state methods", () => {
  install();
  Object.defineProperty(history, "pushState", { value: undefined, configurable: true });
  Object.defineProperty(history, "replaceState", { value: undefined, configurable: true });
  expect(() => bindPageSwap(document)).not.toThrow();
});

test("shows a remembered link before its fresh answer and then replaces it (AC-1, AC-2, AC-6)", async () => {
  const events = install();
  bindPageSwap(document);
  const first = heldAnswer(`<html><head><title>Jobs</title></head><body><header>Board</header><nav class="tabbar">Jobs</nav><main>Remember me</main></body></html>`);
  const toJobs = swapPage("/jobs", { history: "push" });
  first();
  await toJobs;
  const second = heldAnswer();
  const toSettings = swapPage("/settings", { history: "push" });
  second();
  await toSettings;
  const freshJobs = heldAnswer(`<html><head><title>Jobs</title></head><body><header>Board</header><nav class="tabbar">Jobs</nav><main>Fresh jobs</main></body></html>`);
  const returning = swapPage("/jobs", { history: "push", remembered: true });
  await turn();
  expect(document.querySelector("main")?.textContent).toBe("Remember me");
  expect(events.slice(-2)).toEqual(["drawn", "fetching"]);
  freshJobs();
  await returning;
  expect(document.querySelector("main")?.textContent).toBe("Fresh jobs");
  expect(events.at(-1)).toBe("drawn");
});

test("mounts the copy without background work and the answer with it (AC-7)", async () => {
  install();
  const mounted: { referrer: string; background: boolean }[] = [];
  let unmounts = 0;
  bindPageSwap(document, { unmount: () => { unmounts += 1; }, mount: (options) => mounted.push(options) });
  const jobs = heldAnswer(`<html><head><title>Jobs</title></head><body><header>Board</header><main>Jobs</main></body></html>`);
  const there = swapPage("/jobs", { history: "push" }); await jobs(); await there;
  const settings = heldAnswer();
  const away = swapPage("/settings", { history: "push" }); await settings(); await away;
  const fresh = heldAnswer();
  const back = swapPage("/jobs", { history: "push", remembered: true });
  await turn();
  expect(mounted.at(-1)).toEqual({ referrer: "http://board.test/settings", background: false });
  await fresh(); await back;
  expect(mounted.at(-1)).toEqual({ referrer: "http://board.test/settings", background: true });
  expect(unmounts).toBe(4);
});

test("does not show a copy for an address not remembered or for an action swap (AC-1, AC-3)", async () => {
  install();
  const answer = heldAnswer();
  const swap = swapPage("/settings", { history: "push" });
  await turn();
  expect(document.querySelector("main")?.textContent).toBe("Old");
  answer();
  await swap;
  expect(document.querySelector("main")?.textContent).toBe("Fresh");
});

test("binds a remembered copy before the answer so its controls can post (AC-7)", async () => {
  install();
  let mounts = 0;
  bindPageSwap(document, { mount: () => { mounts += 1; } });
  const jobs = heldAnswer(`<html><head><title>Jobs</title></head><body><header>Board</header><main>Jobs</main></body></html>`);
  const there = swapPage("/jobs", { history: "push" }); jobs(); await there;
  const settings = heldAnswer();
  const away = swapPage("/settings", { history: "push" }); settings(); await away;
  const fresh = heldAnswer();
  const back = swapPage("/jobs", { history: "push", remembered: true });
  await turn();
  expect(mounts).toBe(3);
  fresh(); await back;
});

test("reloads the target when a remembered page gets a non-board answer (AC-8, AC-9)", async () => {
  install();
  bindPageSwap(document);
  const jobs = heldAnswer(`<html><head><title>Jobs</title></head><body><header>Board</header><main>Jobs</main></body></html>`);
  const there = swapPage("/jobs", { history: "push" }); jobs(); await there;
  const settings = heldAnswer();
  const away = swapPage("/settings", { history: "push" }); settings(); await away;
  const bad = heldAnswer("not a board page");
  let reloads = 0;
  Object.defineProperty(window.location, "reload", { value: () => { reloads += 1; }, configurable: true });
  const back = swapPage("/jobs", { history: "push", remembered: true });
  await turn(); bad(); await back;
  expect(reloads).toBe(1);
});

test("reloads a remembered page when a newer server drew the fresh answer (AC-8)", async () => {
  install();
  bindPageSwap(document);
  document.head.insertAdjacentHTML("beforeend", `<meta name="aide-served-by" content="old">`);
  const jobs = heldAnswer(`<html><head><title>Jobs</title><meta name="aide-served-by" content="old"></head><body><header>Board</header><main>Jobs copy</main></body></html>`);
  const there = swapPage("/jobs", { history: "push" }); await jobs(); await there;
  const settings = heldAnswer(`<html><head><title>Settings</title><meta name="aide-served-by" content="old"></head><body><header>Board</header><main>Settings</main></body></html>`);
  const away = swapPage("/settings", { history: "push" }); await settings(); await away;
  let reloads = 0;
  let assigns = 0;
  Object.defineProperty(window.location, "reload", { value: () => { reloads += 1; }, configurable: true });
  Object.defineProperty(window.location, "assign", { value: () => { assigns += 1; }, configurable: true });
  const newer = heldAnswer(`<html><head><title>Jobs</title><meta name="aide-served-by" content="new"></head><body><header>Board</header><main>New</main></body></html>`);
  const back = swapPage("/jobs", { history: "push", remembered: true });
  await turn(); await newer(); await back;
  expect(reloads).toBe(1);
  expect(assigns).toBe(0);
  expect(document.querySelector("main")?.textContent).toBe("Jobs copy");
});

test("aborts a remembered page refresh when another swap starts (AC-9)", async () => {
  install();
  bindPageSwap(document);
  const jobs = heldAnswer(`<html><head><title>Jobs</title></head><body><header>Board</header><main>Jobs</main></body></html>`);
  const there = swapPage("/jobs", { history: "push" }); await jobs(); await there;
  const settings = heldAnswer();
  const away = swapPage("/settings", { history: "push" }); await settings(); await away;
  let firstAborted = false;
  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { firstAborted = true; reject(new DOMException("Aborted", "AbortError")); });
  })) as typeof fetch;
  const first = swapPage("/jobs", { history: "push", remembered: true });
  await turn();
  const finalAnswer = heldAnswer(`<html><head><title>Projects</title></head><body><header>Board</header><main>Projects</main></body></html>`);
  const second = swapPage("/projects", { history: "push" });
  await finalAnswer();
  await Promise.all([first, second]);
  expect(firstAborted).toBe(true);
  expect(document.querySelector("main")?.textContent).toBe("Projects");
});

test("remembers the page under an address moved in place before leaving it (AC-4, AC-5)", async () => {
  install();
  bindPageSwap(document);
  history.pushState(null, "", "/specs?sort=oldest");
  document.querySelector("main")!.textContent = "Sorted in place";
  const settings = heldAnswer();
  const away = swapPage("/settings", { history: "push" }); settings(); await away;
  const fresh = heldAnswer();
  const back = swapPage("/specs?sort=oldest", { history: "push", remembered: true });
  await turn();
  expect(document.querySelector("main")?.textContent).toBe("Sorted in place");
  fresh(); await back;
});

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

test("restores the shown address when a dirty form stays after Back or Forward (AC-3, AC-5, AC-7)", async () => {
  install();
  bindPageSwap(document);
  document.addEventListener("aide-page-leave", (event) => {
    event.preventDefault();
    (event as CustomEvent<{ stay(): void }>).detail.stay();
  });
  history.pushState(null, "", "/settings");
  history.back();
  await turn();
  expect(location.pathname).toBe("/specs");
});

/** The board page `/settings` answers with, drawn by the server process `servedBy`. */
function answerServedBy(servedBy: string) {
  globalThis.fetch = (async () => new Response(`<html><head><title>Settings</title><meta name="aide-served-by" content="${servedBy}"></head><body><header>Board</header><nav class="tabbar">Settings</nav><main>New</main></body></html>`, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
}

test("loads the whole page when a newer server drew it, so its script is the new one too (AC-8)", async () => {
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
