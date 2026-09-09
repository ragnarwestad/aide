// Spec 424: `run` passes `--test-board <folder>` to BOTH its `generate`
// invocation and its `serve.ts serve` one, whenever it was given
// `--branch` — the folder the header needs to say which spec/branch this
// board is for, and the self-stop route needs to know it may act at all.
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
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** Records every invocation's argv to `logPath`; for a `serve.ts serve`
 *  invocation it also tries to bind `--port`, which fails fast against
 *  the decoy already holding it. */
function writeFakeBun(binPath: string, logPath: string): void {
  writeFileSync(
    binPath,
    `#!/usr/bin/env bash\n` +
      `printf '%s\\n' "$*" >> "${logPath}"\n` +
      `if [ "\${2:-}" = "src/serve/serve.ts" ]; then\n` +
      `  port=""; prev=""\n` +
      `  for a in "$@"; do [ "$prev" = "--port" ] && port="$a"; prev="$a"; done\n` +
      `  REALBUN="$(command -v bun)"\n` +
      `  exec "$REALBUN" -e "Bun.serve({ port: $port, hostname: '127.0.0.1', fetch: () => new Response('ok') });"\n` +
      `fi\n` +
      `exit 0\n`,
  );
  chmodSync(binPath, 0o755);
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

describe("spec 424: run passes --test-board to both its generate and serve.ts serve invocations", () => {
  test("when given --branch, both invocations carry --test-board <folder>", async () => {
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
    git(seed, ["add", "-A"]);
    git(seed, ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "board work"]);
    git(seed, ["push", "-q", "origin", "424-headeren-sier-hvilket-board"]);

    const aide = tmp("aide-round-aide-");
    git(tmpdir(), ["clone", "-q", originBare, aide]);

    const scratch = tmp("aide-round-fakebun-");
    const logPath = join(scratch, "argv.log");
    const binPath = join(scratch, "fake-bun");
    writeFakeBun(binPath, logPath);

    const decoy = decoyPort();
    try {
      const { code } = await runToExit(
        [aide, "--branch", "424-headeren-sier-hvilket-board", "--port", String(decoy.port), "--keep", "--timeout", "5"],
        { AIDE_ROUND_BUN: binPath, AIDE_ROUND_TOKEN: "test-token" },
      );
      // The decoy's own port-already-held refusal — proof this test never
      // waited out a real board coming up, not proof of the round's own
      // success.
      expect(code).toBe(1);

      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      const generateLine = lines.find((l) => l.includes("src/main.ts") && l.includes("generate"));
      const serveLine = lines.find((l) => l.includes("src/serve/serve.ts") && l.includes("serve"));
      expect(generateLine).toContain("--test-board 424-headeren-sier-hvilket-board");
      expect(serveLine).toContain("--test-board 424-headeren-sier-hvilket-board");
    } finally {
      decoy.stop();
    }
  });

  test("with no --branch, neither invocation carries --test-board", async () => {
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

    const scratch = tmp("aide-round-fakebun-");
    const logPath = join(scratch, "argv.log");
    const binPath = join(scratch, "fake-bun");
    writeFakeBun(binPath, logPath);

    const decoy = decoyPort();
    try {
      await runToExit([aide, "--port", String(decoy.port), "--keep", "--timeout", "5"], {
        AIDE_ROUND_BUN: binPath,
        AIDE_ROUND_TOKEN: "test-token",
      });
      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      for (const line of lines) expect(line).not.toContain("--test-board");
    } finally {
      decoy.stop();
    }
  });
});
