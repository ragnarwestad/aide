// A dialog's form that names a page to go to when it goes through — the
// Specs list's Run dialog — changes the page in place: the header stays,
// and the browser loads nothing.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { specRunDialog } from "../../../src/render/pages/specs-list/phase-rows.ts";
import { groupBySpec } from "../../../src/render/pages/specs-list/data-model";

browserDeadline();

const harness = queueHarness("aide-e2e-run-dialog-in-place-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start().base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("a dialog form that goes through changes to its page without loading the app again", async () => {
  const page = await browser.newPage();
  let navigations = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations++;
  });
  await page.route(
    (url) => url.pathname === "/api/queue",
    (route) => route.fulfill({ json: { ok: true } }),
  );
  await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(Specs)");
  await page.locator("#jobrows").waitFor({ state: "attached" });
  await page.evaluate(() => (window as unknown as { keptHeader: Element | null }).keptHeader = document.querySelector("header"));
  // The Run dialog as the list draws it; this board has no checkout, so it offers no Run of its own.
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.className = "formdialog";
    const form = document.createElement("form");
    form.className = "actionform";
    form.method = "post";
    form.action = "/api/queue";
    form.dataset.goto = "/";
    dialog.appendChild(form);
    document.getElementById("jobrows")!.appendChild(dialog);
    dialog.showModal();
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
  await page.waitForURL((url) => url.pathname === "/");
  await page.locator("main").waitFor({ state: "attached" });
  expect(navigations).toBe(1);
  expect(await page.evaluate(() => document.querySelector("header") === (window as unknown as { keptHeader: Element }).keptHeader)).toBe(true);
  expect(await page.locator("dialog.formdialog[open]").count()).toBe(0);
  await page.close();
});

test("Run asks for a group name when a peer is selected and submits the entered name", async () => {
  const page = await browser.newPage();
  try {
    const targets = ["81-first", "82-next"].map((specFolder) => ({ project: "aide", specFolder }));
    const rendered = specRunDialog(groupBySpec([], targets)[0]!, { targets, runnerAvailable: true });
    await page.goto(`${base}/specs?live=0`);
    await page.evaluate((html) => document.getElementById("jobrows")!.insertAdjacentHTML("beforeend", html), rendered.control + rendered.dialog);
    await page.locator('button[data-ask="runask-aide/81-first"]').click();
    const dialog = page.getByRole("dialog", { name: "Run spec aide:81", exact: true });
    const name = dialog.getByRole("textbox", { name: "Group name", exact: true });
    expect(await name.isVisible()).toBe(false);
    await dialog.getByRole("checkbox", { name: "82-next", exact: true }).check();
    await name.waitFor({ state: "visible" });
    expect(await name.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
    await name.fill("Shared utilities");
    const posted = page.waitForRequest((req) => req.url().endsWith("/api/queue") && req.method() === "POST");
    await page.route((url) => url.pathname === "/api/queue", (route) => route.fulfill({ json: { ok: true } }));
    await dialog.getByRole("button", { name: "Run", exact: true }).click();
    const request = await posted;
    expect(new URLSearchParams(request.postData()!).get("groupName")).toBe("Shared utilities");
    await page.waitForURL((url) => url.pathname === "/");
  } finally { await page.close(); }
});
