// Test the merged result before push; confirmed regressions may be repaired
// on the source branch and rebuilt against current main.

import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { LANDING_GATE_TIMEOUT_MS } from "../serve-helpers";
import { runScript, scriptFor } from "./run-script.ts";
import { checkoutForGate, runWorktreeSetup, type WorktreeSetup } from "./worktree-setup.ts";
import { NO_GIT_HOOKS } from "../../integrations/no-git-hooks.ts";
import { alreadySeenGreen, type GatedJob } from "./seen-green.ts";
import { recordedFailures, type FailingTests } from "../../format/failing-tests.ts";
import { LANDING_RETRIES } from "../../git/branch-merge/index.ts";
import type { Sentence } from "../../messages/types.ts";
import type { RepairRequest } from "./repair/index.ts";
import type { Job } from "../../queue/queue.ts";
import { redSuites, rerunAfterRepair, suiteEnv, type RedSuites } from "./suite-rerun.ts";
import { stepLogLine, stepStreamFile } from "./gate/step-log.ts";
import { redOnMainVerdict, redOnMergeVerdict, type RedFacts } from "./gate/red-verdict.ts";

export { LANDING_GATE_TEMP_PREFIX } from "./worktree-setup.ts";
export { stepLogLine };

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
  // The recorder's own JSON answer is not something the tests said.
  const lines = `${stdout}\n${stderr}`.split("\n").filter((l) => !/^\{"ok":/.test(l.trim()));
  const named = lines.filter(
    (l) => /^\(fail\)|^\s*\d+ fail\b|^error(:| TS)|^(FAILED|ERROR) \S+::/.test(l.trim()) || /^\s*\d+ fail\b/.test(l),
  );
  // Once each: the dashboard's runner prints a failing test as it fails
  // and again in the red worker's full output.
  const picked = named.length ? [...new Set(named)] : lines;
  const out = picked.join("\n").trim();
  // The END of the picked lines, not the start: a suite with many
  // failures ends with the summary, and the summary is the line that
  // says how many there were. Cut at a line, never inside a word.
  if (out.length <= budget) return out;
  const tail = out.slice(-budget);
  const at = tail.indexOf("\n");
  return at >= 0 && at < tail.length - 1 ? tail.slice(at + 1) : tail;
}

/** `retriedAfter`: green only on the second run, and these are the
 *  lines the first run failed on. */
export interface GateVerdict {
  ok: boolean;
  repaired?: boolean;
  terminalReason?: "tests-red" | "timeout";
  error?: Sentence;
  detail?: string;
  retriedAfter?: string;
  /** Every test the merge itself failed, on `landing.testsRedOnMerge` and
   *  `landing.testsRedOnMergeToo` alone: the next implement is handed them. */
  failedTests?: Job["landingFailedTests"];
  /** A red run's suites, for the attempt after a repair. */
  red?: RedSuites;
}

export interface GateOpts {
  /** What the attempt before a repair found red (`createLandingGate`). */
  red?: RedSuites;
  scriptDir?: string;
  repair?: (request: RepairRequest) => Promise<boolean>;
  queueMirrorPath?: string;
  /** The button the landing step's row offers, named by every sentence
   *  that refuses the merge for its tests. */
  button: string;
}

export async function runProjectSuiteBeforePush(
  root: string,
  job: GatedJob,
  branch: string,
  opts: GateOpts,
): Promise<GateVerdict> {
  // The suite runs in a throwaway worktree of the merge commit, never in
  // the live checkout: a run's own git and a fast-forward of main moved
  // that checkout under a running suite once (2026-09-03), so the tests
  // on disk changed while the code they import was already loaded, and
  // five tests failed that had nothing to do with the merge.
  const setup = setupFor(job, opts);
  const tree = await checkoutForGate(root, "HEAD", setup);
  try {
    if (tree.setup && !tree.setup.ok) {
      // Before the tests and before any repair: nothing ran to be red.
      const values = { command: tree.setup.command ?? "", branch, button: opts.button };
      return { ok: false, error: { key: "landing.worktreeSetupFailed", values }, detail: tree.setup.tail ?? "" };
    }
    const verdict = await runSuiteIn(tree.dir, root, job, branch, opts, setup);
    if (!verdict.ok && opts.repair && await opts.repair({ root: tree.dir, job, branch, verdict })) {
      stepLogLine(job, "test repairs saved on the source branch — rebuilding against current main");
      return { ok: false, repaired: true, red: verdict.red };
    }
    return verdict;
  } finally {
    await tree.remove();
  }
}

