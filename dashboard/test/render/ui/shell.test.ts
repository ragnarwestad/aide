// A machine missing a tool aide's installer could not
// declare has to be visible on every ordinary dashboard visit, with no
// command to run and no extra page to open. pageShell() is the ONE
// function every page already renders through, so the banner lives
// there — reading AIDE_INSTALL_LOG's last block for a warning mark.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLIENT_WORDS, pageShell, siteTabKeys } from "../../../src/render/ui/shell.ts";
import { esc } from "../../../src/render/ui/html.ts";
import { t } from "../../../src/i18n";

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
});

describe("pageShell language", () => {
  test("every page carries the Usage menu", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z");
    expect(html).toContain('id="usage-dialog"');
  });
  // The link now targets the CALLER's own current address
  // (`opts.currentUrl`), with only `lang` swapped, so switching
  // language keeps the reader on the page, tab, sort and filter they
  // were already on — not an "always /?lang=..." link.
  test("the language control's link targets currentUrl with lang swapped", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", {
      lang: "nb",
      currentUrl: "/specs/aide/435-x?tab=solution",
    });
    expect(html).toContain('href="/specs/aide/435-x?tab=solution&amp;lang=en"');
    expect(html).toContain('href="/specs/aide/435-x?tab=solution&amp;lang=nb" aria-current="true"');
  });

  test("no currentUrl falls back to /?lang=..., the same as every caller had before this field existed", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", {
      lang: "nb",
    });
    expect(html).toContain('href="/?lang=en"');
    expect(html).toContain('href="/?lang=nb"');
  });
});

describe("the header's tabs", () => {
  const NAV = [
    { label: "Projects", path: "/projects" },
    { label: "Schedule", path: "/schedule" },
  ];

  test("Running comes first, then Specs, Projects and the sections", () => {
    expect(siteTabKeys(NAV, "/").keys).toEqual(["/", "/specs", "/projects", "/schedule"]);
  });

  test("Running is current for / and Specs for /specs", () => {
    expect(siteTabKeys(NAV, "/").current).toBe("/");
    expect(siteTabKeys(NAV, "/specs").current).toBe("/specs");
  });

  test("Projects and a section stay current on their own pages", () => {
    expect(siteTabKeys(NAV, "/projects").current).toBe("/projects");
    expect(siteTabKeys(NAV, "/schedule").current).toBe("/schedule");
  });

  test("draws the four site tabs with their own icons (AC-2, AC-3)", () => {
    const html = pageShell("Projects", [
      { label: "Projects", path: "/projects" },
      { label: "Schedule", labelKey: "shell.tabSchedule", path: "/schedule", icon: "schedule" },
    ], "/projects", "<p>body</p>", "2026-09-01T00:00:00Z");
    for (const tab of ["jobs", "specs", "projects", "schedule"]) {
      expect(html).toContain(`data-tab="${tab}"`);
    }
  });

  test("does not invent an icon for a section that names none (AC-2)", () => {
    const html = pageShell("Other", [
      { label: "Projects", path: "/projects" },
      { label: "Other", path: "/other" },
    ], "/other", "<p>body</p>", "2026-09-01T00:00:00Z");
    expect(html).not.toContain('data-tab="other"');
  });
});

// A page's script has no catalogue of its own: it reads its words off the
// page's <body>, which the server writes from the catalogue.
describe("the words a page's script reads", () => {
  test("each <body> attribute holds its catalogue entry in the page's language (AC-2)", () => {
    const html = pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", "2026-09-01T00:00:00Z", { lang: "nb" });
    const body = html.match(/<body[^>]*>/)?.[0] ?? "";
    expect(Object.keys(CLIENT_WORDS).length).toBeGreaterThan(0);
    for (const [name, key] of Object.entries(CLIENT_WORDS)) {
      const value = body.match(new RegExp(` data-${name}="([^"]*)"`))?.[1];
      expect({ name, value }).toEqual({ name, value: esc(t("nb", key)) });
    }
  });
});
