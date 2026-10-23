// `lookAtPages` photographs every page it is given at a desktop and a phone
// width, so a person (or the session) can see how a changed page looks at both.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { lookAtPages } from "../../../scripts/look-at-pages.ts";
import { browserDeadline } from "../../helpers/browser-deadline.ts";

browserDeadline();

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

/** A PNG's width, read from its IHDR chunk. */
const widthOf = (file: string): number => readFileSync(file).readUInt32BE(16);

test("every page is taken at 1440 px and at a narrower phone width, and an earlier round is replaced (AC-1)", async () => {
  const out = mkdtempSync(join(tmpdir(), "look-at-pages-e2e-"));
  const paths = ["/", "/specs"];

  const taken = await lookAtPages({ scene: {}, out, paths, browser });
  expect(taken).toBe(true);
  const files = readdirSync(out).filter((f) => f.endsWith(".png")).sort();
  expect(files).toHaveLength(4);

  const desktop = files.filter((f) => f.endsWith("-1440.png"));
  const phone = files.filter((f) => f.endsWith("-390.png"));
  expect(desktop).toHaveLength(2);
  expect(phone).toHaveLength(2);
  for (const f of desktop) expect(widthOf(join(out, f))).toBe(1440);
  for (const f of phone) {
    expect(widthOf(join(out, f))).toBeGreaterThanOrEqual(390);
    expect(widthOf(join(out, f))).toBeLessThan(1440);
  }

  await lookAtPages({ scene: {}, out, paths: ["/"], browser });
  expect(readdirSync(out).filter((f) => f.endsWith(".png"))).toHaveLength(2);
});
