// A branch pushed only to origin — never fetched into
// the checkout the round runs from — must be fetched and tracked
// locally, not refused. Builds a throwaway bare "origin" and an AIDE
// checkout cloned from it BEFORE the branch is pushed, so the clone's
// own remote-tracking refs genuinely know nothing about it — the exact
// gap the fetch closes. A decoy already holding the round's chosen port
// (the same trick refuses-a-stolen-port.test.ts uses) gives a fast,
// deterministic failure once the branch check has passed, so this test
// never waits out a real board coming up.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneOf, commitAndPush, decoyPort, git, roundTemps, seededOrigin } from "./round-fixtures.ts";

setDefaultTimeout(20_000);

const RUN = join(import.meta.dir, "run");
const tmp = roundTemps();

async function runToExit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd: ["/bin/bash", RUN, ...args], stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("a branch that exists only on origin", () => {
  test("is fetched and tracked instead of refused", async () => {
    const { originBare, seed } = seededOrigin(tmp);

    // Cloned BEFORE the branch is pushed — this checkout's own
    // refs/remotes/origin/* genuinely has never heard of it.
    const aide = cloneOf(tmp, originBare);

    // Now push the branch, from the seed checkout, after AIDE was cloned.
    git(seed, ["checkout", "-q", "-b", "feature-x"]);
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "// feature-x\n");
    commitAndPush(seed, "feature-x", "feature-x work");

    // AIDE's clone has no idea feature-x exists yet.
    const beforeFetch = Bun.spawnSync({
      cmd: ["git", "-C", aide, "show-ref", "--verify", "--quiet", "refs/remotes/origin/feature-x"],
    });
    expect(beforeFetch.exitCode).not.toBe(0);

    const decoy = decoyPort();
    try {
      const { stderr } = await runToExit([aide, "--branch", "feature-x", "--port", String(decoy.port), "--timeout", "5"]);
      expect(stderr).not.toContain("no such branch");
      // The branch check fetched and tracked it locally — proceeding to
      // whatever refusal the held port produces next is
      // this test's proof that the branch gate was cleared, not that
      // the whole round finished.
      git(aide, ["show-ref", "--verify", "--quiet", "refs/heads/feature-x"]);
    } finally {
      await decoy.stop();
    }
  });

  test("a branch absent from both the checkout and its origin is still refused", async () => {
    const { originBare } = seededOrigin(tmp);
    const aide = cloneOf(tmp, originBare);

    const { code, stderr } = await runToExit([aide, "--branch", "never-existed", "--timeout", "5"]);
    expect(code).toBe(2);
    expect(stderr).toContain("no such branch: never-existed");
  });
});

// 2026-09-08: the fetch used to happen only when the local branch was
// MISSING, so a second round for the same branch served whatever that
// checkout happened to hold — an older tip, silently, while the
// dashboard's own registry said it was serving origin's. Seen twice in
// one evening: a board came up on the commit before the one just
// pushed.
describe("a branch the checkout already has, moved on since", () => {
  test("is served at origin's tip, not at the older local one", async () => {
    const { originBare, seed } = seededOrigin(tmp);
    git(seed, ["checkout", "-q", "-b", "feature-x"]);
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "// first\n");
    commitAndPush(seed, "feature-x", "first");

    // The checkout the round runs from knows the branch at its FIRST tip.
    const aide = cloneOf(tmp, originBare);
    git(aide, ["branch", "-q", "feature-x", "origin/feature-x"]);
    const older = Bun.spawnSync({ cmd: ["git", "-C", aide, "rev-parse", "feature-x"] }).stdout.toString().trim();

    // And then the branch moves on origin.
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "// second\n");
    commitAndPush(seed, "feature-x", "second");
    const newer = Bun.spawnSync({ cmd: ["git", "-C", seed, "rev-parse", "feature-x"] }).stdout.toString().trim();
    expect(newer).not.toBe(older);

    const decoy = decoyPort();
    try {
      await runToExit([aide, "--branch", "feature-x", "--port", String(decoy.port), "--timeout", "5"]);
    } finally {
      await decoy.stop();
    }
    const served = Bun.spawnSync({ cmd: ["git", "-C", aide, "rev-parse", "feature-x"] }).stdout.toString().trim();
    expect(served).toBe(newer);
  });
});
