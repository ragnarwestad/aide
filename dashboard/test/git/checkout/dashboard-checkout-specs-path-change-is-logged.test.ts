// The line in `.aide/config` that decides where a run makes a spec
// folder is rewritten by the board itself, on every ensure, and nothing
// used to say anything about it. On 2026-09-21 a create wrote its folder
// at the specs repository's root while the landing looked for it under
// the project's own directory, and how the root got into that file could
// not be answered at all.
//
// Two lines, for the two shapes worth reading: a value that CHANGED, and
// a value naming the specs repository's own root while that repository
// holds a directory named after the project. The second is said every
// time, because the root derives from the root — the wrong value
// reproduces itself, so "it changed" would never catch it.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGitRunner } from "../../../src/git/branch-status.ts";
import { dashboardCheckoutRoot, ensureDashboardCheckout } from "../../../src/git/dashboard-checkout.ts";
import { configValue } from "../../../src/project/discover";

const run = createGitRunner();
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "aide-specs-path-log-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
}

/** A project cloned from its own origin, with a specs repository of its
 *  own holding one folder per project — the layout this repo itself has.
 *  `specsPath` is what the checkout's config says before the ensure. */
function world(specsPath: (specsRepo: string) => string) {
  const where = tmp();
  const seed = join(where, "seed");
  mkdirSync(seed, { recursive: true });
  writeFileSync(join(seed, "README.md"), "hi\n");
  git(seed, "init", "-q", "-b", "main");
  git(seed, "config", "user.email", "t@example.com");
  git(seed, "config", "user.name", "T");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  const origin = join(where, "origin.git");
  Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", seed, origin] });

  // The specs repository, with this project's own folder inside it.
  const specsSeed = join(where, "specs-seed");
  mkdirSync(join(specsSeed, "demo", "archive"), { recursive: true });
  writeFileSync(join(specsSeed, "demo", "archive", ".keep"), "");
  git(specsSeed, "init", "-q", "-b", "main");
  git(specsSeed, "config", "user.email", "t@example.com");
  git(specsSeed, "config", "user.name", "T");
  git(specsSeed, "add", "-A");
  git(specsSeed, "commit", "-qm", "first");
  const specsOrigin = join(where, "specs-origin.git");
  Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", specsSeed, specsOrigin] });

  const base = join(where, "owned");
  const code = dashboardCheckoutRoot(base, "demo");
  Bun.spawnSync({ cmd: ["git", "clone", "-q", origin, code] });
  const specsRepo = join(base, "demo", "specs");
  Bun.spawnSync({ cmd: ["git", "clone", "-q", specsOrigin, specsRepo] });
  mkdirSync(join(code, ".aide"), { recursive: true });
  writeFileSync(join(code, ".aide", "config"), `AIDE_SPECS_PATH=${specsPath(specsRepo)}\n`);
  return { base, code, specsRepo };
}

describe("a changed specs path in the dashboard's own checkout", () => {
  test("naming the repository's own root is said every time, with the folder beside it", async () => {
    // The state the incident left: the config naming the specs
    // REPOSITORY, where the landing looks one directory down.
    const w = world((specsRepo) => specsRepo);
    const said: string[] = [];
    const wasError = console.error;
    console.error = (...args: unknown[]) => void said.push(args.join(" "));
    try {
      await ensureDashboardCheckout(run, { base: w.base, project: "demo", personDir: w.code });
    } finally {
      console.error = wasError;
    }

    const line = said.find((s) => s.includes("names the specs repository's own root"));
    expect(line).toBeDefined();
    expect(line).toContain(w.specsRepo);
    // Said, not corrected: the value is still the one the config had.
    expect(configValue(w.code, "AIDE_SPECS_PATH")).toBe(w.specsRepo);
  });

  test("a value that changed is said with both sides of it", async () => {
    // The two-checkout layout (spec 205): the person edits their own
    // clone, the board works in its own, and the board's copy of the
    // config is rewritten to name ITS specs clone rather than theirs.
    // What the board's own copy held before this ensure — a value from
    // some earlier state of the machine, which is what the line is for.
    const w = world((specsRepo) => join(specsRepo, "demo", "archive"));
    const person = join(w.base, "..", "person");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", w.specsRepo, join(w.base, "..", "person-specs")] });
    Bun.spawnSync({ cmd: ["git", "clone", "-q", join(w.code, ".git"), person] });
    mkdirSync(join(person, ".aide"), { recursive: true });
    writeFileSync(
      join(person, ".aide", "config"),
      `AIDE_SPECS_PATH=${join(w.base, "..", "person-specs", "demo")}\n`,
    );
    const said: string[] = [];
    const wasError = console.error;
    console.error = (...args: unknown[]) => void said.push(args.join(" "));
    try {
      await ensureDashboardCheckout(run, { base: w.base, project: "demo", personDir: person });
    } finally {
      console.error = wasError;
    }

    const line = said.find((s) => s.includes("changes:"));
    expect(line).toBeDefined();
    // From what the board's copy held to what this ensure worked out.
    expect(line).toContain(join(w.specsRepo, "demo"));
  });

  test("is silent when the value is the one already there", async () => {
    const w = world((specsRepo) => join(specsRepo, "demo"));
    const said: string[] = [];
    const wasError = console.error;
    console.error = (...args: unknown[]) => void said.push(args.join(" "));
    try {
      await ensureDashboardCheckout(run, { base: w.base, project: "demo", personDir: w.code });
    } finally {
      console.error = wasError;
    }

    expect(said.filter((s) => s.includes("specs path"))).toEqual([]);
  });
});
