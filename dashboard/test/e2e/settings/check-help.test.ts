// What a provider's one Check reads sits behind a "(?)" inside its Check
// form on the provider's page, hidden until the reader opens it. Only a real browser opens a
// `<details>` on a press.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";
import { t } from "../../../src/i18n";
import { CHECKABLE_TOOLS } from "../../../src/render";
import { esc } from "../../../src/render/ui/html.ts";
import { checkHelp } from "../../../src/render/pages/settings-page/tools.ts";

browserDeadline();

const KEYS = {
  claude: { name: "Claude", tool: "claude" as const },
  codex: { name: "Codex", tool: "codex" as const },
  opencode: { name: "OpenCode", tool: "opencode" as const },
};
/** The providers as the queue config keeps them: by name. */
const PROVIDERS = Object.fromEntries(Object.values(KEYS).map((p) => [p.name, p]));
/** What opening a provider's page reads, so the page never starts a real CLI. */
const STUB_READS = {
  providerProbe: async (key: string) => ({ key, at: "2026-11-05T09:00:00.000Z", installed: true }),
  usageProbe: async (_key: string, provider: { tool: "claude" | "codex" | "opencode" }) => ({ tool: provider.tool, at: "2026-11-05T09:00:00.000Z", windows: [] }),
};

const harness = queueHarness("aide-e2e-check-help-");
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "aide-e2e-check-help-config-"));
  const file = join(scratch, "queue-config.json");
  writeFileSync(file, JSON.stringify({ providers: PROVIDERS }, null, 2));
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  page = await browser.newPage();
  base = harness.start({
    extra: {
      queueConfigFile: file,
      queueDefaults: {
        timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" },
        providers: structuredClone(PROVIDERS),
      },
      ...STUB_READS,
    },
  }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

/** Opens a provider's page, checks the explanation is hidden, opens its
 *  Check form's "(?)", and hands back the popover's text. */
async function openHelp(tool: string, hidden: string): Promise<string> {
  const address = `/settings/providers/edit?key=${KEYS[tool as keyof typeof KEYS].name}`;
  await withBrowser(page.goto(`${base}${address}`), `page.goto(${address})`);
  expect(await page.getByText(hidden, { exact: false }).first().isVisible()).toBe(false);
  const help = page.locator("#check-provider details.intro");
  expect(await help.count()).toBe(1);
  await help.locator("summary").click();
  expect(await help.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  return (await help.locator("p").innerText()).trim();
}

for (const tool of CHECKABLE_TOOLS) {
  test(`${tool}: what its Check reads is behind the (?) in its Check form`, async () => {
    const lead = t("en", "settings.checkHelpAll");
    expect(checkHelp("en", tool)).toContain(esc(lead));
    expect(await openHelp(tool, lead)).toContain(lead);
  });
}
