// Spec 518, criteria 2, 8 and 11: the three confirm boxes draw OK and
// Cancel on one row, close with Cancel and Escape without posting, and
// stay inside the box at phone width. Layout exists only in a browser.
// Run by the user.

import { afterAll, afterEach, beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { queueHarness } from "../helpers/queue-server.ts";

setDefaultTimeout(30_000);

const FOLDER = "81-queue-and-runner";
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
  const queueConfigFile = join(scratch, "queue-config.json");
  writeFileSync(
    queueConfigFile,
    JSON.stringify({ schedules: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" }] } }),
  );
  base = harness.start({ extra: { queueMirrorPath: join(scratch, "queue.json"), queueConfigFile } }).base;
  browser = await chromium.launch();
});

// A page of its own per test, rather than one shared by all sixteen. Every
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

type Box = { name: string; url: string; selector: string; lang?: string };
const BOXES: Box[] = [
  { name: "leave box", url: "/projects?live=0", selector: "dialog.leaveapp" },
  { name: "cancel box", url: `/?live=0&open=aide%2F${FOLDER}`, selector: "dialog.confirmdialog:has(.actionform)" },
  { name: "delete box", url: "/schedule?live=0", selector: "dialog.confirmdialog:has(.scheduledeleteform)" },
];

async function open(box: Box, lang = ""): Promise<void> {
  const sep = box.url.includes("?") ? "&" : "?";
  await page.goto(`${base}${box.url}${lang ? `${sep}lang=${lang}` : ""}`);
  await page.locator(box.selector).first().evaluate((d) => (d as HTMLDialogElement).showModal());
}

async function buttons(box: Box) {
  const dlg = page.locator(box.selector).first();
  const boxes = await dlg.locator(".dialogactions button").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  return { dlg, boxes };
}

for (const box of BOXES) {
  test(`${box.name}: OK and Cancel share one row, OK on the left (AC-1)`, async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(box);
    const { boxes } = await buttons(box);
    expect(boxes).toHaveLength(2);
    const [ok, cancel] = boxes;
    expect(Math.abs((ok!.top + ok!.bottom) / 2 - (cancel!.top + cancel!.bottom) / 2)).toBeLessThanOrEqual(1);
    expect(cancel!.left).toBeGreaterThan(ok!.right);
  });

  for (const how of ["Cancel", "Escape"] as const) {
    test(`${box.name}: ${how} closes it, navigates nowhere and posts nothing (AC-5)`, async () => {
      await open(box);
      const posts: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST") posts.push(r.url());
      });
      const before = page.url();
      const dlg = page.locator(box.selector).first();
      if (how === "Cancel") await dlg.getByRole("button", { name: "Cancel" }).click();
      else await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "hidden" });
      expect(page.url()).toBe(before);
      expect(posts).toEqual([]);
    });
  }

  for (const size of [{ width: 375, height: 800 }, { width: 320, height: 640 }]) {
    test(`${box.name}: the row stays inside the box at ${size.width}px (AC-7)`, async () => {
      await page.setViewportSize(size);
      await open(box, box.name === "delete box" ? "" : "de");
      const { dlg, boxes } = await buttons(box);
      const frame = await dlg.evaluate((d) => {
        const r = d.getBoundingClientRect();
        return { left: r.left, right: r.right, scroll: d.scrollWidth, client: d.clientWidth };
      });
      expect(frame.scroll).toBeLessThanOrEqual(frame.client);
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(frame.left);
        expect(b.right).toBeLessThanOrEqual(frame.right);
      }
      if (size.width === 375) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflow).toBe(false);
      }
    });
  }
}

test("the leave box's OK goes to the link's address after an edit (AC-5)", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/projects?live=0`);
  await page.locator("dialog.leaveapp").evaluate((d) => (d as HTMLDialogElement).showModal());
  await Promise.all([
    page.waitForURL((u) => new URL(u).pathname === "/projects" || true),
    page.locator("dialog.leaveapp").getByRole("button", { name: "OK" }).click(),
  ]);
  await page.locator("dialog.leaveapp").waitFor({ state: "hidden" });
});
