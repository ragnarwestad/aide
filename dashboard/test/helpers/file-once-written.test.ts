// The helper waits for a line to land, not for the file to appear: a
// shell `>` makes an empty file first, and a test that read at that
// moment saw "" (2026-09-13).
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileOnceWritten } from "./file-once-written.ts";

test("an empty file that fills in later is read once its line has landed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-file-once-written-"));
  try {
    const path = join(dir, "out.txt");
    writeFileSync(path, "");
    setTimeout(() => writeFileSync(path, "<unset>\n"), 120);
    expect(await fileOnceWritten(path, "never written")).toBe("<unset>\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file nobody writes is reported by name, not as an empty answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-file-once-written-"));
  try {
    const helper = (await import("./file-once-written.ts")).fileOnceWritten;
    // Ten seconds is the helper's own ceiling; an empty file the whole
    // way must end in the caller's own sentence, not in "".
    const t0 = Date.now();
    writeFileSync(join(dir, "empty.txt"), "");
    const error = await helper(join(dir, "empty.txt"), "the runner was never invoked").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("never invoked");
    expect(Date.now() - t0).toBeGreaterThan(5_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