/** The project's `worktreeSetup` for a gate worktree, logged in the step's own log. */
function setupFor(job: GatedJob, opts: GateOpts): (dir: string) => Promise<WorktreeSetup> {
  return (dir) => runWorktreeSetup(dir, { scriptDir: opts.scriptDir, owner: job.id, log: (line, error) => stepLogLine(job, line, error) });
}

/** The default branch as origin has it, or the local one where there is
 *  no origin: main without the spec being landed. */
async function defaultBranchRef(root: string): Promise<string | null> {
  const head = await runScript(["git", ...NO_GIT_HOOKS, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], root, 30_000);
  const candidates = [head.stdout.trim(), "refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master"];
  for (const ref of candidates.filter(Boolean)) {
    if ((await runScript(["git", ...NO_GIT_HOOKS, "show-ref", "--verify", "--quiet", ref], root, 30_000)).code === 0) return ref;
  }
  return null;
}

type DefaultBranchResult =
  | { status: "green" }
  | { status: "red"; failures: FailingTests }
  | { status: "not-checked"; reason: string };

/** The same commands on the default branch alone, after both merge runs
 *  were red. Anything that prevents the check stays distinct from green. */
async function resultOnDefaultBranch(
  liveRoot: string,
  runOnce: (label: string, root: string) => Promise<Awaited<ReturnType<typeof runScript>>>,
  setup?: (dir: string) => Promise<WorktreeSetup>,
): Promise<DefaultBranchResult> {
  const ref = await defaultBranchRef(liveRoot);
  if (!ref) return { status: "not-checked", reason: "the default branch was not found" };
  const tree = await checkoutForGate(liveRoot, ref, setup);
  if (tree.dir === liveRoot) return { status: "not-checked", reason: "the default branch could not be checked out" };
  try {
    if (tree.setup && !tree.setup.ok) return { status: "not-checked", reason: "the worktree setup failed on the default branch" };
    const out = await runOnce(" on main alone", tree.dir);
    if (out.timedOut) return { status: "not-checked", reason: "the tests on the default branch did not finish" };
    if (out.code === 0) return { status: "green" };
    return { status: "red", failures: recordedFailures(out.stdout) };
  } finally {
    await tree.remove();
  }
}

/** A timed-out merge names the last test heading the captured output saw. */
export function timeoutVerdict(output: string, minutes: number, button: string): GateVerdict {
  const test = output.split("\n").map((line) => line.trim()).flatMap((line) => {
    if (/^--- .+/.test(line)) return [line.replace(/^--- /, "")];
    const heading = line.match(/^(.+\.(?:test|spec)\.[cm]?[jt]sx?):$/);
    return heading?.[1] ? [heading[1]] : [];
  }).at(-1) ?? "the last test shown in the log";
  return { ok: false, terminalReason: "timeout", error: { key: "landing.testsTimedOut", values: { minutes, test, button } }, detail: failingLines(output, "") };
}

/** The test run's progress (`aide-record-test-run --progress-file`) into
 *  the step's Log as it comes, every two seconds and once more at the end. */
