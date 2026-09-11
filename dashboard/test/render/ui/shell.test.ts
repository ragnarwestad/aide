// Spec 334, REQ-5: a machine missing a tool aide's installer could not
// declare has to be visible on every ordinary dashboard visit, with no
// command to run and no extra page to open. pageShell() is the ONE
// function every page already renders through, so the banner lives
// there — reading AIDE_INSTALL_LOG's last block for a warning mark.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pageShell } from "../../../src/render/ui/shell.ts";

const ENTRIES = [{ label: "Projects", path: "/projects" }];

let scratchDir: string | undefined;

afterEach(() => {
  delete process.env.AIDE_INSTALL_LOG;
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = undefined;
  }
});

function writeLog(content: string): string {
  scratchDir = mkdtempSync(join(tmpdir(), "aide-install-log-"));
  const path = join(scratchDir, "install.log");
  writeFileSync(path, content);
  process.env.AIDE_INSTALL_LOG = path;
  return path;
}

describe("pageShell install warning banner", () => {
  test("shows the banner when the log's last block has a warning", () => {
    writeLog(
      "--- 2026-08-31T00:00:00Z ---\nall good\n" +
      "--- 2026-09-01T00:00:00Z ---\n⚠️  [aide tools] mise is not installed — skipping jq\n",
    );
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z");
    expect(html).toContain("install.log");
    expect(html).toContain("rowmsg waiting");
  });

  test("shows nothing when the last block has no warning", () => {
    writeLog(
      "--- 2026-08-31T00:00:00Z ---\n⚠️  an old warning\n" +
      "--- 2026-09-01T00:00:00Z ---\neverything installed cleanly\n",
    );
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z");
    expect(html).not.toContain("install.log");
  });

  test("shows nothing for an installer warning that is not about the tool list", () => {
    // Codex, a browser MCP, a shell PATH line: things a machine may
    // legitimately not have. A banner firing on those was on after
    // every merge on the serving host.
    writeLog(
      "--- 2026-09-01T00:00:00Z ---\n⚠️  Codex CLI is NOT installed\n" +
      "⚠️  Browser Testing MCP is NOT configured\n⚠️  ~/.local/bin is NOT in PATH for this shell yet\n",
    );
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z");
    expect(html).not.toContain("install.log");
  });

  test("shows nothing when the log file does not exist", () => {
    scratchDir = mkdtempSync(join(tmpdir(), "aide-install-log-"));
    process.env.AIDE_INSTALL_LOG = join(scratchDir, "does-not-exist.log");
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z");
    expect(html).not.toContain("install.log");
  });

  test("sits between the header and the tab bar (REQ-2)", () => {
    writeLog(
      "--- 2026-08-31T00:00:00Z ---\nall good\n" +
      "--- 2026-09-01T00:00:00Z ---\n⚠️  [aide tools] mise is not installed — skipping jq\n",
    );
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z");
    const headerEnd = html.indexOf("</header>");
    const bannerStart = html.indexOf("rowmsg waiting");
    const tabbarStart = html.indexOf('<nav class="tabbar');
    expect(headerEnd).toBeGreaterThan(-1);
    expect(bannerStart).toBeGreaterThan(-1);
    expect(tabbarStart).toBeGreaterThan(-1);
    expect(bannerStart).toBeGreaterThan(headerEnd);
    expect(bannerStart).toBeLessThan(tabbarStart);
  });
});

