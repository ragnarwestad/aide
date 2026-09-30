// Deploy's fetch asks whether a checkout's merge lock is free before it
// queues behind it: a landing holds that lock through its test run.
import { describe, expect, test } from "bun:test";
import { createRootLock, rootFreeWithin } from "../../../src/serve/serve-helpers";

describe("rootFreeWithin", () => {
  test("a root nothing holds is free at once", async () => {
    expect(await rootFreeWithin(createRootLock(), "/repo", 0)).toBe(true);
  });

  test("a root let go of within the wait is free", async () => {
    const lock = createRootLock();
    void lock.run("/repo", () => new Promise((r) => setTimeout(r, 30)));
    expect(await rootFreeWithin(lock, "/repo", 500, 10)).toBe(true);
  });

  test("a root still held when the wait is over is not, and another root is not held up by it", async () => {
    const lock = createRootLock();
    let release = () => {};
    void lock.run("/repo", () => new Promise<void>((r) => (release = r)));
    expect(await rootFreeWithin(lock, "/repo", 40, 10)).toBe(false);
    expect(await rootFreeWithin(lock, "/other", 0)).toBe(true);
    release();
  });
});