function followProgress(job: GatedJob, file: string, label: string): { stop: () => void } {
  let seen = 0;
  const drain = () => {
    let lines: string[];
    try {
      lines = readFileSync(file, "utf-8").split("\n");
    } catch {
      return;
    }
    const complete = lines.slice(0, -1); // the last is empty, or a line still being written
    for (const line of complete.slice(seen)) if (line.trim()) stepLogLine(job, `tests${label}: ${line}`);
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

type ScriptOut = Awaited<ReturnType<typeof runScript>>;
type RunOnce = (label: string, runRoot?: string, env?: Record<string, string>) => Promise<ScriptOut>;

async function runSuiteIn(
  root: string,
  liveRoot: string,
  job: GatedJob,
  branch: string,
  opts: GateOpts,
  setup?: (dir: string) => Promise<WorktreeSetup>,
): Promise<GateVerdict> {
  const commands = await resolveCommands(root, liveRoot, opts);
  if (!Array.isArray(commands)) return commands;
  if (commands.length === 0) {
    // No AIDE_TEST_CMD: nothing to run is not red. The project's page
    // says there is no test command.
    return { ok: true };
  }
  const log = process.env.AIDE_TEST_GATE_LOG ?? join(process.env.HOME || homedir(), "Library", "Logs", "aide-dashboard", "test-gate.log");
  if (await skippedAsSeenGreen(root, liveRoot, job, commands, opts, log)) return { ok: true };
  const mainRef = await defaultBranchRef(liveRoot);
  const mainSha = mainRef ? (await runScript(["git", ...NO_GIT_HOOKS, "rev-parse", mainRef], liveRoot, 30_000)).stdout.trim() : "";
  const testedHead = (await runScript(["git", ...NO_GIT_HOOKS, "rev-parse", "HEAD"], root, 30_000)).stdout.trim();
  const again = rerunAfterRepair(opts.red, mainSha);
  const scratch = mkdtempSync(join(tmpdir(), "aide-landing-gate-"));
  const report = join(scratch, "suites.jsonl");
  try {
    mkdirSync(join(scratch, job.specFolder), { recursive: true });
    const runOnce = suiteRunner({ root, liveRoot, job, opts, commands, scratch, report, log });
    if (again) stepLogLine(job, `the landing runs again the suites that were red (${again.red.join(", ")}), and those the repair's own changes need`);
    else stepLogLine(job, `the landing runs the project's tests on the merge (${commands.length} command(s))`);
    let gate = await runOnce("", root, suiteEnv(report, again?.red, again?.testedHead));
    const firstResult = recordedFailures(gate.stdout);
    const red = redSuites(report);
    // A caller without repair gets the whole command again (`LANDING_RETRIES.gateReruns`):
    // a test that lost to a busy host passes the second time, and a real
    // failure fails twice. A run that timed out is not retried — a second
    // one would hold the landing for as long again. Repair-capable landings
    // diagnose the first failure instead of repeating an unchanged full suite.
    if (gate.code !== 0 && !gate.timedOut && !opts.repair) {
      const rerun = await rerunWhileRed(job, gate, runOnce);
      if (rerun.verdict) return rerun.verdict;
      gate = rerun.gate;
    }
    const minutes = Math.round(LANDING_GATE_TIMEOUT_MS / 60_000);
    if (gate.timedOut) {
      stepLogLine(job, `the landing's tests did not finish within ${minutes} minutes`, true);
      return timeoutVerdict(`${gate.stdout}\n${gate.stderr}`, minutes, opts.button);
    }
    if (gate.code === 0) {
      stepLogLine(job, "the landing's tests are green");
      return { ok: true };
    }
    stepLogLine(job, "the landing runs the same tests on main alone, without this spec");
    return await redVerdict({ liveRoot, job, branch, button: opts.button, gate, firstResult, red, testedHead, mainSha },
      (label, runRoot) => runOnce(label, runRoot, suiteEnv(report, red)), setup);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The commands the merged change calls for, or the verdict that says
 *  why they could not be worked out. */
async function resolveCommands(root: string, liveRoot: string, opts: GateOpts): Promise<string[] | GateVerdict> {
  // Beside the runner first, never PATH alone: see `scriptFor`.
  const resolver = scriptFor("aide-resolve-test-cmd", { beside: opts.scriptDir, override: process.env.AIDE_RESOLVE_TEST_CMD_BIN });
  // What the branch changed beyond the default branch picks the tests, as
  // in Implement; the nightly full run on main catches what a selection
  // misses. Without a default branch the whole command runs.
  // Named as Implement names it (`origin/main`), so a landing on the tree
  // Implement saw green resolves the same command and is skipped.
  const base = (await defaultBranchRef(liveRoot))?.replace(/^refs\/(remotes|heads)\//, "");
  const selection = base ? ["--changed-from", base, "--targeted"] : [];
  const resolved = await runScript([resolver, "--project-dir", root, ...selection], root, 60_000);
  try {
    const parsed = JSON.parse(resolved.stdout.trim().split("\n").pop() ?? "{}");
    if (!parsed.ok) {
      return {
        ok: false,
        error: { key: "testGate.cannotResolveCommand", values: { root } },
        detail: String(parsed.error ?? "unknown"),
      };
    }
    return Array.isArray(parsed.commands) ? parsed.commands : [];
  } catch {
    return {
      ok: false,
      error: { key: "testGate.cannotReadResolverAnswer", values: { root } },
      detail: resolved.stderr.slice(-400),
    };
  }
}

/** The step this landing merges may already have seen these commands
 *  green on this very tree (seen-green.ts) — main has not moved since
 *  its own run. Said in the same log a run would have written to, so a
 *  landing that ran nothing still leaves its answer where people look. */
async function skippedAsSeenGreen(root: string, liveRoot: string, job: GatedJob, commands: string[], opts: GateOpts, log: string): Promise<boolean> {
  const seen = await alreadySeenGreen(root, liveRoot, job, commands, opts);
  if (!seen) return false;
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
  return true;
}

/** One run of the recorder over the commands, its progress followed into
 *  the step's Log and its output kept in both logs. */
function suiteRunner(
  { root, liveRoot, job, opts, commands, scratch, report, log }:
    { root: string; liveRoot: string; job: GatedJob; opts: GateOpts; commands: string[]; scratch: string; report: string; log: string },
): RunOnce {
  const recorder = scriptFor("aide-record-test-run", { beside: opts.scriptDir, override: process.env.AIDE_RECORD_TEST_RUN_BIN });
  const argv = [recorder, "--project-dir", root, "--specs-root", scratch, "--folder", job.specFolder];
  for (const c of commands) argv.push("--cmd", c);
  return async (label, runRoot = root, env = suiteEnv(report)) => {
    const progress = join(scratch, `progress${label.replace(/\W+/g, "-")}`);
    writeFileSync(progress, "");
    const follow = followProgress(job, progress, label === " (retry)" ? " on the merge (retry)" : label || " on the merge");
    const runArgv = [...argv];
    runArgv[2] = runRoot;
    const out = await runScript([...runArgv, "--progress-file", progress], runRoot, LANDING_GATE_TIMEOUT_MS, job.id, { ...env, ...(opts.queueMirrorPath ? { AIDE_QUEUE_MIRROR: opts.queueMirrorPath } : {}) }).finally(follow.stop);
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
}

/** The whole command again while it stays red; the green verdict when a
 *  rerun passes. */
async function rerunWhileRed(job: GatedJob, gate: ScriptOut, runOnce: RunOnce): Promise<{ gate: ScriptOut; verdict?: GateVerdict }> {
  const first = failingLines(gate.stdout, gate.stderr);
  for (let n = 0; n < LANDING_RETRIES.gateReruns && gate.code !== 0 && !gate.timedOut; n++) {
    stepLogLine(job, "the landing's tests are red — running them once more", true);
    gate = await runOnce(" (retry)");
  }
  if (gate.code === 0) {
    stepLogLine(job, "the landing's tests are green on the second run");
    return { gate, verdict: { ok: true, retriedAfter: first } };
  }
  stepLogLine(job, "the landing's tests are red again", true);
  return { gate };
}

interface RedRun extends RedFacts {
  liveRoot: string;
  gate: ScriptOut;
}

/** One sentence on the row: the tests that failed when the output named
 *  them, and what the two runs on the merge say about them — the same
 *  tests twice is the merge's doing; different ones point at unstable
 *  tests or a busy machine, and only then is that said. The test output
 *  rides in `detail`, on hover and on the job's own page. Where the work
 *  IS rides in the sentence itself: the origin check after the merge
 *  loop adds nothing beside a red suite. */
async function redVerdict(
  run: RedRun,
  runOnce: (label: string, root: string) => Promise<ScriptOut>,
  setup?: (dir: string) => Promise<WorktreeSetup>,
): Promise<GateVerdict> {
  const { job, branch, button, gate, red } = run;
  if (red?.length) stepLogLine(job, `on main alone, only the suites that were red: ${red.join(", ")}`);
  const main = await resultOnDefaultBranch(run.liveRoot, runOnce, setup);
  const lastResult = recordedFailures(gate.stdout);
  const detail = failingLines(gate.stdout, gate.stderr);
  if (main.status === "not-checked") {
    stepLogLine(job, `the tests on main were not checked: ${main.reason}`, true);
    return { ok: false, error: { key: "landing.testsMainNotChecked", values: { reason: main.reason, branch, button } }, detail };
  }
  if (main.status === "red") return redOnMainVerdict(run, main.failures, lastResult, detail);
  stepLogLine(job, "the tests are green on main alone — the failure is this merge's", true);
  return redOnMergeVerdict(run, lastResult, detail);
}
