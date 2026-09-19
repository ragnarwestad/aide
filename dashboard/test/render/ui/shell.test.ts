// Spec 334, REQ-5: a machine missing a tool aide's installer could not
// declare has to be visible on every ordinary dashboard visit, with no
// command to run and no extra page to open. pageShell() is the ONE
// function every page already renders through, so the banner lives
// there — reading AIDE_INSTALL_LOG's last block for a warning mark.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pageShell } from "../../../src/render/ui/shell.ts";
import { CSS } from "../../../src/render/ui/css";

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

  // The banner says what is wrong, in the installer's own words: "see
  // the log" hid the one sentence that mattered — that the board will
  // not start after its next restart (2026-09-19).
  test("says the problem itself, one line per warning", () => {
    writeLog(
      "--- 2026-09-19T00:00:00Z ---\n⚠️  [aide tools] mise is not installed — skipping jq\n" +
      "⚠️ [aide serve] the launchd job passes --token-file, which this build no longer accepts\n",
    );
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-19T00:00:00Z");
    const lines = html.match(/<p class="install-warning rowmsg waiting">[\s\S]*?<\/p>/g) ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("found a problem: mise is not installed — skipping jq");
    expect(lines[1]).toContain("found a problem: the launchd job passes --token-file, which this build no longer accepts");
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
    const tabbarStart = html.indexOf('<nav class="tabbar', html.indexOf("</header>"));
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
  // Spec 484, AC-1: the header offers all five languages, each labelled
  // with that language's OWN native name — never translated into the
  // reader's selected language (reversing spec 413's own choice).
  test("the trigger shows the current language's flag, and all five dropdown links carry flag + native name", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", undefined, {
      lang: "nb",
    });
    const lang = html.match(/<details class="menu lang">[\s\S]*?<\/details>/)![0];
    expect(lang).toContain(">🇳🇴</summary>");
    expect(lang).toContain('href="/?lang=en"><span class="menucheck">');
    expect(lang).toContain("🇬🇧 English</a>");
    expect(lang).toContain('href="/?lang=nb" aria-current="true"><span class="menucheck">');
    expect(lang).toContain("🇳🇴 Norsk</a>");
    expect(lang).toContain('href="/?lang=es"><span class="menucheck">');
    expect(lang).toContain("🇪🇸 Español</a>");
    expect(lang).toContain('href="/?lang=de"><span class="menucheck">');
    expect(lang).toContain("🇩🇪 Deutsch</a>");
    expect(lang).toContain('href="/?lang=fr"><span class="menucheck">');
    expect(lang).toContain("🇫🇷 Français</a>");
    expect(lang).not.toMatch(/>NO</);
    expect(lang).not.toMatch(/>EN</);
  });

  // Spec 484, AC-1: the same five native names show whichever language
  // is selected — English selected does not translate "Norsk" into
  // "Norwegian" the way spec 413's mechanism used to.
  test("with English selected, every dropdown link still carries its OWN native name, not an English translation", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", undefined, {
      lang: "en",
    });
    const lang = html.match(/<details class="menu lang">[\s\S]*?<\/details>/)![0];
    expect(lang).toContain(">🇬🇧</summary>");
    expect(lang).toContain('href="/?lang=en" aria-current="true"><span class="menucheck">');
    expect(lang).toContain("🇬🇧 English</a>");
    expect(lang).toContain("🇳🇴 Norsk</a>");
    expect(lang).not.toContain("Norwegian");
    expect(lang).toContain("🇪🇸 Español</a>");
    expect(lang).toContain("🇩🇪 Deutsch</a>");
    expect(lang).toContain("🇫🇷 Français</a>");
    expect(lang).not.toMatch(/>NO</);
    expect(lang).not.toMatch(/>EN</);
  });

  test("es/de/fr each render as the current language with their own aria-current link", () => {
    for (const [code, flag] of [["es", "🇪🇸"], ["de", "🇩🇪"], ["fr", "🇫🇷"]] as const) {
      const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", undefined, {
        lang: code,
      });
      expect(html).toContain(`<html lang="${code}">`);
      const lang = html.match(/<details class="menu lang">[\s\S]*?<\/details>/)![0];
      expect(lang).toContain(`>${flag}</summary>`);
      expect(lang).toContain(`href="/?lang=${code}" aria-current="true">`);
    }
  });
});

