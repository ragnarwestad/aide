import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

test("mounts controls once and tears the replaced page down (AC-4, AC-10)", async () => {
  GlobalRegistrator.register({ url: "http://board.test/?live=0" });
  const { mountPage } = await import("../../../src/specs-client/page-mount");
  document.body.innerHTML = `<main><form class="reloadform"><button>Save</button></form></main>`;
  const form = document.querySelector("form")!;
  let submits = 0;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submits += 1;
  });
  const unmount = mountPage(document, { referrer: "" });
  expect(document.documentElement.dataset.pageMounted).toBe("true");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(submits).toBe(1);
  unmount();
  expect(typeof unmount).toBe("function");
  expect(document.querySelector(".providerpanes")).toBeNull();
  await GlobalRegistrator.unregister();
});

test("mounts Settings, Notifications, Deploy and Schedule controls after a page change (AC-4)", async () => {
  GlobalRegistrator.register({
    url: "http://board.test/settings?tab=notifications&live=0",
  });
  const requests: { url: string; method: string }[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url === "/api/origin")
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const { mountPage } = await import("../../../src/specs-client/page-mount");
  document.body.innerHTML = `
    <form data-settings-form action="/api/settings"><button type="submit">Save</button></form>
    <section data-push-panel data-key="x" data-lang="en"><button id="push-toggle"></button><p data-push-status></p></section>
    <section data-origin-check="/api/origin"></section>
    <input class="scheduleenabled" data-post-to="/api/schedule/enabled" type="checkbox">
  `;
  mountPage(document, { referrer: "" });
  const settings = document.querySelector(
    "form[data-settings-form]",
  ) as HTMLFormElement;
  const submit = new Event("submit", { bubbles: true, cancelable: true });
  settings.dispatchEvent(submit);
  const enabled = document.querySelector(
    "input.scheduleenabled",
  ) as HTMLInputElement;
  enabled.checked = true;
  enabled.dispatchEvent(new Event("change", { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
  expect(submit.defaultPrevented).toBe(true);
  expect(
    requests.some(
      (request) =>
        request.url === "/api/schedule/enabled" && request.method === "POST",
    ),
  ).toBe(true);
  expect(document.querySelector("[data-push-status]")?.textContent).not.toBe(
    "",
  );
  expect(
    requests.some(
      (request) => request.url === "/api/origin" && request.method === "POST",
    ),
  ).toBe(true);
  await GlobalRegistrator.unregister();
});
