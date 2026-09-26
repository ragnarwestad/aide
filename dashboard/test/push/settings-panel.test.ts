// The Notifications tab on Settings (AC-1): it is one of the page's
// tabs, and its panel carries what the script needs — the server's
// public key and the language the device is reading in.
import { describe, expect, test } from "bun:test";
import { renderSettingsPage, SETTINGS_TABS } from "../../src/render";

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

  test("the control is a switch, off to begin with, and there is no Turn on or Turn off button (AC-1, AC-2)", () => {
    const html = page();
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*id="push-toggle"|<button[^>]*id="push-toggle"[^>]*role="switch"/);
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('aria-label="Notifications for this device"');
    expect(html).toContain(">Off<");
    expect(html).not.toContain("Turn on");
    expect(html).not.toContain("Turn off");
  });

  test("the status sentence follows the switch in the markup (AC-5)", () => {
    const html = page();
    expect(html.indexOf('id="push-toggle"')).toBeGreaterThan(-1);
    expect(html.indexOf("data-push-status")).toBeGreaterThan(html.indexOf('id="push-toggle"'));
  });

  test("the other tabs do not draw the panel", () => {
    expect(page({ tab: "phases" })).not.toContain("data-push-panel");
  });
});
