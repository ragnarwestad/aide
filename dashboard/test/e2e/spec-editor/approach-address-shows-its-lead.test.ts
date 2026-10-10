// An approach's address, in a real browser: the Solution tab opens with the
// editor scrolled to the approach's lead, so it is in view without the reader
// scrolling to it.
import { afterAll, beforeAll, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness, statusSaying } from "../../helpers/queue-server.ts";
import { recording } from "../../spec-page/spec-checks-fixtures.ts";

browserDeadline();
const FOLDER = "81-queue-and-runner";
// Far longer than any window here: reaching the lead means scrolling.
const paragraphs = (what: string): string =>
  Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1} of the ${what}.`).join("\n\n");
// The lead of Approach B sits a screen or more below the top.
const SOLUTION =
  `# Queue - Solution\n\n## Approaches\n\n${paragraphs("scope")}\n\n` +
  "**Approach A: Hold the chained implement (recommended).** a\n\n" +
  `${paragraphs("first approach")}\n\n` +
  "**Approach B: End the job after analyze (real alternative).** b\n\n" +
  `${paragraphs("second approach")}\n`;

const harness = queueHarness("aide-e2e-approach-address-");
let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  const started = harness.start({
    extra: { gitRun: recording().run },
    status: statusSaying(["create", "analyze"]),
  });
  base = started.base;
  writeFileSync(join(started.dir, "root", "aide", "specs", FOLDER, "3-solution.md"), SOLUTION);
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

test("an approach's address shows its lead by scrolling the editor (AC-3)", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await withBrowser(page.goto(`${base}/specs/aide/${FOLDER}?tab=solution&live=0#approach-b`), "page.goto(spec address)");
  await page.locator("#spec-editor-host[data-mounted]").waitFor();
  const lead = page.locator("strong:visible", { hasText: "Approach B: End the job after analyze" }).first();
  await lead.waitFor();
  await page.waitForFunction(() => {
    const strong = [...document.querySelectorAll("#spec-editor-host strong")].find((el) => el.textContent?.includes("Approach B"));
    const r = strong?.getBoundingClientRect();
    return !!r && r.top >= 0 && r.bottom <= window.innerHeight;
  });
  await page.close();
});
