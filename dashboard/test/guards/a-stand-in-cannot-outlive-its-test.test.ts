// A test's stand-in binary has to end on its own.
//
// The failure this exists for: two suites wrote a stand-in that waits
// for a "go" file and nothing else. `afterEach` removes the directory
// holding that file the moment the test ends, so a stand-in that had not
// noticed it yet waited on a path that no longer existed. Twenty-seven
// of them were found alive on the serving host, the oldest two days old,
// and the count grew with every suite run.
//
// Nothing about that is visible in a green suite: the tests passed every
// time. Only a guard on the SOURCE catches it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const testFiles = [...new Glob("**/*.test.ts").scanSync({ cwd: ROOT, absolute: true })];

/** A shell loop that waits for a file. Written by a test as a template
 *  literal, so the file path arrives as `${...}` and only the shape
 *  matters here. */
const WAITS_FOR_A_FILE = /while \[ ! -f [^\]]*\]/g;

describe("a stand-in a test writes cannot outlive the test", () => {
  test("the glob found the test files at all", () => {
    expect(testFiles.length).toBeGreaterThan(50);
  });

  test("every wait-for-a-file loop carries a ceiling as well", () => {
    const unbounded: string[] = [];
    for (const file of testFiles) {
      const source = readFileSync(file, "utf-8");
      for (const match of source.matchAll(WAITS_FOR_A_FILE)) {
        // The whole loop condition, up to the `; do`: a bounded one
        // carries a second test beside the file test.
        const line = source.slice(match.index, source.indexOf("; do", match.index));
        if (!/-lt |-le |-gt |timeout/.test(line)) {
          unbounded.push(`${file.slice(ROOT.length + 1)}: ${line}`);
        }
      }
    }
    expect(unbounded).toEqual([]);
  });
});
