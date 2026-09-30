// Every confirmation on the board opens from its button as a modal, and
// closes with Cancel and with Escape, navigating nowhere and posting nothing.

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { queueHarness } from "../helpers/queue-server.ts";
import { ARCHIVED, STAMPED } from "../archived/archived-specs-fixtures.ts";

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
  const queueConfigFile = join(scratch, "queue-config.json");
  writeFileSync(
    queueConfigFile,
    JSON.stringify({ schedules: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" }] } }),
  );
  base = harness.start({
    alsoSpecs: [IDLE],
    archivedSpecs: { [STAMPED]: ARCHIVED[STAMPED] },
    extra: { queueMirrorPath: join(scratch, "queue.json"), queueConfigFile },
  }).base;
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

/** `id` is the dialog's; a box with no button (the leave question) is opened by hand. */
type Box = { name: string; url: string; id: string; button: boolean };
const BOXES: Box[] = [
  { name: "leave box", url: "/projects?live=0", id: "leaveapp", button: false },
  { name: "cancel box", url: `/?live=0&open=aide%2F${FOLDER}`, id: "cancelask-run1", button: true },
  { name: "delete box", url: "/projects/aide?tab=schedule&live=0", id: "deleteask-aide/nightly-report", button: true },
  { name: "remove box", url: "/projects/aide?tab=config&live=0", id: "removeask", button: true },
  { name: "close box", url: `/specs/aide/${IDLE}?live=0`, id: "closeask", button: true },
  { name: "reopen box", url: `/specs/aide/${STAMPED}?live=0`, id: "reopenask", button: true },
];

/** By attribute, since an id holding a `/` is no CSS `#…` selector. */
const dialog = (box: Box) => page.locator(`dialog[id="${box.id}"]`);

async function open(box: Box): Promise<void> {
  await page.goto(`${base}${box.url}`);
  if (box.button) await page.locator(`button[data-ask="${box.id}"]`).click();
  else await dialog(box).evaluate((d) => (d as HTMLDialogElement).showModal());
  await dialog(box).waitFor({ state: "visible" });
}

for (const box of BOXES.filter((b) => b.button)) {
  test(`${box.name}: its button opens it over the page (AC-2)`, async () => {
    await open(box);
    expect(await dialog(box).evaluate((d) => (d as HTMLDialogElement).matches(":modal"))).toBe(true);
  });
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
