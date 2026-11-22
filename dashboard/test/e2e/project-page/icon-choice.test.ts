// Choose file on the Config tab's icon row, in a browser: only a browser
// reads a picked file, and the page script that does it is what keeps Save
// shut until the newest pick has been read.
//
// By hand: `cd dashboard && bun test test/e2e/project-page/icon-choice.test.ts`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { harness, ownDirs, projectsRoot, settled, serve } from "../../project/detail/project-detail-route-fixtures.ts";

browserDeadline();

let browser: Browser;
let page: Page;
let base: string;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`);

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  // A file whose name starts "slow" takes 1.5 s to read, so a second pick
  // can land while the first is still being read.
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (this: FileReader, blob: Blob) {
      if (blob instanceof File && blob.name.startsWith("slow")) setTimeout(() => read.call(this, blob), 1500);
      else read.call(this, blob);
    };
  });
  const root = projectsRoot({ aide: null });
  base = serve(root, settled(root, "aide"));
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const dialog = () => page.locator("dialog[open]");
const save = () => dialog().getByRole("button", { name: "Save" });
const rowIcon = () => page.locator("form.projectsettingsform .projicon");

async function openChooseFile(): Promise<void> {
  await withBrowser(page.goto(`${base}/projects/aide?tab=config`), "page.goto");
  await page.getByRole("button", { name: "Choose file" }).click();
  await dialog().waitFor();
}

test("a picked file, saved, is the project's icon when the page comes back (AC-3)", async () => {
  await openChooseFile();
  await dialog().locator('input[type="file"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await save().click();
  await page.waitForFunction(() =>
    document.querySelector("form.projectsettingsform img.projicon")?.getAttribute("src")?.includes("?v="));
  const type = await page.evaluate(async () => (await fetch("/projects/aide/icon")).headers.get("content-type"));
  expect(type).toBe("image/png");
});

test("Save stays shut while the pick is read, and the newest pick is the one sent (AC-3)", async () => {
  await openChooseFile();
  const input = dialog().locator('input[type="file"]');
  await input.setInputFiles({ name: "slow.png", mimeType: "image/png", buffer: PNG });
  expect(await save().isDisabled()).toBe(true);
  await input.setInputFiles({ name: "fast.svg", mimeType: "image/svg+xml", buffer: SVG });
  await page.waitForFunction(() => !(document.querySelector("dialog[open] [id$='-form-save']") as HTMLButtonElement).disabled);
  // Past the slow read's end: it must not have put the older file back.
  await page.waitForTimeout(1800);
  expect(await dialog().locator('input[name="filename"]').inputValue()).toBe("fast.svg");
  await save().click();
  await rowIcon().first().waitFor();
  await page.waitForFunction(async () =>
    (await fetch("/projects/aide/icon")).headers.get("content-type") === "image/svg+xml");
});