// Spec 350, REQ-3/REQ-4/REQ-5.
describe("pageShell language (spec 350)", () => {
  test("no lang opt renders <html lang=\"en\"> and English header text, unchanged", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('aria-label="Theme"');
  });

  test("{ lang: \"nb\" } renders <html lang=\"nb\"> and a Norwegian header string", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", undefined, {
      lang: "nb",
    });
    expect(html).toContain('<html lang="nb">');
    expect(html).toContain('aria-label="Tema"');
    expect(html).not.toContain('aria-label="Theme"');
  });

  // Spec 435: the link now targets the CALLER's own current address
  // (`opts.currentUrl`), with only `lang` swapped, so switching
  // language keeps the reader on the page, tab, sort and filter they
  // were already on — reversing spec 408's "always /?lang=..." choice.
  test("the language control's link targets currentUrl with lang swapped", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", undefined, {
      lang: "nb",
      currentUrl: "/specs/aide/435-x?tab=solution",
    });
    expect(html).toContain('href="/specs/aide/435-x?tab=solution&amp;lang=en"');
    expect(html).toContain('href="/specs/aide/435-x?tab=solution&amp;lang=nb" aria-current="true"');
  });

  test("no currentUrl falls back to /?lang=..., the same as every caller had before this field existed", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", undefined, {
      lang: "nb",
    });
    expect(html).toContain('href="/?lang=en"');
    expect(html).toContain('href="/?lang=nb"');
  });

  // Spec 409, REQ-1: PaceUp draws each language choice as a flag plus
  // a name, never a bare two-letter code.
  // Spec 413, REQ-1/REQ-3: the name is translated into the SELECTED
  // language, not left in each choice's own native language.
  test("the trigger shows the current language's flag, and both dropdown links carry flag + name translated into the selected language", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", undefined, {
      lang: "nb",
    });
    const lang = html.match(/<details class="menu lang">[\s\S]*?<\/details>/)![0];
    expect(lang).toContain(">🇳🇴</summary>");
    expect(lang).toContain('href="/?lang=nb" aria-current="true">🇳🇴 Norsk</a>');
    expect(lang).toContain('href="/?lang=en">🇬🇧 Engelsk</a>');
    expect(lang).not.toMatch(/>NO</);
    expect(lang).not.toMatch(/>EN</);
  });

  // Spec 413, REQ-1/REQ-2: with English selected, both names read in
  // English — the other language's name translated, not "Norsk".
  test("with English selected, both dropdown links carry flag + name translated into English", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", undefined, {
      lang: "en",
    });
    const lang = html.match(/<details class="menu lang">[\s\S]*?<\/details>/)![0];
    expect(lang).toContain(">🇬🇧</summary>");
    expect(lang).toContain('href="/?lang=en" aria-current="true">🇬🇧 English</a>');
    expect(lang).toContain('href="/?lang=nb">🇳🇴 Norwegian</a>');
    expect(lang).not.toMatch(/>NO</);
    expect(lang).not.toMatch(/>EN</);
  });
});

// Spec 436: theme, language and unit all reach the header directly on
// desktop, and all three repeat, flat, inside the "…" menu for mobile.
describe("pageShell header controls (spec 436)", () => {
  test("AC-1: theme, language and unit each stand as their own trigger in the header row", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-10T00:00:00Z");
    const row = html.match(/<span class="row">[\s\S]*?<details class="menu"><summary/)![0];
    expect(row).toContain('<details class="menu theme">');
    expect(row).toContain('<details class="menu lang">');
    expect(row).toContain('<details class="menu unit">');
  });

  test("AC-1: the unit control's own panel offers $ and Tokens as two radio choices", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-10T00:00:00Z");
    const unit = html.match(/<details class="menu unit">[\s\S]*?<\/details>/)![0];
    expect(unit).toContain('<input type="radio" name="unit" value="usd" data-unit-choice="usd" checked>');
    expect(unit).toContain('<input type="radio" name="unit" value="tokens" data-unit-choice="tokens">');
  });

  test("AC-2: the \"…\" menu's panel carries a morerows block with the theme, language and unit choices", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-10T00:00:00Z");
    const menu = html.match(/<details class="menu"><summary[\s\S]*?<\/details>/)![0];
    const morerows = [...menu.matchAll(/<div class="morerows (theme|lang|unit)">([\s\S]*?)<\/div>/g)];
    expect(morerows.map((m) => m[1])).toEqual(["theme", "lang", "unit"]);
    expect(morerows[0]![2]).toContain('data-theme-choice="dark"');
    expect(morerows[1]![2]).toContain('href="/?lang=en"');
    expect(morerows[2]![2]).toContain('data-unit-choice="usd"');
    expect(menu).toContain('href="/settings"');
    expect(menu).toContain('href="/test-servers"');
    expect(menu).toContain("data-about");
  });
});

// Spec 408, REQ-2: Settings belongs to none of the tabs the bar offers,
// so it draws no tab bar at all — everything else keeps drawing one.
describe("pageShell hideTabBar (spec 408)", () => {
  test("hideTabBar: true draws no <nav class=\"tabbar\">", () => {
    const html = pageShell("Settings", ENTRIES, "/settings", "<p>body</p>", "2026-09-06T00:00:00Z", undefined, {
      hideTabBar: true,
    });
    expect(html).not.toContain('<nav class="tabbar');
  });

  test("without it, the default case still draws the tab bar", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-06T00:00:00Z");
    expect(html).toContain('<nav class="tabbar');
  });
});
