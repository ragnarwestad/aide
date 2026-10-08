// The approach warning on the Specs list, in a real browser: Cancel puts
// the recommended approach back, and an approach's link opens the
// Solution tab with that approach's lead in view.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, statusSaying } from "../../helpers/queue-server.ts";
import { recording } from "../../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const FOLDER = "81-queue-and-runner";
const DESCRIPTION =
  "# Queue - Description\n\n## Tracking info\n\n- **Created:** `2026-10-03 07:00 UTC`\n" +
  "- **Let me choose the approach:** yes\n\n---\n\n## Description\n\nText.\n";
// Long enough above the leads that landing on one means scrolling to it.
const FILLER = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of the scope, before the approaches.`).join("\n\n");
const SOLUTION =
  `# Queue - Solution\n\n## Scope\n\n${FILLER}\n\n## Approaches\n\n` +
  "**Approach A: Hold the chained implement (recommended).** a\n\n" +
  `${FILLER}\n\n` +
  "**Approach B: End the job after analyze (real alternative).** b\n\n" +
  "**Approach C: Hold every implement (considered and rejected).** c\n\n" +
  `### Recommended: Approach A\n\nWhy.\n\n${FILLER}\n`;

const harness = queueHarness("aide-e2e-approach-choice-");
let browser: Browser;
let page: Page;
let base: string;

async function waitUntil(cond: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= deadline) throw new Error(`${label} did not happen within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  const started = harness.start({
    extra: { gitRun: recording().run },
    description: DESCRIPTION,
    status: statusSaying(["create", "analyze"]),
  });
  base = started.base;
  writeFileSync(join(started.dir, "root", "aide", "specs", FOLDER, "3-solution.md"), SOLUTION);
  await waitUntil(
    async () => (await (await fetch(`${base}/specs?live=0`)).text()).includes('class="actionform approachform"'),
    10_000,
    "the specs list to carry the approach warning",
  );
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

const notice = () => page.locator(`tr.specnotice[data-folder="${FOLDER}"]`);
const radio = (letter: string) => notice().locator(`input[name="approach"][value="${letter}"]`);

describe("the approach warning", () => {
  test("Cancel puts the recommended approach back (AC-3)", async () => {
    await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(/)");
    expect(await radio("A").isChecked()).toBe(true);
    const cancel = notice().locator("button", { hasText: "Cancel" });
    expect(await cancel.isDisabled()).toBe(true);
    await radio("B").check();
    expect(await cancel.isEnabled()).toBe(true);
    await cancel.click();
    expect(await radio("A").isChecked()).toBe(true);
    expect(await radio("B").isChecked()).toBe(false);
    expect(await cancel.isDisabled()).toBe(true);
  });

  test("an approach's link opens the Solution tab with its lead in view (AC-3)", async () => {
    await withBrowser(page.goto(`${base}/specs?live=0`), "page.goto(/)");
    await notice().locator('a[href*="#approach-b"]').click();
    await page.waitForURL(/tab=solution#approach-b$/);
    const lead = page.locator("strong:visible", { hasText: "Approach B: End the job after analyze" }).first();
    await lead.waitFor();
    await waitUntil(
      async () =>
        lead.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= window.innerHeight;
        }),
      10_000,
      "the lead to be scrolled into view",
    );
  });
});
