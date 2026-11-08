// The suite's own runner keeps the files that start a browser in a pool
// of their own (`scripts/run-tests.sh`).
//
// Dealt round-robin with everything else, which worker carried which
// browser followed from the file COUNT: adding any test file anywhere —
// a doc guard, a unit test — reshuffled them, and a run that had been
// green twice lost 22 tests to hook timeouts on the third. What times
// out is the chromium launch, so the pool is capped and its files get a
// longer deadline than a unit test's.
//
// This test is the pairing: the runner finds those files by a pattern,
// and a browser test the pattern misses is one that goes back into the
// general pool without anybody noticing.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

const runner = readFileSync(join(import.meta.dir, "../../scripts/run-tests.sh"), "utf-8");

/** Every test file that imports playwright, and so starts a browser.
 *
 *  This file is left out by name: it names the import it looks for, so a
 *  search by text finds itself, and it starts no browser. */
const SELF = "test/design/browser-tests-have-their-own-pool.test.ts";

function browserTests(): string[] {
  const found: string[] = [];
  for (const dir of ["src", "test"]) {
    for (const file of new Glob("**/*.test.ts").scanSync(join(import.meta.dir, "../..", dir))) {
      const path = join(dir, file);
      if (path === SELF) continue;
      if (readFileSync(join(import.meta.dir, "../..", path), "utf-8").includes('from "playwright"')) {
        found.push(path);
      }
    }
  }
  return found.sort();
}

describe("the runner's browser pool", () => {
  test("every file that starts a browser is one the runner's pattern finds", () => {
    const pattern = runner.match(/grep -q '([^']+)' "\$f"/)?.[1];
    expect(pattern).toBeDefined();

    const missed = browserTests().filter((path) =>
      !readFileSync(join(import.meta.dir, "../..", path), "utf-8").includes(pattern!),
    );
    expect(missed).toEqual([]);
  });

  // `make test` leaves `test/e2e/` out and a landing runs it: a browser
  // file anywhere else would run in a step's own suite after all.
  test("every file that starts a browser lives under test/e2e", () => {
    expect(browserTests().filter((path) => !path.startsWith("test/e2e/"))).toEqual([]);
  });

  test("there are browser tests to pool in the first place", () => {
    // The guard above passes trivially on an empty list, and the day
    // these tests are all deleted is the day the pool can go too.
    expect(browserTests().length).toBeGreaterThan(5);
  });

  test("the pool is capped", () => {
    const browserWorkers = runner.match(/BROWSER_WORKERS=\$\{AIDE_TEST_BROWSER_WORKERS:-(\d+)\}/)?.[1];

    expect(Number(browserWorkers)).toBeGreaterThan(0);
  });

  // What actually decides a browser test's deadline: bun's own
  // `--timeout` is overridden by whatever the file itself sets, so a
  // file naming its own number is a file the pool cannot help.
  test("no browser test sets a deadline of its own", () => {
    const offenders = browserTests().filter((path) =>
      readFileSync(join(import.meta.dir, "../..", path), "utf-8").includes("setDefaultTimeout("),
    );
    expect(offenders).toEqual([]);
  });

  // The second deadline these files keep: a bounded wait around a
  // browser call, so a wedged one reads as a hang rather than as a bare
  // timeout. Twelve files kept a copy of it with a number of their own,
  // and 10 s is a navigation a loaded machine makes honestly.
  test("no browser test keeps a wait of its own around a browser call", () => {
    const offenders = browserTests().filter((path) =>
      readFileSync(join(import.meta.dir, "../..", path), "utf-8").includes("function withTimeout"),
    );
    expect(offenders).toEqual([]);
  });

  test("they share one deadline, and it is longer than a unit test's", () => {
    const limit = Number(runner.match(/^LIMIT=(\d+)$/m)?.[1]);
    const shared = readFileSync(join(import.meta.dir, "../helpers/browser-deadline.ts"), "utf-8");
    const deadline = Number(shared.match(/BROWSER_DEADLINE_MS = ([\d_]+)/)?.[1]?.replace(/_/g, ""));

    expect(deadline).toBeGreaterThan(limit);
    // And every one of them takes it from there.
    const missing = browserTests().filter((path) =>
      !readFileSync(join(import.meta.dir, "../..", path), "utf-8").includes("browserDeadline()"),
    );
    expect(missing).toEqual([]);
  });
});
