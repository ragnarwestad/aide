// A confirmation opens from its button as a modal, and closes with Cancel
// and with Escape, navigating nowhere and posting nothing. Every dialog is
// drawn by one of two components, so one of each is asked: Cancel's plain
// confirmation and Close's progress dialog.

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const FOLDER = "81-queue-and-runner";
/** A spec with no job on it, so its page offers Close. */
const IDLE = "90-idle";
const harness = queueHarness("aide-e2e-confirm-boxes-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "aide-e2e-confirm-"));
  writeFileSync(
    join(scratch, "queue.json"),
    JSON.stringify([
      {
        id: "run1", project: "aide", specFolder: FOLDER, steps: ["analyze"], stepIndex: 0, state: "running",
        timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-09-18T03:00:00Z", startedAt: "2026-09-18T03:00:00Z",
      },
    ]),
  );
  base = harness.start({ alsoSpecs: [IDLE], extra: { queueMirrorPath: join(scratch, "queue.json") } }).base;
  browser = await chromium.launch();
});

// A page of its own per test, rather than one shared by all of them. Every
// test here opens a modal, and several measure it without closing it — run
// in sequence on one page, the first test of the second box hung on its own
// click until the 30 s limit killed it, and the killed browser failed the
// nine tests behind it. Alone, every one of them passes.
beforeEach(async () => {
  page = await browser.newPage();
});

afterEach(async () => {
  await page.close();
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

type Box = { name: string; url: string; id: string };
const BOXES: Box[] = [
  { name: "cancel box", url: `/specs?live=0&open=aide%2F${FOLDER}`, id: "cancelask-run1" },
  { name: "close box", url: `/specs/aide/${IDLE}?live=0`, id: "closeask" },
];

/** By attribute, since an id may hold a `/`, which no CSS `#…` selector takes. */
const dialog = (box: Box) => page.locator(`dialog[id="${box.id}"]`);

/** Opens the box from its button, and checks it came up as a modal. */
async function open(box: Box): Promise<void> {
  await page.goto(`${base}${box.url}`);
  await page.locator(`button[data-ask="${box.id}"]`).click();
  await dialog(box).waitFor({ state: "visible" });
  expect(await dialog(box).evaluate((d) => (d as HTMLDialogElement).matches(":modal"))).toBe(true);
}

for (const box of BOXES) {
  for (const how of ["Cancel", "Escape"] as const) {
    test(`${box.name}: ${how} closes it, navigates nowhere and posts nothing (AC-4)`, async () => {
      await open(box);
      const posts: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST") posts.push(r.url());
      });
      const before = page.url();
      if (how === "Cancel") await dialog(box).getByRole("button", { name: "Cancel" }).click();
      else await page.keyboard.press("Escape");
      await dialog(box).waitFor({ state: "hidden" });
      expect(page.url()).toBe(before);
      expect(posts).toEqual([]);
    });
  }
}
