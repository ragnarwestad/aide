// What the tests of the round's `run` script set up alike: throwaway
// folders, git in a folder, a port a decoy holds, and an origin whose main
// carries an empty `dashboard/src/serve/serve.ts`.
import { afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Registers the `afterEach` removal in the calling file, and returns
 *  `tmp(prefix)`, which makes a folder removed after the test. */
export function roundTemps(): (prefix: string) => string {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  return (prefix) => {
    const d = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(d);
    return d;
  };
}

/** Runs git in `cwd`; throws with git's own words when it fails. */
export function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} in ${cwd} failed: ${proc.stderr.toString()}`);
  }
}

/** A port another server holds, so a round that got that far stops on
 *  its own "port already held" check instead of serving. */
export function decoyPort() {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ jobs: [] }) });
  return { port: server.port!, stop: () => server.stop(true) };
}

/** Commits everything in `seed` as `message` and pushes `branch` to origin. */
export function commitAndPush(seed: string, branch: string, message: string): void {
  git(seed, ["add", "-A"]);
  git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", message]);
  git(seed, ["push", "-q", "origin", branch]);
}

/** A bare origin, and a seed checkout that pushed main to it with an empty
 *  `serve.ts` and whatever `write` adds. */
export function seededOrigin(tmp: (prefix: string) => string, write: (seed: string) => void = () => {}) {
  const originBare = tmp("aide-round-origin-");
  git(originBare, ["init", "-q", "--bare", "-b", "main"]);
  const seed = tmp("aide-round-seed-");
  git(seed, ["init", "-q", "-b", "main"]);
  mkdirSync(join(seed, "dashboard", "src", "serve"), { recursive: true });
  writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "");
  write(seed);
  git(seed, ["remote", "add", "origin", originBare]);
  commitAndPush(seed, "main", "baseline");
  return { originBare, seed };
}

/** A fresh clone of `originBare`: the checkout a round runs from. */
export function cloneOf(tmp: (prefix: string) => string, originBare: string): string {
  const aide = tmp("aide-round-aide-");
  git(tmpdir(), ["clone", "-q", originBare, aide]);
  return aide;
}
