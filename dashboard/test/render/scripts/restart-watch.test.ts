// `restart-watch.ts`: a page showing that a Deploy waits for running jobs
// asks `/api/version` until another process answers, then loads itself
// again. Run against a fake document, fetch, timer and location.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "..", "..", "..", "src", "render", "scripts", "restart-watch.ts"), "utf-8"),
);

/** Runs the script with a notice drawn by `drawnBy` (none when null), and
 *  `answers` as what `/api/version` says, one per ask (`"down"` throws). */
async function run(drawnBy: string | null, answers: (string | "down")[]) {
  const timers: (() => Promise<void> | void)[] = [];
  let reloads = 0;
  let asked = 0;
  const document = {
    readyState: "complete",
    addEventListener: () => {},
    querySelector: (sel: string) =>
      sel === "[data-started-at]" && drawnBy ? { getAttribute: () => drawnBy } : null,
  };
  const fetch = async () => {
    const a = answers[asked++];
    if (a === undefined || a === "down") throw new Error("down");
    return { json: async () => ({ startedAt: a }) };
  };
  const setTimeout = (fn: () => Promise<void>) => void timers.push(fn);
  const location = { reload: () => void (reloads += 1) };
  new Function("document", "fetch", "setTimeout", "location", SOURCE)(document, fetch, setTimeout, location);
  // Every ask that is due, in turn, until nothing more is scheduled.
  for (let i = 0; i < 10 && timers.length; i++) await timers.shift()!();
  return { reloads: () => reloads, asked: () => asked };
}

describe("restart-watch", () => {
  test("loads the page again once another process answers, and only then", async () => {
    const r = await run("T1", ["T1", "down", "T2"]);
    expect(r.asked()).toBe(3);
    expect(r.reloads()).toBe(1);
  });

  test("keeps asking while the process that drew the notice still answers", async () => {
    const r = await run("T1", ["T1", "T1"]);
    expect(r.reloads()).toBe(0);
  });

  test("a page with no waiting notice asks nothing", async () => {
    const r = await run(null, ["T2"]);
    expect(r.asked()).toBe(0);
    expect(r.reloads()).toBe(0);
  });
});
