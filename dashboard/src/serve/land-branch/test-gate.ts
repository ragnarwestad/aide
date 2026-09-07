// The landing's test gate: the project's own suite, run once on the
// merged result before it is pushed. Green pushes; red drops the local
// merge, and the branch stays where implement left it.
//
// It was the archive step's gate before (core/scripts/aide-archive-spec,
// spec 329/361): every archive re-ran the whole suite against a main
// that had moved since implement's own run, and with several jobs
// landing at once the same suite ran three and four times an hour for
// one change. Here it runs exactly once per landing, on exactly what
// main is about to become.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { LANDING_GATE_TIMEOUT_MS } from "../serve-helpers.ts";
import { resolveWorktreeLinks } from "../../project/discover/config.ts";

/** Where the installer puts the scripts; launchd's PATH does not reach
 *  ~/.local/bin (the same resolution run-aide-write-spec.ts uses). */
function installed(name: string, override: string | undefined): string {
  if (override) return override;
  const path = join(process.env.HOME || homedir(), ".local", "bin", name);
  return existsSync(path) ? path : name;
}

async function runScript(
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const proc = Bun.spawn({ cmd: argv, cwd, stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
}

/** Resolve the command(s) the merged change calls for, run them through
 *  aide-record-test-run (which keeps the run's output), and say green
 *  or red. The record it writes goes
 *  to a throwaway specs root: the archive no longer reads it, and a
 *  record left in the dashboard's own specs checkout blocked a landing
 *  once (2026-09-03). */
export async function runProjectSuiteBeforePush(
  root: string,
  job: { project: string; specFolder: string },
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  // The suite runs in a throwaway worktree of the merge commit, never in
  // the live checkout: a run's own git and a fast-forward of main moved
  // that checkout under a running suite once (2026-09-03), so the tests
  // on disk changed while the code they import was already loaded, and
  // five tests failed that had nothing to do with the merge.
  const tree = await checkoutForGate(root);
  try {
    return await runSuiteIn(tree.dir, root, job);
  } finally {
    await tree.remove();
  }
}

/** A detached worktree of `root`'s HEAD, with the project's
 *  `worktreeLinks` (the gitignored directories its commands need —
 *  `.venv`, `node_modules`) linked in the same way `aide-run-spec` links
 *  them for a run, and `.aide/config` copied so the test command
 *  resolves. Falls back to the live checkout when a worktree cannot be
 *  made, saying so in the log. */
async function checkoutForGate(root: string): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "aide-landing-gate-tree-"));
  const added = await runScript(["git", "worktree", "add", "--detach", "--quiet", dir, "HEAD"], root, 60_000);
  if (added.code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    console.error(`queue: the landing's test gate could not make a worktree in ${root} — testing in the live checkout: ${(added.stderr ?? "").trim().slice(-200)}`);
    return { dir: root, remove: async () => {} };
  }
  // Where the gitignored directories actually live. `root` is a
  // worktree of its own while a landing is merging, and `.venv` and
  // `node_modules` are in the MAIN checkout — linked from `root` they
  // linked nothing, and the project's own test command came back
  // "No such file or directory". `.aide/config` is gitignored in this
  // repo for the same reason and is read the same way.
  const owner = await mainCheckoutOf(root);
  const config = [join(root, ".aide", "config"), join(owner, ".aide", "config")].find((p) => existsSync(p));
  if (config) {
    mkdirSync(join(dir, ".aide"), { recursive: true });
    copyFileSync(config, join(dir, ".aide", "config"));
  }
  for (const entry of resolveWorktreeLinks(root).links.split(/[\s,]+/).filter(Boolean)) {
    const source = [join(root, entry), join(owner, entry)].find((p) => existsSync(p));
    const target = join(dir, entry);
    if (!source || existsSync(target)) continue;
    try {
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target);
    } catch {
      // A link that cannot be made leaves the command to say what is
      // missing, exactly as a run's worktree would.
    }
  }
  return {
    dir,
    remove: async () => {
      await runScript(["git", "worktree", "remove", "--force", dir], root, 60_000);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The checkout that owns this repository's working files. For a
 *  worktree, `git rev-parse --git-common-dir` names the main checkout's
 *  own `.git`; for the main checkout it answers `.git` itself, and the
 *  answer is `root` unchanged. */
async function mainCheckoutOf(root: string): Promise<string> {
  const common = await runScript(["git", "rev-parse", "--git-common-dir"], root, 30_000);
  const out = common.stdout.trim();
  if (common.code !== 0 || !out) return root;
  const abs = isAbsolute(out) ? out : join(root, out);
  return abs.endsWith("/.git") ? dirname(abs) : root;
}

async function runSuiteIn(
  root: string,
  liveRoot: string,
  job: { project: string; specFolder: string },
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const resolver = installed("aide-resolve-test-cmd", process.env.AIDE_RESOLVE_TEST_CMD_BIN);
  const recorder = installed("aide-record-test-run", process.env.AIDE_RECORD_TEST_RUN_BIN);
  const resolved = await runScript([resolver, "--project-dir", root], root, 60_000);
  let commands: string[] = [];
  try {
    const parsed = JSON.parse(resolved.stdout.trim().split("\n").pop() ?? "{}");
    if (!parsed.ok) {
      return {
        ok: false,
        error: `the landing could not work out the test command in ${root} — ${parsed.error ?? "unknown"}`,
      };
    }
    commands = Array.isArray(parsed.commands) ? parsed.commands : [];
  } catch {
    return { ok: false, error: `the landing could not read aide-resolve-test-cmd's answer in ${root}`, detail: resolved.stderr.slice(-400) };
  }
  if (commands.length === 0) {
    // No test command anywhere (no .aide/config key, no manifest
    // testCmd:, nothing detected): nothing to run is not red. The
    // project's readiness check already says so on its page.
    return { ok: true };
  }
  const scratch = mkdtempSync(join(tmpdir(), "aide-landing-gate-"));
  try {
    mkdirSync(join(scratch, job.specFolder), { recursive: true });
    const argv = [recorder, "--project-dir", root, "--specs-root", scratch, "--folder", job.specFolder];
    for (const c of commands) argv.push("--cmd", c);
    const gate = await runScript(argv, root, LANDING_GATE_TIMEOUT_MS);
    // The run's own output, kept where the archive gate used to keep it,
    // under the same header a reader already knows.
    const log = process.env.AIDE_TEST_GATE_LOG ?? join(process.env.HOME || homedir(), "Library", "Logs", "aide-dashboard", "test-gate.log");
    try {
      mkdirSync(join(log, ".."), { recursive: true });
      appendFileSync(log, `--- ${new Date().toISOString()} ${job.project}/${job.specFolder} landing in ${liveRoot} ---\n${gate.stdout}${gate.stderr}\n`);
    } catch {
      // A log that cannot be written must not turn a green suite red.
    }
    if (gate.timedOut) {
      return { ok: false, error: `the project's tests did not finish within ${Math.round(LANDING_GATE_TIMEOUT_MS / 60_000)} minutes on the merge — nothing was pushed; the output is in ${log}` };
    }
    if (gate.code !== 0) {
      return {
        ok: false,
        // One sentence on the row: what happened, and the one move that
        // resolves it. The log's path and the caveat about a timing test
        // that lost to a busy host are for whoever goes looking, so they
        // ride in `detail` — on hover, and on the job's own page — with
        // the test output that actually names the failure.
        // No "run implement again": nothing here knows that a second
        // implement run would make the suite green. It would start from
        // the same description and the same plan, and it is never told
        // which test failed. What IS known is where the failure is
        // written down, and which press lands the work once the code
        // passes — the row offers that one and no other.
        error:
          "the project's tests are red on this merge, so nothing was pushed. " +
          "The gate log names the failing test; archive lands the work once it passes.",
        detail: [
          `The test output is in ${log}.`,
          "A timing test that lost to a busy host passes on a re-run: run the step again when the host is quieter.",
          (gate.stderr + gate.stdout).trim().slice(-600),
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    return { ok: true };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
