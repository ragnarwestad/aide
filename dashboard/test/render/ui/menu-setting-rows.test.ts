// Spec 507: the "…" menu's phone rows are one row per setting — a
// caption and a compact control — then a separator, then the links.
// Rendered through pageShell, so a missing function is a failed
// assertion and not a missing import.
import { describe, expect, test } from "bun:test";

import { pageShell } from "../../../src/render/ui/shell.ts";

const ENTRIES = [{ label: "Projects", path: "/projects" }];

function menuPanel(opts: { lang?: "en" | "nb" | "fr"; currentUrl?: string } = {}): string {
  const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-19T00:00:00Z", undefined, opts);
  return html.match(/<details class="menu"><summary[\s\S]*?<div class="menupanel">([\s\S]*?)<\/details>/)![1]!;
}

describe("the phone menu's setting rows (spec 507)", () => {
  test("three rows in order, a separator, then the links (AC-1, AC-5)", () => {
    const panel = menuPanel();
    const order = [
      ...panel.matchAll(/<div class="morerows (theme|lang|unit)">|<div class="menusep"|<a href="([^"]+)"|<button type="button" (data-about)/g),
    ].map((m) => m[1] ?? m[2] ?? m[3] ?? "sep");
    expect(order).toEqual(["theme", "lang", "unit", "sep", "/settings", "/test-servers", "data-about"]);
  });

  test("each row's caption names it in the page's language (AC-1)", () => {
    const panel = menuPanel({ lang: "nb" });
    const captions = [...panel.matchAll(/<div class="morerows \w+"><span class="lbl">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(captions).toEqual(["Tema", "Språk", "Enheter"]);
  });

  test("the separator is a role=separator element (AC-5)", () => {
    expect(menuPanel()).toContain('<div class="menusep" role="separator"></div>');
  });

  test("theme is a group of three word buttons, Auto marked, no icon or check mark (AC-2)", () => {
    const row = menuPanel().match(/<div class="morerows theme">([\s\S]*?)<\/div>/)![1]!;
    expect(row).toContain('role="group"');
    const buttons = [...row.matchAll(/<button type="button" data-theme-choice="(\w+)"( aria-current="true")?>([^<]*)<\/button>/g)];
    expect(buttons.map((b) => [b[1], b[2] ? "marked" : "", b[3]])).toEqual([
      ["auto", "marked", "Auto"],
      ["light", "", "Light"],
      ["dark", "", "Dark"],
    ]);
    expect(row).not.toContain("<svg");
    expect(row).not.toContain("menucheck");
  });

  test("language is one select with the five languages, the active one selected (AC-3)", () => {
    const row = menuPanel({ lang: "nb", currentUrl: "/specs?sort=name" }).match(
      /<div class="morerows lang">([\s\S]*?)<\/div>/,
    )![1]!;
    expect(row.match(/<select data-lang-select/g)).toHaveLength(1);
    const options = [...row.matchAll(/<option value="([^"]+)"( selected)?>([^<]+)<\/option>/g)];
    // The same addresses, in the same order, as the header's own links.
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-19T00:00:00Z", undefined, {
      lang: "nb",
      currentUrl: "/specs?sort=name",
    });
    const links = html.match(/<details class="menu lang">[\s\S]*?<\/details>/)![0];
    const hrefs = [...links.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toHaveLength(5);
    expect(hrefs[0]).toContain("/specs?sort=name&amp;lang=");
    expect(options.map((o) => o[1])).toEqual(hrefs);
    expect(options.filter((o) => o[2]).map((o) => o[3])).toEqual(["🇳🇴 Norsk"]);
    expect(options.map((o) => o[3])).toContain("🇩🇪 Deutsch");
  });

  test("unit is a radiogroup of two radios named unit-more, usd checked (AC-4)", () => {
    const row = menuPanel().match(/<div class="morerows unit">([\s\S]*?)<\/div>/)![1]!;
    expect(row).toContain('role="radiogroup"');
    expect(row).toContain('<input type="radio" name="unit-more" value="usd" data-unit-choice="usd" checked><span>$</span>');
    expect(row).toContain('<input type="radio" name="unit-more" value="tokens" data-unit-choice="tokens"><span>Tokens</span>');
  });
});
