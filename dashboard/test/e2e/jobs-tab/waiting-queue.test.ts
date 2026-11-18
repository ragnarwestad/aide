import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
browserDeadline();
const harness = queueHarness("waiting-browser-");
let browser: Browser;
let page: Page;
let base: string;
const job = (id: string, folder: string) => ({ id, project: "aide", specFolder: folder, steps: ["analyze"], stepIndex: 0, state: "queued", createdAt: "2026-11-17T10:00:00Z", timeoutSec: {}, permissionMode: {}, model: {}, results: [] });
beforeAll(async () => { browser = await withBrowser(chromium.launch(), "chromium.launch()"); });
beforeEach(async () => {
  page = await browser.newPage();
  ({ base } = harness.start({ alsoSpecs: ["82-next", "83-added"], queueMirror: JSON.stringify([job("a", "81-queue-and-runner"), job("b", "82-next")]) }));
  await page.goto(`${base}/?live=0`);
});
afterEach(async () => { await page.close(); harness.cleanup(); });
afterAll(async () => { await browser.close(); });
const dialog = () => page.getByRole("dialog", { name: "Waiting queue", exact: true });
async function open() {
  await page.getByRole("button", { name: "Queued 1/2", exact: true }).first().click();
  await dialog().waitFor({ state: "visible" });
}
async function savedOrder(): Promise<string[]> {
  const response = await page.request.post(`${base}/api/queue/waiting/open`, { data: { requestId: crypto.randomUUID() } });
  const owner = await response.json();
  expect(response.status()).toBe(200);
  await page.request.post(`${base}/api/queue/waiting/cancel`, { data: owner });
  return owner.entries.map((entry: { jobId: string }) => entry.jobId);
}

test("a badge focuses its entry; keyboard moves save priority and Escape cancels (AC-3)", async () => {
  await open();
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.waitingId)).toBe("job:a:0");
  const move = dialog().getByRole("button", { name: "Move down", exact: true }).first();
  await move.focus(); await page.keyboard.press("Enter");
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await dialog().waitFor({ state: "detached" });
  expect(await savedOrder()).toEqual(["b", "a"]);
  await open();
  await dialog().getByRole("button", { name: "Move down", exact: true }).first().click();
  const cancelled = page.waitForResponse(response => response.url().endsWith("/waiting/cancel"));
  await page.keyboard.press("Escape");
  await cancelled;
  await dialog().waitFor({ state: "detached" });
  expect(await savedOrder()).toEqual(["b", "a"]);
});
test("pointer dragging saves through the same API", async () => {
  await open();
  const handles = dialog().getByRole("button", { name: "Drag to move", exact: true });
  const a = await handles.first().boundingBox();
  const b = await handles.last().boundingBox();
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height - 2, { steps: 8 });
  await page.mouse.up();
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await dialog().waitFor({ state: "detached" });
  expect(await savedOrder()).toEqual(["b", "a"]);
});
test("another tab cannot acquire the editor and Cancel preserves priority", async () => {
  await open();
  const response = await page.request.post(`${base}/api/queue/waiting/open`, { data: { requestId: "other-tab" } });
  expect(response.status()).toBe(409);
  await dialog().getByRole("button", { name: "Move down", exact: true }).first().click();
  const cancelled = page.waitForResponse(response => response.url().endsWith("/waiting/cancel"));
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  await cancelled;
  await dialog().waitFor({ state: "detached" });
  expect(await savedOrder()).toEqual(["a", "b"]);
});

test("touch dragging changes priority on a phone", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  const handles = dialog().getByRole("button", { name: "Drag to move", exact: true });
  const a = await handles.first().boundingBox(); const b = await handles.last().boundingBox();
  const session = await page.context().newCDPSession(page);
  const x = a!.x + a!.width / 2; const y = a!.y + a!.height / 2;
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (b!.y + b!.height - 2 - y) * i / 8 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await dialog().waitFor({ state: "detached" });
  expect(await savedOrder()).toEqual(["b", "a"]);
});
test("live arrivals preserve a reordered draft and ownership loss disables Save (AC-7)", async () => {
  await open();
  await dialog().getByRole("button", { name: "Move down", exact: true }).first().click();
  const added = await page.request.post(`${base}/api/queue`, { data: { project: "aide", specFolder: "83-added", steps: ["analyze"] } });
  expect(added.status()).toBe(200);
  await dialog().getByRole("listitem").nth(2).waitFor();
  const saving = page.waitForRequest(request => request.url().endsWith("/waiting/save"));
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  const request = await saving;
  expect(request.postDataJSON().ids.slice(0, 2)).toEqual(["job:b:0", "job:a:0"]);
  await dialog().waitFor({ state: "detached" });
  await page.reload();
  await page.getByRole("button", { name: /Queued 1\/3/ }).first().click();
  await dialog().waitFor();
  await page.route("**/api/queue/waiting/snapshot", route => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "ownership lost" }) }));
  await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('#waiting-editor-form-save')?.disabled === true);
  expect(await dialog().getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
});

test("the Specs page opens the same global queue", async () => {
  await page.goto(`${base}/specs?live=0`);
  await open();
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.waitingId)).toBe("job:a:0");
});
