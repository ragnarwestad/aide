// The landing's own test run: the project's own suite, run once on the
// merged result before it is pushed. Green pushes; red drops the local
// merge, and the branch stays where implement left it.
//
// The archive step ran it before (core/scripts/aide-archive-spec,
// spec 329/361): every archive re-ran the whole suite against a main
// that had moved since implement's own run, and with several jobs
// landing at once the same suite ran three and four times an hour for
// one change. Here it runs exactly once per landing, on exactly what
// main is about to become.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { LANDING_GATE_TIMEOUT_MS } from "../serve-helpers";
import { resolveWorktreeLinks } from "../../project/discover";
import { runScript, scriptFor } from "./run-script.ts";
import { alreadySeenGreen, type GatedJob } from "./seen-green.ts";
import { runLogPath } from "../../queue/runner/run-log-path.ts";

/** Resolve the command(s) the merged change calls for, run them through
 *  aide-record-test-run (which keeps the run's output), and say green
 *  or red. The record it writes goes
 *  to a throwaway specs root: the archive no longer reads it, and a
 *  record left in the dashboard's own specs checkout blocked a landing
 *  once (2026-09-03). */
/** The lines that name what failed, out of a whole suite's output.
 *
 *  A blind tail of the two streams gave the command line and the
 *  runner's banner: `(fail)` and the `N fail` summary are written to one
 *  stream and the invocation to the other, so whichever ends up last
 *  decides what a 600-character tail catches — and it was never the
 *  failure. Picked by what the line SAYS instead, from both streams, and
 *  only then trimmed to a length a tooltip can hold.
 *
 *  The tail is kept as the fallback: a run that died before any test
 *  reported still has to say something, and its last words are all
 *  there are. */
export function failingLines(stdout: string, stderr: string, budget = 600): string {
  const lines = `${stdout}\n${stderr}`.split("\n");
  const named = lines.filter((l) => /^\(fail\)|^\s*\d+ fail\b|^error(:| TS)/.test(l.trim()) || /^\s*\d+ fail\b/.test(l));
  const picked = named.length ? named : lines;
  const out = picked.join("\n").trim();
  // The END of the picked lines, not the start: a suite with many
  // failures ends with the summary, and the summary is the line that
  // says how many there were.
  return out.length <= budget ? out : out.slice(-budget);
}

/** `retriedAfter`: green only on the second run, and these are the
 *  lines the first run failed on. */
export interface GateVerdict {
  ok: boolean;
  error?: string;
  detail?: string;
  retriedAfter?: string;
}