// Spec 475: both menus mark which option is chosen — a check mark held
// in a reserved column whether shown or not, the chosen row in its own
// bold + colour, and a heading naming the menu — identically in the
// header's own panel and the "…" menu's mobile copy.
describe("pageShell theme/language menus mark the chosen option (spec 475)", () => {
  test("AC-1: the theme menu's chosen row (auto) carries the check-mark span", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z");
    expect(html).toContain(
      '<button type="button" data-theme-choice="auto" aria-current="true"><span class="menucheck">',
    );
  });

  test("AC-3: an unchosen theme row still carries the check-mark span, reserving its column", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z");
    expect(html).toContain('<button type="button" data-theme-choice="dark"><span class="menucheck">');
    expect(html).toContain('<button type="button" data-theme-choice="light"><span class="menucheck">');
  });

  test("AC-2: the language menu's chosen row carries the check-mark span", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z", undefined, {
      lang: "nb",
    });
    expect(html).toContain('href="/?lang=nb" aria-current="true"><span class="menucheck">');
  });

  test("AC-3: the unchosen language row still carries the check-mark span, reserving its column", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z", undefined, {
      lang: "nb",
    });
    expect(html).toContain('href="/?lang=en"><span class="menucheck">');
  });

  test("AC-4: the CSS bolds the chosen row for both button rows (theme) and <a> rows (language)", () => {
    expect(CSS).toContain(
      ".menupanel > button[aria-current],\n.menupanel > a[aria-current] { font-weight: 600; }",
    );
  });

  test("AC-4: the CSS gives each menu's chosen row its own colour, distinct from its unchosen rows", () => {
    expect(CSS).toContain(
      ".menu.theme .menupanel > button,\n.menu.lang .menupanel > a { color: var(--muted); }",
    );
    expect(CSS).toContain(
      ".menu.theme .menupanel > button[aria-current],\n.menu.lang .menupanel > a[aria-current] { color: var(--text); }",
    );
  });

  test("AC-3: the CSS reserves the check-mark's column by opacity, never display:none", () => {
    expect(CSS).toMatch(/\.menucheck\s*\{[^}]*opacity:\s*0[^}]*\}/);
    expect(CSS).not.toMatch(/\.menucheck\s*\{[^}]*display:\s*none/);
    expect(CSS).toContain("[aria-current] > .menucheck { opacity: 1; }");
  });

  test("AC-5: the theme menu's standalone panel opens with a heading naming it", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z");
    expect(html).toContain('<div class="menupanel"><span class="lbl">Theme</span>');
  });

  test("AC-6: the language menu's standalone panel opens with a heading naming it", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z");
    const lang = html.match(/<details class="menu lang">[\s\S]*?<\/details>/)![0];
    expect(lang).toContain('<div class="menupanel"><span class="lbl">Language</span>');
  });

  test('AC-5/AC-6: the "…" menu\'s mobile copy carries the same two headings', () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z");
    expect(html).toContain('<div class="morerows theme"><span class="lbl">Theme</span>');
    expect(html).toContain('<div class="morerows lang"><span class="lbl">Language</span>');
  });
});

// Spec 436: theme, language and unit all reach the header directly on
// desktop, and all three repeat, flat, inside the "…" menu for mobile.
describe("pageShell header controls (spec 436)", () => {
  test("AC-1: theme, language and unit each stand as their own trigger in the header row", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-10T00:00:00Z");
    const row = html.match(/<div class="row">[\s\S]*?<details class="menu"><summary/)![0];
    expect(row).toContain('<details class="menu theme">');
    expect(row).toContain('<details class="menu lang">');
    expect(row).toContain('<details class="menu unit">');
  });

  test("AC-1: the unit control's own panel offers $ and Tokens as two radio choices", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-10T00:00:00Z");
    const unit = html.match(/<details class="menu unit">[\s\S]*?<\/details>/)![0];
    expect(unit).toContain('<input type="radio" name="unit-menu" value="usd" data-unit-choice="usd" checked>');
    expect(unit).toContain('<input type="radio" name="unit-menu" value="tokens" data-unit-choice="tokens">');
  });

  test("AC-2: the \"…\" menu's panel carries a morerows block with the theme, language and unit choices", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-10T00:00:00Z");
    const menu = html.match(/<details class="menu"><summary[\s\S]*?<\/details>/)![0];
    const morerows = [...menu.matchAll(/<div class="morerows (theme|lang|unit)">([\s\S]*?)<\/div>/g)];
    expect(morerows.map((m) => m[1])).toEqual(["theme", "lang", "unit"]);
    expect(morerows[0]![2]).toContain('data-theme-choice="dark"');
    expect(morerows[1]![2]).toContain('<option value="/?lang=en"');
    expect(morerows[2]![2]).toContain('data-unit-choice="usd"');
    expect(menu).toContain('href="/settings"');
    expect(menu).toContain('href="/test-servers"');
    expect(menu).toContain("data-about");
  });
});

