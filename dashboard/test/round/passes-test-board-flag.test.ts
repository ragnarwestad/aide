// `run` passes `--test-board <folder>` to its `serve.ts serve`
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
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cloneOf, commitAndPush, decoyPort, git, roundTemps, seededOrigin } from "./round-fixtures.ts";

setDefaultTimeout(20_000);

const RUN = join(import.meta.dir, "run");
const tmp = roundTemps();

/** Records every invocation's argv to `$FAKE_BUN_LOG`; for a `serve.ts
 *  serve` invocation it also tries to bind `--port`, which fails fast
 *  against the decoy already holding it. `run` execs it, and macOS checks
 *  a new executable the first time it starts — for minutes on a busy
 *  machine, past this file's own timeout, which is what stopped a
 *  landing (2026-09-19). So it lives at a fixed path and is rewritten only
 *  when its text changes: the check is paid once on a machine. */
const FAKE_BUN =
  `#!/usr/bin/env bash\n` +
  `printf '%s\\n' "$*" >> "$FAKE_BUN_LOG"\n` +
  `if [ "\${2:-}" = "src/serve/serve.ts" ]; then\n` +
  `  port=""; prev=""\n` +
  `  for a in "$@"; do [ "$prev" = "--port" ] && port="$a"; prev="$a"; done\n` +
  `  prev=""\n` +
  `  for a in "$@"; do\n` +
  `    if [ "$prev" = "--dashboard-checkouts" ] && [ -d "$a/aide-test/code/.git" ] && [ -d "$a/aide-test/specs/.git" ] && grep -q "AIDE_SPECS_PATH=$a/aide-test/specs" "$a/aide-test/code/.aide/config"; then echo owned-checkouts-ready >> "$FAKE_BUN_LOG"; fi\n` +
  `    prev="$a"\n` +
  `  done\n` +
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

/** The served checkout's flag definition, with or without `--test-board`
 *  — what `run` reads first, before the parser's source. */
function writeServeArgs(checkout: string, knowsTestBoard: boolean): void {
  const dir = join(checkout, "dashboard", "deploy");
  mkdirSync(dir, { recursive: true });
  const flags = knowsTestBoard ? ["--port", "--test-board"] : ["--port"];
  writeFileSync(join(dir, "serve-args.json"), `{\n${flags.map((f) => `  "${f}": { "takesValue": true }`).join(",\n")}\n}\n`);
}

/** A clone of an origin whose branch `branch` carries what `write` puts
 *  in the checkout. */
function cloneWithBranch(branch: string, write: (seed: string) => void): string {
  const { originBare, seed } = seededOrigin(tmp);
  git(seed, ["checkout", "-q", "-b", branch]);
  writeFileSync(join(seed, "dashboard", "src", "serve", "serve.ts"), "// branch\n");
  write(seed);
  commitAndPush(seed, branch, "branch work");
  return cloneOf(tmp, originBare);
}

/** One round of `run` on `aide` with `args`, against a decoy port: its
 *  exit code, and the argv lines the fake bun recorded. */
async function roundArgv(aide: string, args: string[]): Promise<{ code: number; lines: string[] }> {
  const logPath = join(tmp("aide-round-fakebun-"), "argv.log");
  const decoy = decoyPort();
  try {
    const { code } = await runToExit(
      [aide, ...args, "--port", String(decoy.port), "--timeout", "5"],
      { AIDE_ROUND_BUN: fakeBun(), FAKE_BUN_LOG: logPath },
    );
    // A round that ends leaves nothing of itself running: kept, each
    // left a watcher waiting on its stub server.
    expect(leftovers(aide)).toEqual([]);
    return { code, lines: readFileSync(logPath, "utf-8").trim().split("\n") };
  } finally {
    await decoy.stop();
  }
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

describe("run passes --test-board to its serve.ts serve invocation", () => {
  test("when given --branch, the invocation carries --test-board <folder>", async () => {
    const aide = cloneWithBranch("424-headeren-sier-hvilket-board", (seed) => writeParseArgs(seed, true));
    const { code, lines } = await roundArgv(aide, ["--branch", "424-headeren-sier-hvilket-board"]);
    // The decoy's own port-already-held refusal — proof this test never
    // waited out a real board coming up, not proof of the round's own
    // success.
    expect(code).toBe(1);
    const serveLine = lines.find((l) => l.includes("src/serve/serve.ts") && l.includes("serve"));
    expect(serveLine).toContain("--test-board 424-headeren-sier-hvilket-board");
    expect(lines).toContain("owned-checkouts-ready");
  });

  // A branch cut before `--test-board` existed: its serve.ts refuses an
  // argument it does not know, so the round must not hand it one — the
  // board then comes up without the header line and the Stop button
  // rather than not at all.
  test("a branch whose serve.ts does not know --test-board is not handed it", async () => {
    const aide = cloneWithBranch("426-older-branch", (seed) => writeParseArgs(seed, false));
    const { lines } = await roundArgv(aide, ["--branch", "426-older-branch"]);
    expect(lines.find((l) => l.includes("src/serve/serve.ts") && l.includes("serve"))).toBeDefined();
    for (const line of lines) expect(line).not.toContain("--test-board");
  });

  // Every board the round starts is a test board (2026-09-10): with no
  // --branch the checkout's own folder name is the label, which the
  // header shows as just "Test".
  test("with no --branch, the invocation carries --test-board <checkout folder>", async () => {
    const { originBare } = seededOrigin(tmp, (seed) => writeParseArgs(seed, true));
    const aide = cloneOf(tmp, originBare);
    const { lines } = await roundArgv(aide, []);
    const serveLine = lines.find((l) => l.includes("src/serve/serve.ts") && l.includes("serve"));
    expect(serveLine).toContain(`--test-board ${aide.split("/").pop()}`);
  });

  test("a branch whose flag definition names --test-board is handed it", async () => {
    const aide = cloneWithBranch("870-defined-flags", (seed) => writeServeArgs(seed, true));
    const { lines } = await roundArgv(aide, ["--branch", "870-defined-flags"]);
    const serveLine = lines.find((l) => l.includes("src/serve/serve.ts") && l.includes("serve"));
    expect(serveLine).toContain("--test-board 870-defined-flags");
  });

  // The definition decides, not the parser's text: a parse-args.ts that
  // mentions the flag does not make the branch accept it.
  test("a branch whose flag definition leaves --test-board out is not handed it", async () => {
    const aide = cloneWithBranch("871-defined-without", (seed) => {
      writeServeArgs(seed, false);
      writeParseArgs(seed, true);
    });
    const { lines } = await roundArgv(aide, ["--branch", "871-defined-without"]);
    expect(lines.find((l) => l.includes("src/serve/serve.ts") && l.includes("serve"))).toBeDefined();
    for (const line of lines) expect(line).not.toContain("--test-board");
  });
});
