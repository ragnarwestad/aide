// A machine with no launchd (Linux) has nothing to restart the dashboard
// with. Landing Aide's own code there must not fail on the missing
// command; it says the restart is the reader's to do instead.

import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLaunchdRestart } from "../../../src/serve/land-branch";

const savedPath = process.env.PATH;
const empty = mkdtempSync(join(tmpdir(), "no-launchctl-"));

afterEach(() => {
  process.env.PATH = savedPath;
});

test("with no launchctl, nothing is registered and the log says to restart by hand", async () => {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  process.env.PATH = empty;
  try {
    expect(await createLaunchdRestart().registered()).toBe(false);
    expect(errors.mock.calls.flat().join("\n")).toContain("restart it by hand");
  } finally {
    errors.mockRestore();
    rmSync(empty, { recursive: true, force: true });
  }
});