// Spec 469: the desktop "$" menu never showed which of $/Tokens was
// chosen, because both on-page copies of the radio pair shared one
// native `name="unit"` — the browser's own radio grouping collapses
// them into a single four-radio group, and only the copy `mark()` sets
// LAST (the "…" menu's) ends up actually checked. This runs the real
// `unit-script.ts` against the real, full two-copy markup in a real DOM
// (happy-dom), the only way to see the browser's own grouping collide.
describe("pageShell header unit control - desktop checked state (spec 469)", () => {
  let scriptText: string;

  beforeAll(async () => {
    const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
    GlobalRegistrator.register();
    scriptText = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
      readFileSync(join(import.meta.dir, "..", "..", "..", "src", "render", "scripts", "unit-script.ts"), "utf-8"),
    );
  });

  afterAll(async () => {
    const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
    await GlobalRegistrator.unregister();
  });

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /** Renders the real page, runs the real script against it (never
   *  `document.write`, so the page's own embedded `<script>` never
   *  auto-executes — this is the only copy that runs), and fires a real
   *  `DOMContentLoaded`. */
  function render(stored: string | null): void {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-10T00:00:00Z");
    document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)![1]!;

    const store: Record<string, string> = {};
    if (stored !== null) store["unit"] = stored;
    const localStorage = {
      getItem: (key: string): string | null => store[key] ?? null,
    };
    // eslint-disable-next-line no-new-func -- the file under test IS a script
    new Function("document", "localStorage", scriptText)(document, localStorage);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  }

  function desktopRadio(choice: string): HTMLInputElement {
    return document.querySelector(`.menu.unit .menupanel input[data-unit-choice="${choice}"]`) as HTMLInputElement;
  }

  test("AC-1: with no stored choice, the desktop menu's own $ radio shows checked", () => {
    render(null);
    expect(desktopRadio("usd").checked).toBe(true);
    expect(desktopRadio("tokens").checked).toBe(false);
  });

  test("AC-1: with Tokens stored, the desktop menu's own Tokens radio shows checked", () => {
    render("tokens");
    expect(desktopRadio("tokens").checked).toBe(true);
    expect(desktopRadio("usd").checked).toBe(false);
  });

  test("AC-2: picking Tokens in the desktop menu still switches the Tokens/Cost column", () => {
    render(null);
    const tokensRadio = desktopRadio("tokens");
    tokensRadio.checked = true;
    tokensRadio.dispatchEvent(new Event("change"));
    expect(document.documentElement.dataset.unit).toBe("tokens");
  });
});

// Spec 408, REQ-2: Settings belongs to none of the tabs the bar offers,
// so it draws no tab bar at all — everything else keeps drawing one.
// Spec 478: a page-wide dialog, the confirmdialog shape row-controls.ts
// already uses elsewhere, replacing the native beforeunload prompt for
// an in-app link click — a real <dialog> is always positioned inside
// the document's own viewport, not the OS screen.
describe("pageShell leave-app dialog (spec 478)", () => {
  test("AC-1/AC-2: renders dialog.leaveapp with the four translated strings", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z");
    expect(html).toContain('<dialog class="leaveapp confirmdialog">');
    expect(html).toContain("Leave app?");
    expect(html).toContain("Changes you made may not be saved.");
    expect(html).toContain(">Leave<");
    expect(html).toContain(">Stay<");
  });

  test("renders the Norwegian strings when lang is nb", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z", undefined, {
      lang: "nb",
    });
    expect(html).toContain("Forlat appen?");
    expect(html).toContain("Endringene du gjorde blir kanskje ikke lagret.");
    expect(html).toContain(">Forlat<");
    expect(html).toContain(">Bli<");
  });

  test("UNSAVED_CHANGES_SCRIPT's own click interception runs before NAV_BUSY_SCRIPT/NAV_OVERLAY_SCRIPT see the same click", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-16T00:00:00Z");
    const scriptTag = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const unsavedIdx = scriptTag.indexOf("dialog.leaveapp");
    const navBusyIdx = scriptTag.indexOf("awaiting");
    const navOverlayIdx = scriptTag.indexOf("pageoverlay");
    expect(unsavedIdx).toBeGreaterThan(-1);
    expect(navBusyIdx).toBeGreaterThan(-1);
    expect(navOverlayIdx).toBeGreaterThan(-1);
    expect(unsavedIdx).toBeLessThan(navBusyIdx);
    expect(unsavedIdx).toBeLessThan(navOverlayIdx);
  });
});

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
