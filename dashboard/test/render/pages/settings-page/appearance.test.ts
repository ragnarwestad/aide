import { expect, test } from "bun:test";
import { renderSettingsPage } from "../../../../src/render/pages/settings-page/index.ts";

test("Appearance offers colour schemes and all six themes (AC-1, AC-2, AC-3)", () => {
  const html = renderSettingsPage([], "2026-11-14T00:00:00Z", {
    modelChoices: [], defaultModels: {}, timeoutSec: { default: 1200 }, tab: "appearance",
  });
  expect([...html.matchAll(/<input[^>]+data-theme-choice="([^"]+)"/g)].map((m) => m[1])).toEqual(["light", "dark", "auto"]);
  expect([...html.matchAll(/<input[^>]+value="([^"]+)"[^>]+data-palette-choice/g)].map((m) => m[1])).toEqual([
    "default", "maroon", "grove", "ocean", "ember", "iris",
  ]);
});
