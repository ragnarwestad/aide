// A fresh specs-root watch is told about writes made just before it
// opened; those are not news to an open page.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEcho } from "../../../src/serve/setup/watch-echo.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const root = () => {
  const d = mkdtempSync(join(tmpdir(), "aide-watch-echo-"));
  dirs.push(d);
  return d;
};

test("a file last changed before the watch opened is an echo", () => {
  const d = root();
  writeFileSync(join(d, "1-description.md"), "x");
  expect(isEcho(d, "1-description.md", Date.now() + 1000)).toBe(true);
});

test("a file changed after the watch opened is news", () => {
  const d = root();
  const openedAt = Date.now() - 1000;
  writeFileSync(join(d, "1-description.md"), "x");
  expect(isEcho(d, "1-description.md", openedAt)).toBe(false);
});

test("a path that is gone is news: a move's source, a deletion", () => {
  expect(isEcho(root(), "01-moved-away", Date.now() + 1000)).toBe(false);
});

test("an old file whose inode changed after the watch opened is news", () => {
  const d = root();
  const f = join(d, "4-status.md");
  writeFileSync(f, "x");
  const old = new Date(Date.now() - 60_000);
  utimesSync(f, old, old);
  expect(isEcho(d, "4-status.md", Date.now() - 1000)).toBe(false);
});

test("a change the watch cannot name is news", () => {
  expect(isEcho(root(), null, Date.now() + 1000)).toBe(false);
});
