// Spec 388, REQ-9: a branch pushed only to origin — never fetched into
// the checkout the round runs from — must be fetched and tracked
// locally, not refused. Builds a throwaway bare "origin" and an AIDE
// checkout cloned from it BEFORE the branch is pushed, so the clone's
// own remote-tracking refs genuinely know nothing about it — the exact
// gap REQ-9 closes. A decoy already holding the round's chosen port
// (the same trick refuses-a-stolen-port.test.ts uses) gives a fast,
// deterministic failure once the branch check has passed, so this test
// never waits out a real board coming up.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(20_000);

const RUN = join(import.meta.dir, "run");
const dirs: string[] = [];

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} in ${cwd} failed: ${proc.stderr.toString()}`);
  }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function decoyPort() {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ jobs: [] }) });
  return { port: server.port, stop: () => server.stop(true) };
}

async function runToExit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd: ["/bin/bash", RUN, ...args], stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("spec 388, REQ-9: a branch that exists only on origin", () => {
  test("is fetched and tracked instead of refused", async () => {
    const originBare = tmp("aide-round-origin-");
    git(originBare, ["init", "-q", "--bare", "-b", "main"]);

    const seed = tmp("aide-round-seed-");
    git(seed, ["init", "-q", "-b", "main"]);
    mkdirSync(join(seed, "dashboard", "src", "serve"), { recursive: true });
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "");
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "baseline"]);
    git(seed, ["remote", "add", "origin", originBare]);
    git(seed, ["push", "-q", "origin", "main"]);

    // Cloned BEFORE the branch is pushed — this checkout's own
    // refs/remotes/origin/* genuinely has never heard of it.
    const aide = tmp("aide-round-aide-");
    git(tmpdir(), ["clone", "-q", originBare, aide]);

    // Now push the branch, from the seed checkout, after AIDE was cloned.
    git(seed, ["checkout", "-q", "-b", "feature-x"]);
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "// feature-x\n");
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "feature-x work"]);
    git(seed, ["push", "-q", "origin", "feature-x"]);

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
      // whatever REQ-10-style refusal the held port produces next is
      // this test's proof that REQ-9's own gate was cleared, not that
      // the whole round finished.
      git(aide, ["show-ref", "--verify", "--quiet", "refs/heads/feature-x"]);
    } finally {
      decoy.stop();
    }
  });

  test("a branch absent from both the checkout and its origin is still refused", async () => {
    const originBare = tmp("aide-round-origin-");
    git(originBare, ["init", "-q", "--bare", "-b", "main"]);
    const seed = tmp("aide-round-seed-");
    git(seed, ["init", "-q", "-b", "main"]);
    mkdirSync(join(seed, "dashboard", "src", "serve"), { recursive: true });
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "");
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "baseline"]);
    git(seed, ["remote", "add", "origin", originBare]);
    git(seed, ["push", "-q", "origin", "main"]);
    const aide = tmp("aide-round-aide-");
    git(tmpdir(), ["clone", "-q", originBare, aide]);

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
    const originBare = tmp("aide-round-origin-");
    git(originBare, ["init", "-q", "--bare", "-b", "main"]);

    const seed = tmp("aide-round-seed-");
    git(seed, ["init", "-q", "-b", "main"]);
    mkdirSync(join(seed, "dashboard", "src", "serve"), { recursive: true });
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "");
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "baseline"]);
    git(seed, ["remote", "add", "origin", originBare]);
    git(seed, ["push", "-q", "origin", "main"]);
    git(seed, ["checkout", "-q", "-b", "feature-x"]);
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "// first\n");
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "first"]);
    git(seed, ["push", "-q", "origin", "feature-x"]);

    // The checkout the round runs from knows the branch at its FIRST tip.
    const aide = tmp("aide-round-aide-");
    git(tmpdir(), ["clone", "-q", originBare, aide]);
    git(aide, ["branch", "-q", "feature-x", "origin/feature-x"]);
    const older = Bun.spawnSync({ cmd: ["git", "-C", aide, "rev-parse", "feature-x"] }).stdout.toString().trim();

    // And then the branch moves on origin.
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "// second\n");
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "second"]);
    git(seed, ["push", "-q", "origin", "feature-x"]);
    const newer = Bun.spawnSync({ cmd: ["git", "-C", seed, "rev-parse", "feature-x"] }).stdout.toString().trim();
    expect(newer).not.toBe(older);

    const decoy = decoyPort();
    try {
      await runToExit([aide, "--branch", "feature-x", "--port", String(decoy.port), "--timeout", "5"]);
    } finally {
      decoy.stop();
    }
    const served = Bun.spawnSync({ cmd: ["git", "-C", aide, "rev-parse", "feature-x"] }).stdout.toString().trim();
    expect(served).toBe(newer);
  });
});
