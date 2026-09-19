// `.env.deploy` answers the questions the Makefile refuses to guess.
// One of those answers is read by a SHELL script, not by make, and make
// does not hand its own variables to a recipe's shell unless told to —
// so a value that is plainly set can still be invisible where it is
// used. This asserts it arrives.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

// A throwaway makefile that both SETS the variable and prints what the
// recipe's shell can see, loaded alongside the real one. Setting it in
// a makefile is the point: that is what `.env.deploy` does, and it is
// the case `export` is needed for. A value passed on make's command
// line would be exported automatically and prove nothing.
function probe(assignment: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-mk-"));
  try {
    const mk = join(dir, "probe.mk");
    writeFileSync(mk, `${assignment}\nprobe:\n\t@echo "[$$AIDE_DASH_HOST]"\n`);
    const env = { ...process.env };
    delete env.AIDE_DASH_HOST;
    const res = Bun.spawnSync(["make", "-f", "Makefile", "-f", mk, "probe"], { cwd: ROOT, env });
    return new TextDecoder().decode(res.stdout).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the deploy variables reach the scripts that read them", () => {
  // The probe assigns LAST, so it wins over whatever `.env.deploy` this
  // machine happens to have — the test must not depend on the developer
  // not having one. What rsync-publish.sh does with an empty value is
  // its own test's business (test/rsync-publish-guard.test.ts).
  test("AIDE_DASH_HOST set the way .env.deploy sets it arrives in the recipe's shell", () => {
    expect(probe("AIDE_DASH_HOST=example-host")).toBe("[example-host]");
  });
});

// The table in docs/hosting.md is what an operator reads before a
// deploy, and a default that has moved in the Makefile leaves them
// setting a variable to what it already was — or, worse, trusting a
// path that is not the one the deploy uses. `REMOTE_STATE` said
// `aide-dashboard` while the Makefile said `.aide/dashboard`.
describe("the deploy table says what the Makefile says", () => {
  const makefile = readFileSync(join(ROOT, "Makefile"), "utf-8");
  const doc = readFileSync(join(ROOT, "docs", "hosting.md"), "utf-8");

  /** Every `VAR ?= value` the Makefile declares. */
  const declared = new Map<string, string>(
    [...makefile.matchAll(/^([A-Z_]+) \?= (.*)$/gm)].map((m) => [m[1]!, m[2]!.trim()]),
  );
  /** Every row of the variables table, as variable and default. */
  const documented = new Map<string, string>(
    [...doc.matchAll(/^\| `([A-Z_]+)` *\| `([^`]+)` *\|/gm)].map((m) => [m[1]!, m[2]!.trim()]),
  );

  test("the table covers the variables an operator overrides", () => {
    expect([...documented.keys()]).toContain("REMOTE_STATE");
    expect([...documented.keys()]).toContain("BIND");
  });

  test.each([...documented.keys()].filter((name) => declared.has(name)))(
    "%s has the Makefile's own default",
    (name) => {
      expect(documented.get(name)).toBe(declared.get(name));
    },
  );
});
