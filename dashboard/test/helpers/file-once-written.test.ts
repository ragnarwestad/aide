// The helper waits for a line to land, not for the file to appear: a
// shell `>` makes an empty file first, and a test that read at that
// moment saw "" (2026-09-13).
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE_WAIT_TRIES, fileOnceWritten } from "./file-once-written.ts";

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
    // The ceiling itself is the constant below; what this checks is that
    // an empty file the whole way ends in the CALLER's own sentence
    // rather than in "", so it asks for a short ceiling of its own.
    writeFileSync(join(dir, "empty.txt"), "");
    const error = await fileOnceWritten(join(dir, "empty.txt"), "the runner was never invoked", 4).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("never invoked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Ten seconds is what a stub gets on the serving host, beside other
// suites: the number belongs in one place, and this is the test that
// says which.
test("the ceiling a caller gets by default is ten seconds", () => {
  expect(FILE_WAIT_TRIES * 50).toBe(10_000);
});
