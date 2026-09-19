// The install log is written by deploy/install-after-merge.sh and read by
// the dashboard for its warning banner, so both have to name the same
// file: macOS's own log directory there, ~/.aide/dashboard/logs elsewhere.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { defaultInstallLog } from "../../../src/render/ui/header-notices.ts";

const SCRIPT = readFileSync(new URL("../../../deploy/install-after-merge.sh", import.meta.url), "utf8");

describe("where the install log is", () => {
  test("macOS keeps it in the user's log directory", () => {
    expect(defaultInstallLog("/Users/a", "darwin")).toBe("/Users/a/Library/Logs/aide-dashboard/install.log");
  });

  test("Linux keeps it beside the dashboard's own state", () => {
    expect(defaultInstallLog("/home/a", "linux")).toBe("/home/a/.aide/dashboard/logs/install.log");
  });

  test("the script that writes it names the same two files, by the same test", () => {
    expect(SCRIPT).toContain('"$(uname -s)" = Darwin');
    expect(SCRIPT).toContain("$HOME/Library/Logs/aide-dashboard/install.log");
    expect(SCRIPT).toContain("$HOME/.aide/dashboard/logs/install.log");
  });
});
