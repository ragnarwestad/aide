// Spec 424: `run` passes `--test-board <folder>` to its `serve.ts serve`
// invocation whenever it was given `--branch` — the folder the header
// needs to say which spec/branch this board is for, and the self-stop
// route needs to know it may act at all.
//
// `AIDE_ROUND_BUN` points `run` at a fake `bun` that records its own
// argv (one line per invocation) and, for the `serve.ts serve`
// invocation only, tries to bind the given `--port` — which the decoy
// server below already holds, the same trick
// `refuses-a-stolen-port.test.ts` uses, so the round's own health check
// (a real `curl` against `/api/queue`, up to 40 times over ~20s per
// `run:215-217`) is answered instantly by the DECOY rather than waited
// out, and `run` fails fast on its own "port already held" check right
// after — well before it would otherwise reach queuing the fixture
// specs.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

/** Records every invocation's argv to `$FAKE_BUN_LOG`; for a `serve.ts
 *  serve` invocation it also tries to bind `--port`, which fails fast
 *  against the decoy already holding it. `run` execs it, and macOS checks
 *  a new executable the first time it starts — for minutes on a busy
 *  machine, past this file's own timeout, which is what stopped 498's
 *  landing (2026-09-19). So it lives at a fixed path and is rewritten only
 *  when its text changes: the check is paid once on a machine. */
const FAKE_BUN =
  `#!/usr/bin/env bash\n` +
  `printf '%s\\n' "$*" >> "$FAKE_BUN_LOG"\n` +
  `if [ "\${2:-}" = "src/serve/serve.ts" ]; then\n` +
  `  port=""; prev=""\n` +
  `  for a in "$@"; do [ "$prev" = "--port" ] && port="$a"; prev="$a"; done\n` +
  `  REALBUN="$(command -v bun)"\n` +
  // Gone on its own after a while: a round kept with --keep leaves it
  // up, and a test that timed out never stopped it.
  `  exec "$REALBUN" -e "Bun.serve({ port: $port, hostname: '127.0.0.1', fetch: () => new Response('ok') }); setTimeout(() => process.exit(0), 15000);"\n` +
  `fi\n` +
  `exit 0\n`;
function fakeBun(): string {
  const binPath = join(homedir(), "Library", "Caches", "aide-tests", "fake-bun");
  if (!existsSync(binPath) || readFileSync(binPath, "utf-8") !== FAKE_BUN) {
    mkdirSync(join(binPath, ".."), { recursive: true });
    const staged = `${binPath}.${process.pid}`;
    writeFileSync(staged, FAKE_BUN);
    chmodSync(staged, 0o755);
    renameSync(staged, binPath);
  }
  return binPath;
}

/** The served checkout's own argument parser, with or without the
 *  `--test-board` flag — what `run` reads to decide whether the branch
 *  can be handed it. */
function writeParseArgs(checkout: string, knowsTestBoard: boolean): void {
  const dir = join(checkout, "dashboard", "src", "serve", "serve-helpers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "parse-args.ts"),
    knowsTestBoard
      ? `else if (a === "--test-board" && v) opts.testBoardSpec = argv[++i];\n`
      : `else if (a === "--port" && v) opts.port = Number(argv[++i]);\n`,
  );
}

/** Every process still running from this one round — its own watcher,
 *  or the server it started — named by the round's own temp checkout,
 *  which only it carries on its command line. */
function leftovers(aide: string): string[] {
  const ps = Bun.spawnSync({ cmd: ["ps", "-axo", "pid=,command="], stdout: "pipe" }).stdout.toString();
  return ps.split("\n").filter((l) => l.includes(aide));
}

