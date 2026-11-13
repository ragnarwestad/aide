import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { rememberPage, rememberedPage } from "../../../src/specs-client/page-swap/remember";

afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function install(html = "<header>Board</header><main>Current</main>") {
  GlobalRegistrator.register({ url: "http://board.test/specs?sort=recent#row" });
  document.body.innerHTML = html;
}

test("keeps the latest serialized page under its address without the fragment (AC-4)", () => {
  install();
  document.querySelector("main")!.textContent = "Redrawn";
  rememberPage(location.href, document);
  expect(rememberedPage("http://board.test/specs?sort=recent#another")?.querySelector("main")?.textContent).toBe("Redrawn");
});

test("does not keep a page with a reader-entered form (AC-10)", () => {
  install();
  rememberPage(location.href, document);
  document.body.insertAdjacentHTML("beforeend", '<form class="settingsform"><input value="server"></form>');
  rememberPage(location.href, document);
  expect(rememberedPage(location.href)).toBeNull();
});

test("keeps markup rather than typed, ticked or selected form values (AC-10)", () => {
  install('<header>Board</header><main><input value="server"><input type="checkbox"><select><option selected>One</option><option>Two</option></select></main>');
  const [text, checkbox] = document.querySelectorAll("input") as NodeListOf<HTMLInputElement>;
  text.value = "typed";
  checkbox.checked = true;
  (document.querySelector("select") as HTMLSelectElement).selectedIndex = 1;
  rememberPage(location.href, document);
  const copy = rememberedPage(location.href)!;
  expect((copy.querySelector('input:not([type="checkbox"])') as HTMLInputElement).value).toBe("server");
  expect((copy.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
  expect(copy.querySelectorAll("option")[0]?.hasAttribute("selected")).toBe(true);
  expect(copy.querySelectorAll("option")[1]?.hasAttribute("selected")).toBe(false);
});

test("keeps copies in module memory without browser storage (AC-11)", () => {
  install();
  let writes = 0;
  Object.defineProperty(Storage.prototype, "setItem", { configurable: true, value: () => { writes += 1; } });
  rememberPage(location.href, document);
  expect(rememberedPage(location.href)?.querySelector("main")?.textContent).toBe("Current");
  expect(writes).toBe(0);
});

test("keeps open and waiting markup exactly as the reader left it (AC-4)", () => {
  install('<header><details open><summary>Menu</summary></details></header><main><a class="awaiting">Jobs</a></main><dialog open>Question</dialog>');
  rememberPage(location.href, document);
  const copy = rememberedPage(location.href)!;
  expect(copy.querySelector("details")?.hasAttribute("open")).toBe(true);
  expect(copy.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  expect(copy.querySelector("a")?.classList.contains("awaiting")).toBe(true);
});
