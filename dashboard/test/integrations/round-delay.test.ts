// How long the round's stand-in model waits before each step: one of a
// few choices, kept in a file the stand-in reads at every step, and
// moved on by one with every press.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DELAY_CHOICES, nextDelay, readDelay, writeDelay } from "../../src/integrations/round-delay.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const file = () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-round-delay-"));
  dirs.push(dir);
  return join(dir, "delay");
};

test("the choices are off, 10, 30 and 60 seconds, and a press moves to the next, round again after the last", () => {
  expect(DELAY_CHOICES).toEqual([0, 10, 30, 60]);
  expect(nextDelay(0)).toBe(10);
  expect(nextDelay(10)).toBe(30);
  expect(nextDelay(30)).toBe(60);
  expect(nextDelay(60)).toBe(0);
});

test("no file, or one that does not hold a choice, reads as off", () => {
  const f = file();
  expect(readDelay(f)).toBe(0);
  writeFileSync(f, "banana\n");
  expect(readDelay(f)).toBe(0);
  writeFileSync(f, "45\n");
  expect(readDelay(f)).toBe(0);
});

test("a choice written is the choice read, as the bare number the stand-in reads", () => {
  const f = file();
  expect(writeDelay(f, 30)).toBe(true);
  expect(readDelay(f)).toBe(30);
});

test("a value that is not a choice is refused and leaves the file as it was", () => {
  const f = file();
  writeDelay(f, 10);
  expect(writeDelay(f, 45)).toBe(false);
  expect(readDelay(f)).toBe(10);
});
