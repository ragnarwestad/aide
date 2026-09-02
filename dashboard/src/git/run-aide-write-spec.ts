// spec 355 (REQ-4): the dashboard's own caller of `aide-write-spec` —
// landing `4-status.md` through the same script every skill already
// uses, purely to get the `4-status.json` text it derives, rather than
// computing that derivation a second time in TypeScript (which would
// be exactly the second, independent implementation this spec exists
// to retire).
//
// `aide-write-spec` only knows how to write a REAL file at a resolved
// `<specs-root>/<folder>/<file>` path — it has no dry-run mode. Both of
// the tick route's two write shapes (an open `aide/<folder>` branch,
// landed purely through git plumbing with no working tree touched at
// all; and the ordinary case, landed through `saveSpecFiles` against
// the dashboard's own checkout) need the SAME derived text without
// either of them wanting the script's own mv to be the thing that
// actually lands it — the branch case has no working tree copy of the
// branch's content to run the script against, and the ordinary case's
// commit is `saveSpecFiles`'s to make, in the same commit as the prose.
//
// So this runs the script against a throwaway scratch directory,
// invented for the call and discarded once its stdout is read — never
// the caller's real specs root. This is still "a side effect of landing
// `4-status.md`" exactly as REQ-2 frames it (the state file is never a
// `--file` a caller names directly); it just lands in scratch space
// because the REAL landing, on a branch or on `main`, is git plumbing
// this module has nothing to do with.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export interface AideWriteSpecResult {
  ok: boolean;
  /** The `4-status.json` text the script derived from `content` —
   *  present only when `ok` and `file === "4-status.md"`. */
  stateJson?: string;
  error?: string;
}

/** Resolved by bare name through PATH, the same way `createGitRunner`
 *  resolves `git` — every host running the dashboard already has
 *  `aide-write-spec` on PATH, since the global install
 *  (`dashboard/CLAUDE.md`, "What gets installed where") puts every
 *  `core/scripts/` script in `~/.local/bin/` before the dashboard
 *  itself can run. `AIDE_WRITE_SPEC_BIN` overrides it for a test's own
 *  stub, the same escape hatch `queueRunnerBin` gives the long-running
 *  runner. */
function resolveBin(): string {
  if (process.env.AIDE_WRITE_SPEC_BIN) return process.env.AIDE_WRITE_SPEC_BIN;
  // launchd's PATH has no ~/.local/bin, which is where the installer
  // puts the script: a bare name found nothing on the serving host, and
  // every tick from the Checks tab was refused (2026-09-02). The same
  // resolution install-after-merge.sh already hardcodes for bun.
  const installed = join(process.env.HOME || homedir(), ".local", "bin", "aide-write-spec");
  return existsSync(installed) ? installed : "aide-write-spec";
}

/** Pipes `content` to a scratch `aide-write-spec --file <file>` run and
 *  returns what it derived. Never throws: a spawn failure, a non-zero
 *  exit or unparseable output all come back as `{ ok: false, error }`,
 *  the same "refuse, do not commit" shape every other write path here
 *  already returns — the caller decides what "refuse" means for its
 *  own commit. */
export async function runAideWriteSpec(folder: string, file: string, content: string): Promise<AideWriteSpecResult> {
  const bin = resolveBin();
  let scratchDir: string | null = null;
  try {
    scratchDir = mkdtempSync(join(tmpdir(), "aide-write-spec-scratch-"));
    const specDir = join(scratchDir, folder);
    Bun.spawnSync({ cmd: ["mkdir", "-p", specDir] });
    // A placeholder — only its EXISTENCE matters to the script's
    // dual-location resolution; its content is replaced by `content`
    // the moment the script runs.
    writeFileSync(join(specDir, file), "");

    let proc;
    try {
      proc = Bun.spawn({
        cmd: [bin, "--specs-root", scratchDir, "--folder", folder, "--file", file],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (e) {
      return { ok: false, error: `could not run ${bin}: ${String(e)}` };
    }
    proc.stdin.write(content);
    await proc.stdin.end();
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    const line = stdout.trim().split("\n").pop() ?? "";
    let parsed: { ok?: boolean; error?: string; stateJson?: string } = {};
    try {
      parsed = line ? JSON.parse(line) : {};
    } catch {
      return { ok: false, error: `${bin} produced no readable result: ${stderr || stdout}` };
    }
    if (code !== 0 || !parsed.ok) {
      return { ok: false, error: parsed.error ?? `${bin} exited ${code}` };
    }
    return { ok: true, stateJson: parsed.stateJson };
  } finally {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  }
}