async function runToExit(args: string[], env: Record<string, string>): Promise<{ code: number }> {
  const proc = Bun.spawn({
    cmd: ["/bin/bash", RUN, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const code = await proc.exited;
  return { code };
}

describe("spec 424: run passes --test-board to its serve.ts serve invocation", () => {
  test("when given --branch, the invocation carries --test-board <folder>", async () => {
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
    git(seed, ["checkout", "-q", "-b", "424-headeren-sier-hvilket-board"]);
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "// board\n");
    writeParseArgs(seed, true);
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "board work"]);
    git(seed, ["push", "-q", "origin", "424-headeren-sier-hvilket-board"]);

    const aide = tmp("aide-round-aide-");
    git(tmpdir(), ["clone", "-q", originBare, aide]);

    const scratch = tmp("aide-round-fakebun-");
    const logPath = join(scratch, "argv.log");
    const binPath = fakeBun();

    const decoy = decoyPort();
    try {
      const { code } = await runToExit(
        [aide, "--branch", "424-headeren-sier-hvilket-board", "--port", String(decoy.port), "--timeout", "5"],
        { AIDE_ROUND_BUN: binPath, FAKE_BUN_LOG: logPath },
      );
      // The decoy's own port-already-held refusal — proof this test never
      // waited out a real board coming up, not proof of the round's own
      // success.
      expect(code).toBe(1);

      // A round that ends leaves nothing of itself running: kept, each
      // left a watcher waiting on its stub server (five of them, eight
      // hours, 2026-09-19).
      expect(leftovers(aide)).toEqual([]);
      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      const serveLine = lines.find((l) => l.includes("src/serve/serve.ts") && l.includes("serve"));
      expect(serveLine).toContain("--test-board 424-headeren-sier-hvilket-board");
    } finally {
      await decoy.stop();
    }
  });

  // A branch cut before spec 424 landed: its serve.ts refuses an
  // argument it does not know, so the round must not hand it one — the
  // board then comes up without the header line and the Stop button
  // rather than not at all (426, 2026-09-09).
  test("a branch whose serve.ts does not know --test-board is not handed it", async () => {
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
    git(seed, ["checkout", "-q", "-b", "426-older-branch"]);
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "// older\n");
    writeParseArgs(seed, false);
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "older work"]);
    git(seed, ["push", "-q", "origin", "426-older-branch"]);
    const aide = tmp("aide-round-aide-");
    git(tmpdir(), ["clone", "-q", originBare, aide]);

    const scratch = tmp("aide-round-fakebun-");
    const logPath = join(scratch, "argv.log");
    const binPath = fakeBun();

    const decoy = decoyPort();
    try {
      await runToExit(
        [aide, "--branch", "426-older-branch", "--port", String(decoy.port), "--timeout", "5"],
        { AIDE_ROUND_BUN: binPath, FAKE_BUN_LOG: logPath },
      );
      // A round that ends leaves nothing of itself running: kept, each
      // left a watcher waiting on its stub server (five of them, eight
      // hours, 2026-09-19).
      expect(leftovers(aide)).toEqual([]);
      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      const serveLine = lines.find((l) => l.includes("src/serve/serve.ts") && l.includes("serve"));
      expect(serveLine).toBeDefined();
      for (const line of lines) expect(line).not.toContain("--test-board");
    } finally {
      await decoy.stop();
    }
  });

  // Every board the round starts is a test board (2026-09-10): with no
  // --branch the checkout's own folder name is the label, which the
  // header shows as just "Test".
  test("with no --branch, the invocation carries --test-board <checkout folder>", async () => {
    const originBare = tmp("aide-round-origin-");
    git(originBare, ["init", "-q", "--bare", "-b", "main"]);
    const seed = tmp("aide-round-seed-");
    git(seed, ["init", "-q", "-b", "main"]);
    mkdirSync(join(seed, "dashboard", "src", "serve"), { recursive: true });
    writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "");
    writeParseArgs(seed, true);
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "baseline"]);
    git(seed, ["remote", "add", "origin", originBare]);
    git(seed, ["push", "-q", "origin", "main"]);
    const aide = tmp("aide-round-aide-");
    git(tmpdir(), ["clone", "-q", originBare, aide]);

    const scratch = tmp("aide-round-fakebun-");
    const logPath = join(scratch, "argv.log");
    const binPath = fakeBun();

    const decoy = decoyPort();
    try {
      await runToExit([aide, "--port", String(decoy.port), "--timeout", "5"], {
        AIDE_ROUND_BUN: binPath,
        FAKE_BUN_LOG: logPath,
      });
      // A round that ends leaves nothing of itself running: kept, each
      // left a watcher waiting on its stub server (five of them, eight
      // hours, 2026-09-19).
      expect(leftovers(aide)).toEqual([]);
      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      const serveLine = lines.find((l) => l.includes("src/serve/serve.ts") && l.includes("serve"));
      expect(serveLine).toContain(`--test-board ${aide.split("/").pop()}`);
    } finally {
      await decoy.stop();
    }
  });
});
