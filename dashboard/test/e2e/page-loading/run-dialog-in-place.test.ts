// The Specs list's Run dialog, run alone or as a group, closes when the
// Run goes through and leaves the reader on the Specs tab, with no page load.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { runPeerLists, specRunDialog } from "../../../src/render/pages/specs-list/phase-rows.ts";
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

test("Run from the Specs list's Run dialog closes it and stays on the Specs tab without loading the page (AC-1)", async () => {
  const page = await browser.newPage();
  try {
    let navigations = 0;
    page.on("request", (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations++;
    });
    const targets = [{ project: "aide", specFolder: "81-first" }];
    const rendered = specRunDialog(groupBySpec([], targets)[0]!, { targets, runnerAvailable: true });
    await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(Specs)");
    await page.evaluate((html) => document.getElementById("jobrows")!.insertAdjacentHTML("beforeend", html), rendered.control + rendered.dialog);
    await page.evaluate(() => (window as unknown as { keptHeader: Element | null }).keptHeader = document.querySelector("header"));
    await page.route((url) => url.pathname === "/api/queue", (route) => route.fulfill({ json: { ok: true } }));
    await page.locator('button[data-ask="runask-aide/81-first"]').click();
    const dialog = page.getByRole("dialog", { name: "Run spec aide:81", exact: true });
    const posted = page.waitForRequest((req) => req.url().endsWith("/api/queue") && req.method() === "POST");
    await dialog.getByRole("button", { name: "Run", exact: true }).click();
    await posted;
    await page.locator("dialog.formdialog[open]").waitFor({ state: "detached" });
    expect(new URL(page.url()).pathname).toBe("/specs");
    expect(navigations).toBe(1);
    expect(await page.evaluate(() => document.querySelector("header") === (window as unknown as { keptHeader: Element }).keptHeader)).toBe(true);
  } finally { await page.close(); }
});

test("Run asks for a group name when a peer is selected, submits the entered name and stays on the Specs tab (AC-3)", async () => {
  const page = await browser.newPage();
  try {
    const targets = ["81-first", "82-next"].map((specFolder) => ({ project: "aide", specFolder }));
    const rendered = specRunDialog(groupBySpec([], targets)[0]!, { targets, runnerAvailable: true });
    const peers = runPeerLists(["aide"], { targets, runnerAvailable: true });
    await page.goto(`${base}/specs?live=0`);
    // This dialog's own project list stands in for the one the page drew.
    await page.evaluate((html) => {
      for (const list of document.querySelectorAll("template[data-run-peers-of]")) list.remove();
      document.getElementById("jobrows")!.insertAdjacentHTML("beforeend", html);
    }, rendered.control + rendered.dialog + peers);
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
    await page.locator("dialog.formdialog[open]").waitFor({ state: "detached" });
    expect(new URL(page.url()).pathname).toBe("/specs");
  } finally { await page.close(); }
});
