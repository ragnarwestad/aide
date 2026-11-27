import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

test("mounts controls once and tears the replaced page down (AC-4, AC-10)", async () => {
  GlobalRegistrator.register({ url: "http://board.test/?live=0" });
  const { mountPage } = await import("../../../src/specs-client/page-mount");
  document.body.innerHTML = `<main><form class="reloadform"><button>Save</button></form></main>`;
  const form = document.querySelector("form")!;
  let submits = 0;
  form.addEventListener("submit", (event) => { event.preventDefault(); submits += 1; });
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
  GlobalRegistrator.register({ url: "http://board.test/settings?tab=notifications&live=0" });
  const requests: { url: string; method: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url === "/api/origin") return new Response(JSON.stringify({ ok: false }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const { mountPage } = await import("../../../src/specs-client/page-mount");
  document.body.innerHTML = `
    <form data-settings-form action="/api/settings"><button type="submit">Save</button></form>
    <section data-push-panel data-key="x" data-lang="en"><button id="push-toggle"></button><p data-push-status></p></section>
    <section data-origin-check="/api/origin"></section>
    <button type="button" role="switch" class="switch scheduleenabled" aria-checked="false" data-post-to="/api/schedule/enabled"></button>
  `;
  mountPage(document, { referrer: "" });
  const settings = document.querySelector("form[data-settings-form]") as HTMLFormElement;
  const submit = new Event("submit", { bubbles: true, cancelable: true });
  settings.dispatchEvent(submit);
  const enabled = document.querySelector("button.scheduleenabled") as HTMLButtonElement;
  enabled.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(submit.defaultPrevented).toBe(true);
  expect(requests.some((request) => request.url === "/api/schedule/enabled" && request.method === "POST")).toBe(true);
  expect(document.querySelector("[data-push-status]")?.textContent).not.toBe("");
  expect(requests.some((request) => request.url === "/api/origin" && request.method === "POST")).toBe(true);
  await GlobalRegistrator.unregister();
});

test("reconciles Schedule controls on mount and stops after unmount (AC-1, AC-2, AC-3)", async () => {
  GlobalRegistrator.register({ url: "http://board.test/projects/aide?tab=schedule&live=0" });
  let queueReads = 0;
  globalThis.fetch = (async () => {
    queueReads += 1;
    return new Response(JSON.stringify({ jobs: [{ project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], state: "queued" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const { mountPage } = await import("../../../src/specs-client/page-mount");
  document.body.innerHTML = `<form class="schedulerun" data-project="aide" data-entry="nightly" data-idle="Run now" data-queued="Queued" data-running="Running"><button>Run now</button></form>`;
  const unmount = mountPage(document, { referrer: "" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queueReads).toBe(1);
  expect((document.querySelector("button") as HTMLButtonElement).textContent).toBe("Queued");
  document.dispatchEvent(new Event("aide:queue-changed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queueReads).toBe(2);
  unmount();
  document.dispatchEvent(new Event("aide:queue-changed"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queueReads).toBe(2);
});

test("binds a remembered copy without starting automatic background work (AC-7)", async () => {
  GlobalRegistrator.register({ url: "http://board.test/projects/aide?tab=schedule" });
  let requests = 0;
  globalThis.fetch = (async () => { requests += 1; return new Response(JSON.stringify({ jobs: [] })); }) as unknown as typeof fetch;
  const { mountPage } = await import("../../../src/specs-client/page-mount");
  document.body.innerHTML = `
    <section data-origin-check="/api/origin"></section>
    <form class="schedulerun" data-project="aide" data-entry="nightly"><button>Run now</button></form>
    <main data-reload-every="1"><form class="actionform" action="/run"><button>Run</button></form></main>`;
  mountPage(document, { referrer: "", background: false });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(requests).toBe(0);
  const form = document.querySelector("form.actionform") as HTMLFormElement;
  let submitted = false;
  form.addEventListener("submit", (event) => { event.preventDefault(); submitted = true; });
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(submitted).toBe(true);
});

// A failed expectation must not leave the next test unable to register.
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

/** A page drawn in place: `<main>` set to `html` under a fresh document, every
 *  request recorded and answered, then mounted as a swap mounts it. */
async function mounted(html: string, url = "http://board.test/?live=0") {
  GlobalRegistrator.register({ url });
  const requests: { url: string; body: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ ok: true, testCmd: "make test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const { mountPage } = await import("../../../src/specs-client/page-mount");
  document.body.innerHTML = `<main>${html}</main>`;
  const unmount = mountPage(document, { referrer: "" });
  return { mountPage, requests, unmount };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("two mounts leave one count per field, and a typed character updates it (AC-2)", async () => {
  const { mountPage } = await mounted(`<input type="text" name="title" maxlength="10">`);
  const { bindLimits } = await import("../../../src/specs-client/limits");
  bindLimits(document);
  mountPage(document, { referrer: "" });
  const field = document.querySelector("input[name=title]") as HTMLInputElement;
  field.value = "a";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  expect(document.querySelectorAll("[data-limit]").length).toBe(1);
  expect(document.querySelector("[data-limit]")?.textContent).toBe("1 of 10 characters");
});

test("the Add project form drawn in place asks for the test command when its Git URL changes (AC-2)", async () => {
  const { requests } = await mounted(
    `<form class="addprojectform"><input name="gitUrl"><input name="testCmd" placeholder="drawn"></form>`,
  );
  const gitUrl = document.querySelector("input[name=gitUrl]") as HTMLInputElement;
  gitUrl.value = "https://example.com/p.git";
  gitUrl.dispatchEvent(new Event("change", { bubbles: true }));
  await settled();
  await settled();
  expect(requests.some((r) => r.url === "/api/queue/projects/test-command")).toBe(true);
  expect((document.querySelector("input[name=testCmd]") as HTMLInputElement).placeholder).toBe("make test");
});

const NEW_SPEC = `
  <form class="newspecform" id="new-spec-form">
      <select name="project"><option value="a" selected>a</option><option value="b">b</option></select>
      <label data-project="a"><input type="checkbox" name="dependsOn" value="1"></label>
      <label data-project="b"><input type="checkbox" name="dependsOn" value="2"></label>
      <select data-ai="model.analyze" form="new-spec-form">
        <option value="Claude" data-tool="claude" data-default="sonnet" selected>Claude</option>
        <option value="Codex" data-tool="codex" data-default="gpt">Codex</option>
      </select>
      <select name="model.analyze" form="new-spec-form">
        <option value="sonnet" data-tool="claude" selected>sonnet</option>
        <option value="gpt" data-tool="codex">gpt</option>
      </select>
  </form>`;

test("an AI select drawn in place narrows its model (AC-2)", async () => {
  await mounted(NEW_SPEC, "http://board.test/new?live=0");
  const ai = document.querySelector("select[data-ai]") as HTMLSelectElement;
  ai.value = "Codex";
  ai.dispatchEvent(new Event("change", { bubbles: true }));
  const model = document.querySelector('select[name="model.analyze"]') as HTMLSelectElement;
  expect(model.value).toBe("gpt");
});

test("the New spec form's project select drawn in place keeps Depends on in step (AC-2)", async () => {
  await mounted(NEW_SPEC, "http://board.test/new?live=0");
  const project = document.querySelector("select[name=project]") as HTMLSelectElement;
  project.value = "b";
  project.dispatchEvent(new Event("change", { bubbles: true }));
  expect((document.querySelector('[data-project="a"]') as HTMLElement).hidden).toBe(true);
  expect((document.querySelector('[data-project="b"]') as HTMLElement).hidden).toBe(false);
});

test("a model select drawn in place is narrowed to its own tool (AC-2)", async () => {
  await mounted(NEW_SPEC, "http://board.test/new?live=0");
  const gpt = document.querySelector('select[name="model.analyze"] option[value="gpt"]') as HTMLOptionElement;
  expect(gpt.hidden).toBe(true);
});

test("the Enabled switch saves on a click, and Enter on it is held back and saves nothing (AC-5)", async () => {
  const { requests } = await mounted(
    `<button type="button" role="switch" class="switch scheduleenabled" aria-checked="true" data-on="On" data-off="Off" data-post-to="/api/schedule/enabled"></button>`,
  );
  const sw = document.querySelector("button.scheduleenabled") as HTMLButtonElement;
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  sw.dispatchEvent(enter);
  await settled();
  expect(enter.defaultPrevented).toBe(true);
  expect(requests.filter((r) => r.url === "/api/schedule/enabled")).toEqual([]);
  sw.click();
  await settled();
  expect(requests.filter((r) => r.url === "/api/schedule/enabled").map((r) => JSON.parse(r.body))).toEqual([{ enabled: "0" }]);
  expect(sw.getAttribute("aria-checked")).toBe("false");
});
