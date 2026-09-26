// How often the board refills its spec caches — every project's checkouts
// fetched and its open branches asked, one round trip to the git host each
// — and how long one answer stands.

import { expect, test } from "bun:test";
import { specCacheTimes } from "../../../src/serve/setup/schedules.ts";

test("by default the caches are refilled every five minutes, and an answer stands thirty seconds", () => {
  expect(specCacheTimes()).toEqual({ pollMs: 5 * 60_000, ttlMs: 30_000 });
});

test("an answer never stands longer than the schedule that retakes it", () => {
  expect(specCacheTimes(25)).toEqual({ pollMs: 25, ttlMs: 25 });
});

test("a schedule turned off keeps the checkers' own window", () => {
  expect(specCacheTimes(0)).toEqual({ pollMs: 0, ttlMs: 30_000 });
});
