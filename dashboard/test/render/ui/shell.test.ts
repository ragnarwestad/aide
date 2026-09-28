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
});

// Spec 350, REQ-3/REQ-4/REQ-5.
describe("pageShell language (spec 350)", () => {
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
});
