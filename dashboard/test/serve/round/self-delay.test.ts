// The test board's Delay press: it sets how long the stand-in model
// waits before each step, in the file the round names, and refuses
// anything but a choice — or any board the round did not start.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../../helpers/queue-server.ts";

const harness = queueHarness("aide-self-delay-");
let dir: string;
let before: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-self-delay-file-"));
  before = process.env.AIDE_ROUND_DELAY_FILE;
  process.env.AIDE_ROUND_DELAY_FILE = join(dir, "delay");
});
afterEach(() => {
  harness.cleanup();
  rmSync(dir, { recursive: true, force: true });
  if (before === undefined) delete process.env.AIDE_ROUND_DELAY_FILE;
  else process.env.AIDE_ROUND_DELAY_FILE = before;
});

const press = (base: string, seconds: string) =>
  fetch(`${base}/api/self-run/delay`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ seconds }),
  });

test("a press writes the choice for the stand-in to read", async () => {
  const { base } = harness.start({ extra: { testBoardSpec: "aide-wt-run" } });
  const res = await press(base, "30");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, seconds: 30 });
  expect(readFileSync(join(dir, "delay"), "utf8")).toBe("30\n");
});

test("a value that is not a choice is refused", async () => {
  const { base } = harness.start({ extra: { testBoardSpec: "aide-wt-run" } });
  expect((await press(base, "45")).status).toBe(400);
});

test("a board that is not a test board, or one the round did not name a file for, answers 404", async () => {
  const prod = harness.start({ extra: {} });
  expect((await press(prod.base, "10")).status).toBe(404);
  harness.cleanup();
  delete process.env.AIDE_ROUND_DELAY_FILE;
  const unnamed = harness.start({ extra: { testBoardSpec: "aide-wt-run" } });
  expect((await press(unnamed.base, "10")).status).toBe(404);
});

test("a press from another site is refused like every other queue route", async () => {
  const { base } = harness.start({ extra: { testBoardSpec: "aide-wt-run" } });
  const res = await fetch(`${base}/api/self-run/delay`, { method: "POST", headers: { origin: "https://evil.example" } });
  expect(res.status).toBe(403);
});
