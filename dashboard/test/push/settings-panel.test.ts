// The Notifications tab on Settings (AC-1): it is one of the page's
// tabs, and its panel carries what the script needs — the server's
// public key and the language the device is reading in.
import { describe, expect, test } from "bun:test";
import { renderSettingsPage, SETTINGS_TABS } from "../../src/render/pages/settings-page/index.ts";

const page = (over: Record<string, unknown> = {}) =>
  renderSettingsPage([], "2026-09-19T10:00:00Z", {
    modelChoices: [], defaultModels: {}, timeoutSec: { default: 1200 }, tab: "notifications",
    pushPublicKey: "PUBLIC-KEY-1", lang: "nb", ...over,
  } as Parameters<typeof renderSettingsPage>[2]);

describe("the Notifications tab", () => {
  test("is one of the Settings tabs and is drawn in the tab bar", () => {
    expect(SETTINGS_TABS).toContain("notifications");
    expect(page()).toContain("tab=notifications");
  });

  test("its panel carries the server's public key and the reader's language for the script", () => {
    const html = page();
    expect(html).toContain("data-push-panel");
    expect(html).toContain('data-key="PUBLIC-KEY-1"');
    expect(html).toContain('data-lang="nb"');
  });

  test("the panel has a toggle and a status line the script can find", () => {
    const html = page();
    expect(html).toContain('id="push-toggle"');
    expect(html).toContain("data-push-status");
  });

  test("the other tabs do not draw the panel", () => {
    expect(page({ tab: "phases" })).not.toContain("data-push-panel");
  });
});
