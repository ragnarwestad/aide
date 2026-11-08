// One directory, two spellings: the landing has to see them as one root.
//
// `aide-run-spec` reports the root git handed it, and git resolves
// symlinks; the dashboard holds the path its own configuration names. On
// macOS a checkout under `$TMPDIR` is `/var/folders/...` to the
// configuration and `/private/var/folders/...` to git. Compared as
// strings those are two repositories, and the code root the landing did
// not recognise got no test gate: a suite that was red on the merge was
// pushed to main, and the spec archived, in a round on 2026-09-04.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sameRoot } from "../../src/serve/land-branch/merge.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tree(): { real: string; through: string } {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "aide-same-root-"));
  dirs.push(base);
  const real = join(base, "checkouts", "aide", "code");
  mkdirSync(real, { recursive: true });
  const link = join(base, "link");
  symlinkSync(join(base, "checkouts"), link);
  return { real, through: join(link, "aide", "code") };
}

describe("sameRoot", () => {
  test("one directory reached two ways is one root", () => {
    const { real, through } = tree();
    expect(real).not.toBe(through);
    expect(sameRoot(real, through)).toBe(true);
    expect(sameRoot(through, real)).toBe(true);
  });

  test("two different directories stay different", () => {
    const { real } = tree();
    expect(sameRoot(real, join(real, "..", "specs"))).toBe(false);
  });

  test("a path that no longer exists compares as the string it is", () => {
    const gone = join(tmpdir(), "aide-same-root-gone-0000", "code");
    expect(sameRoot(gone, gone)).toBe(true);
    expect(sameRoot(gone, `${gone}-other`)).toBe(false);
  });
});
