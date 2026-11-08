// The Notifications tab's panel carries what the script needs — the server's
// public key and the language the device is reading in.
import { describe, expect, test } from "bun:test";
import { renderSettingsPage } from "../../src/render";

const page = (over: Record<string, unknown> = {}) =>
  renderSettingsPage([], "2026-09-19T10:00:00Z", {
    modelChoices: [], defaultModels: {}, timeoutSec: { default: 1200 }, tab: "notifications",
    pushPublicKey: "PUBLIC-KEY-1", lang: "nb", ...over,
  } as Parameters<typeof renderSettingsPage>[2]);

describe("the Notifications tab", () => {
  test("its panel carries the server's public key and the reader's language for the script", () => {
    const html = page();
    expect(html).toContain("data-push-panel");
    expect(html).toContain('data-key="PUBLIC-KEY-1"');
    expect(html).toContain('data-lang="nb"');
  });
});