export async function runProjectSuiteBeforePush(
  root: string,
  job: GatedJob,
  branch: string,
  opts: { scriptDir?: string } = {},
): Promise<GateVerdict> {
  // The suite runs in a throwaway worktree of the merge commit, never in
  // the live checkout: a run's own git and a fast-forward of main moved
  // that checkout under a running suite once (2026-09-03), so the tests
  // on disk changed while the code they import was already loaded, and
  // five tests failed that had nothing to do with the merge.
  const tree = await checkoutForGate(root);
  try {
    return await runSuiteIn(tree.dir, root, job, branch, opts);
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
async function checkoutForGate(root: string, ref = "HEAD"): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "aide-landing-gate-tree-"));
  const added = await runScript(["git", "worktree", "add", "--detach", "--quiet", dir, ref], root, 60_000);
  if (added.code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    console.error(`queue: the landing's test run could not make a worktree in ${root} — testing in the live checkout: ${(added.stderr ?? "").trim().slice(-200)}`);
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
  // Spec 512: a project that keeps its settings in the dashboard has an
  // untracked `.aide/project.yaml` in the checkout, which a worktree of
  // HEAD does not carry — and a tree with none finds no test command,
  // which is "nothing to run", a landing merged untested. Copied in
  // under the runner's rule (`carry_manifest_into_worktree`): tracked in
  // the tree or git unable to say → leave it alone; untracked with a
  // source → copy it. The links are read from the tree afterwards, so
  // the ones the copy names are made too.
  const manifestSource = [join(root, ".aide", "project.yaml"), join(owner, ".aide", "project.yaml")].find((p) => existsSync(p));
  if (manifestSource) {
    const tracked = await runScript(["git", "ls-files", "--error-unmatch", "--", ".aide/project.yaml"], dir, 30_000);
    if (tracked.code === 1) {
      mkdirSync(join(dir, ".aide"), { recursive: true });
      copyFileSync(manifestSource, join(dir, ".aide", "project.yaml"));
    }
  }
  for (const entry of resolveWorktreeLinks(dir).links.split(/[\s,]+/).filter(Boolean)) {
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

/** The default branch as origin has it, or the local one where there is
 *  no origin: main without the spec being landed. */
async function defaultBranchRef(root: string): Promise<string | null> {
  const head = await runScript(["git", "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], root, 30_000);
  const candidates = [head.stdout.trim(), "refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master"];
  for (const ref of candidates.filter(Boolean)) {
    if ((await runScript(["git", "show-ref", "--verify", "--quiet", ref], root, 30_000)).code === 0) return ref;
  }
  return null;
}

/** Whether the same commands are red on the default branch alone — run
 *  after a landing's own run and its retry were both red, so the row can
 *  say a failure main already had is not the spec's. `recorder` and
 *  `argTail` are the landing's own run, less its `--project-dir <root>`. Anything that stops
 *  the question being answered reads as "no": the ordinary sentence. */
async function redOnDefaultBranch(liveRoot: string, recorder: string, argTail: string[]): Promise<boolean> {
  const ref = await defaultBranchRef(liveRoot);
  if (!ref) return false;
  const tree = await checkoutForGate(liveRoot, ref);
  if (tree.dir === liveRoot) return false;
  try {
    const out = await runScript([recorder, "--project-dir", tree.dir, ...argTail], tree.dir, LANDING_GATE_TIMEOUT_MS, undefined, testWorkers());
    return out.code !== 0 && !out.timedOut;
  } finally {
    await tree.remove();
  }
}

/** Four test processes, as the step's own run uses (run-spec-step-tests.sh):
 *  a landing runs while specs are running, and a suite on every core
 *  starves them. */
function testWorkers(): Record<string, string> {
  return {
    AIDE_TEST_WORKERS: process.env.AIDE_TEST_WORKERS ?? "4",
    PYTEST_XDIST_AUTO_NUM_WORKERS: process.env.PYTEST_XDIST_AUTO_NUM_WORKERS ?? "4",
  };
}

/** A line in the landed step's own run log, stamped the way `aide-run-spec`
 *  stamps its own, so the step's Log shows the landing under "tests and
 *  commit". `error` marks a red one. Best effort: a log that cannot be
 *  written leaves the landing as it was.
 *
 *  The landing starts before the runner stores the step's result, so the
 *  job it is handed names the step's transcript as its own `streamFile`
 *  and its results end on the step BEFORE. The last result is the step's
 *  own only for a landing resumed at boot, when that pointer is gone. */
export function stepLogLine(job: GatedJob, text: string, error = false): void {
  const last = job.results?.at(-1);
  const streamFile = stepStreamFile(job);
  if (!streamFile) return;
  const now = new Date();
  const startedAt = job.streamFile ? job.stepStartedAt : last?.startedAt;
  const began = startedAt ? Date.parse(startedAt) : NaN;
  const seconds = Number.isNaN(began) ? 0 : Math.max(0, Math.round((now.getTime() - began) / 1000));
  const clock = now.toTimeString().slice(0, 8);
  try {
    appendFileSync(runLogPath(streamFile), `aide-run-spec ${clock} +${seconds}s ${error ? "error: " : ""}${text}\n`);
  } catch {
    // Nothing to do: the gate log keeps the run either way.
  }
}

/** The transcript of the step this landing merges (see `stepLogLine`). */
function stepStreamFile(job: GatedJob): string | undefined {
  return job.streamFile ?? job.results?.at(-1)?.streamFile;
}

/** The test run's progress (`aide-record-test-run --progress-file`) into
 *  the step's Log as it comes, every two seconds and once more at the end. */
function followProgress(job: GatedJob, file: string): { stop: () => void } {
  let seen = 0;
  const drain = () => {
    let lines: string[];
    try {
      lines = readFileSync(file, "utf-8").split("\n");
    } catch {
      return;
    }
    const complete = lines.slice(0, -1); // the last is empty, or a line still being written
    for (const line of complete.slice(seen)) if (line.trim()) stepLogLine(job, `tests: ${line}`);
    seen = Math.max(seen, complete.length);
  };
  const timer = setInterval(drain, 2000);
  return {
    stop: () => {
      clearInterval(timer);
      drain();
    },
  };
}

/** The whole output of the landing's test run, kept beside the step's run
 *  log as `<job>.<step>.tests.log`: the Log shows its progress, this file
 *  what the tests said. */
function keepStepOutput(job: GatedJob, output: string): void {
  const streamFile = stepStreamFile(job);
  if (!streamFile) return;
  try {
    appendFileSync(`${streamFile.replace(/\.stream\.jsonl$/, "")}.tests.log`, output);
  } catch {
    // The shared gate log keeps it either way.
  }
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
  job: GatedJob,
  branch: string,
  opts: { scriptDir?: string },
): Promise<GateVerdict> {
  // Beside the runner first, never PATH alone: see `scriptFor`.
  const resolver = scriptFor("aide-resolve-test-cmd", { beside: opts.scriptDir, override: process.env.AIDE_RESOLVE_TEST_CMD_BIN });
  const recorder = scriptFor("aide-record-test-run", { beside: opts.scriptDir, override: process.env.AIDE_RECORD_TEST_RUN_BIN });
  // Against the default branch, so a Markdown-only change is tested by
  // the documentation check alone, as the step's own run was.
  const base = await defaultBranchRef(root);
  const resolved = await runScript([resolver, "--project-dir", root, ...(base ? ["--changed-from", base] : [])], root, 60_000);
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
    // No AIDE_TEST_CMD: nothing to run is not red. The project's page
    // says there is no test command.
    return { ok: true };
  }
  const log = process.env.AIDE_TEST_GATE_LOG ?? join(process.env.HOME || homedir(), "Library", "Logs", "aide-dashboard", "test-gate.log");
  // The step this landing merges may already have seen these commands
  // green on this very tree (seen-green.ts) — main has not moved since
  // its own run. Said in the same log a run would have written to, so a
  // landing that ran nothing still leaves its answer where people look.
  const seen = await alreadySeenGreen(root, liveRoot, job, commands, opts);
  if (seen) {
    stepLogLine(job, "the landing did not run the project's tests: the step already saw them green on this tree");
    try {
      mkdirSync(join(log, ".."), { recursive: true });
      appendFileSync(
        log,
        `--- ${new Date().toISOString()} ${job.project}/${job.specFolder} landing in ${liveRoot} ---\n` +
          `not run: the step already saw ${commands.join(" && ")} green on this tree (${seen})\n`,
      );
    } catch {
      // A log that cannot be written must not turn a skipped run red.
    }
    return { ok: true };
  }
  const scratch = mkdtempSync(join(tmpdir(), "aide-landing-gate-"));
  try {
    mkdirSync(join(scratch, job.specFolder), { recursive: true });
    const argv = [recorder, "--project-dir", root, "--specs-root", scratch, "--folder", job.specFolder];
    for (const c of commands) argv.push("--cmd", c);
    const runOnce = async (label: string) => {
      const progress = join(scratch, `progress${label.replace(/\W+/g, "-")}`);
      writeFileSync(progress, "");
      const follow = followProgress(job, progress);
      const out = await runScript([...argv, "--progress-file", progress], root, LANDING_GATE_TIMEOUT_MS, job.id, testWorkers()).finally(follow.stop);
      keepStepOutput(job, `${out.stdout}${out.stderr}`);
      // The run's own output, kept where the archive step used to keep
      // it, under the same header a reader already knows.
      try {
        mkdirSync(join(log, ".."), { recursive: true });
        appendFileSync(log, `--- ${new Date().toISOString()} ${job.project}/${job.specFolder} landing in ${liveRoot}${label} ---\n${out.stdout}${out.stderr}\n`);
      } catch {
        // A log that cannot be written must not turn a green suite red.
      }
      return out;
    };
    stepLogLine(job, `the landing runs the project's tests on the merge (${commands.length} command(s))`);
    let gate = await runOnce("");
    // A red run gets the WHOLE command once more: a test that lost to a
    // busy host passes the second time, and a real failure fails twice.
    // A run that timed out is not retried — a second one would hold the
    // landing for as long again.
    if (gate.code !== 0 && !gate.timedOut) {
      const first = failingLines(gate.stdout, gate.stderr);
      stepLogLine(job, "the landing's tests are red — running them once more", true);
      gate = await runOnce(" (retry)");
      if (gate.code === 0) {
        stepLogLine(job, "the landing's tests are green on the second run");
        return { ok: true, retriedAfter: first };
      }
      stepLogLine(job, "the landing's tests are red again", true);
    }
    if (gate.timedOut) {
      stepLogLine(job, `the landing's tests did not finish within ${Math.round(LANDING_GATE_TIMEOUT_MS / 60_000)} minutes`, true);
      return {
        ok: false,
        error: `the project's tests did not finish within ${Math.round(LANDING_GATE_TIMEOUT_MS / 60_000)} minutes on the merge — nothing was pushed; the archive step's own log has what they managed to say`,
        detail: failingLines(gate.stdout, gate.stderr),
      };
    }
    if (gate.code !== 0) stepLogLine(job, "the landing runs the same tests on main alone, without this spec");
    if (gate.code !== 0 && (await redOnDefaultBranch(liveRoot, recorder, argv.slice(3)))) {
      stepLogLine(job, "the tests are red on main as well — the failure is main's, not this spec's", true);
      return {
        ok: false,
        error:
          `the project's tests are red on main as well, without this spec's change — nothing was pushed, and the work is still on ${branch}. ` +
          "Once main is green again, archive merges the work.",
        detail: failingLines(gate.stdout, gate.stderr),
      };
    }
    if (gate.code !== 0) {
      stepLogLine(job, "the tests are green on main alone — the failure is this merge's", true);
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
        // Where the work IS rides in the sentence itself: the origin
        // check after the merge loop adds nothing beside a red suite,
        // so this is the row's one sentence (one message per failure).
        error:
          `the project's tests are red on this merge, so nothing was pushed — the work is still on ${branch}. ` +
          "The archive step's own log names the tests that failed; archive merges the work once they pass.",
        detail: [
          "A timing test that lost to a busy host passes on a re-run: run the step again when the host is quieter.",
          failingLines(gate.stdout, gate.stderr),
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    stepLogLine(job, "the landing's tests are green");
    return { ok: true };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
