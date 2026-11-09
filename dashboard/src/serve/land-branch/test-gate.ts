// The landing's own test run: the project's own suite, run once on the
// merged result before it is pushed. Green pushes; red drops the local
// merge, and the branch stays where implement left it.
//
// The archive step ran it before (core/scripts/aide-archive-spec):
// every archive re-ran the whole suite against a main
// that had moved since implement's own run, and with several jobs
// landing at once the same suite ran three and four times an hour for
// one change. Here it runs exactly once per landing, on exactly what
// main is about to become.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { LANDING_GATE_TIMEOUT_MS } from "../serve-helpers";
import { resolveWorktreeLinks } from "../../project/discover";
import { runScript, scriptFor } from "./run-script.ts";
import { NO_GIT_HOOKS } from "../../integrations/no-git-hooks.ts";
import { alreadySeenGreen, type GatedJob } from "./seen-green.ts";
import { runLogPath } from "../../queue/runner/run-log-path.ts";
import { formatRunLogLine } from "../../queue/parse-stream/step-log.ts";
import { type BusyJob, testWorkerShare } from "../../queue/test-workers.ts";
import { recordedFailures, variedBetween, type FailingTests } from "../../format/failing-tests.ts";
import { stepButton } from "../../format/step-label.ts";
import type { Sentence } from "../../i18n/message.ts";
import type { Job } from "../../queue/queue.ts";

export const LANDING_GATE_TEMP_PREFIX = "aide-landing-gate-tree-";

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

/** The failing tests a run named, kept as items for message detail. */
function namedTests(result: Pick<FailingTests, "tests" | "errors">): string[] {
  const shown = result.tests.slice(0, 8).map((test, index) => result.errors[index] ? `${test} — ${result.errors[index]}` : test);
  return result.tests.length > 8 ? [...shown, "…"] : shown;
}

/** The tests a verdict hands on, every one of them: the sentence shows eight. */
function asFailedTests(named: { test: string; file: string; error: string }[]): GateVerdict["failedTests"] {
  return named.map(({ test, file, error }) => ({ name: test, file, error }));
}

/** `retriedAfter`: green only on the second run, and these are the
 *  lines the first run failed on. */
export interface GateVerdict {
  ok: boolean;
  error?: Sentence;
  detail?: string;
  retriedAfter?: string;
  /** Every test the merge itself failed, on `landing.testsRedOnMerge` and
   *  `landing.testsRedOnMergeToo` alone: the next implement is handed them. */
  failedTests?: Job["landingFailedTests"];
}

/** `jobs` is the board's queue, read as each run starts: the landing's test
 *  workers are the host's cores divided among the jobs running or landing in
 *  it. A caller that passes none counts this landing alone. */
export interface GateOpts {
  scriptDir?: string;
  jobs?: () => readonly BusyJob[];
}

export async function runProjectSuiteBeforePush(
  root: string,
  job: GatedJob,
  branch: string,
  opts: GateOpts = {},
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
  const dir = mkdtempSync(join(tmpdir(), LANDING_GATE_TEMP_PREFIX));
  const added = await runScript(["git", ...NO_GIT_HOOKS, "worktree", "add", "--detach", "--quiet", dir, ref], root, 60_000);
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
  // A project that keeps its settings in the dashboard has an
  // untracked `.aide/project.yaml` in the checkout, which a worktree of
  // HEAD does not carry — and a tree with none finds no test command,
  // which is "nothing to run", a landing merged untested. Copied in
  // under the runner's rule (`carry_manifest_into_worktree`): tracked in
  // the tree or git unable to say → leave it alone; untracked with a
  // source → copy it. The links are read from the tree afterwards, so
  // the ones the copy names are made too.
  const manifestSource = [join(root, ".aide", "project.yaml"), join(owner, ".aide", "project.yaml")].find((p) => existsSync(p));
  if (manifestSource) {
    const tracked = await runScript(["git", ...NO_GIT_HOOKS, "ls-files", "--error-unmatch", "--", ".aide/project.yaml"], dir, 30_000);
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
      await runScript(["git", ...NO_GIT_HOOKS, "worktree", "remove", "--force", dir], root, 60_000);
      rmSync(dir, { recursive: true, force: true });
    },
  };
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
  recorder: string,
  argTail: string[],
  jobs: GateOpts["jobs"],
): Promise<DefaultBranchResult> {
  const ref = await defaultBranchRef(liveRoot);
  if (!ref) return { status: "not-checked", reason: "the default branch was not found" };
  const tree = await checkoutForGate(liveRoot, ref);
  if (tree.dir === liveRoot) return { status: "not-checked", reason: "the default branch could not be checked out" };
  try {
    const out = await runScript([recorder, "--project-dir", tree.dir, ...argTail], tree.dir, LANDING_GATE_TIMEOUT_MS, undefined, testWorkers(jobs));
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
  return { ok: false, error: { key: "landing.testsTimedOut", values: { minutes, test, button } }, detail: failingLines(output, "") };
}

/** The host's cores divided among the steps and landings running as this
 *  run starts (`testWorkerShare`). `jobs` is read at each call; a caller
 *  that passes none counts this landing alone. */
function testWorkers(jobs: GateOpts["jobs"]): Record<string, string> {
  return { AIDE_TEST_WORKERS: String(testWorkerShare(availableParallelism(), jobs?.() ?? [])) };
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
    appendFileSync(runLogPath(streamFile), `${formatRunLogLine(clock, seconds, text, error)}\n`);
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
  const common = await runScript(["git", ...NO_GIT_HOOKS, "rev-parse", "--git-common-dir"], root, 30_000);
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
  opts: GateOpts,
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
        error: { key: "testGate.cannotResolveCommand", values: { root } },
        detail: String(parsed.error ?? "unknown"),
      };
    }
    commands = Array.isArray(parsed.commands) ? parsed.commands : [];
  } catch {
    return {
      ok: false,
      error: { key: "testGate.cannotReadResolverAnswer", values: { root } },
      detail: resolved.stderr.slice(-400),
    };
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
      const out = await runScript([...argv, "--progress-file", progress], root, LANDING_GATE_TIMEOUT_MS, job.id, testWorkers(opts.jobs)).finally(follow.stop);
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
    const button = stepButton("archive");
    let gate = await runOnce("");
    const firstResult = recordedFailures(gate.stdout);
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
    const minutes = Math.round(LANDING_GATE_TIMEOUT_MS / 60_000);
    if (gate.timedOut) {
      stepLogLine(job, `the landing's tests did not finish within ${minutes} minutes`, true);
      return timeoutVerdict(`${gate.stdout}\n${gate.stderr}`, minutes, button);
    }
    if (gate.code !== 0) stepLogLine(job, "the landing runs the same tests on main alone, without this spec");
    if (gate.code !== 0) {
      const main = await resultOnDefaultBranch(liveRoot, recorder, argv.slice(3), opts.jobs);
      // One sentence on the row: the tests that failed when the output
      // named them, and what the two runs on the merge say about them —
      // the same tests twice is the merge's doing; different ones point at
      // unstable tests or a busy machine, and only then is that said. The
      // test output rides in `detail`, on hover and on the job's own page.
      // Where the work IS rides in the sentence itself: the origin check
      // after the merge loop adds nothing beside a red suite.
      const lastResult = recordedFailures(gate.stdout);
      const firstTests = firstResult.tests;
      const lastTests = lastResult.tests;
      const detail = failingLines(gate.stdout, gate.stderr);
      if (main.status === "not-checked") {
        stepLogLine(job, `the tests on main were not checked: ${main.reason}`, true);
        return { ok: false, error: { key: "landing.testsMainNotChecked", values: { reason: main.reason, branch, button } }, detail };
      }
      if (main.status === "red") {
        if (!main.failures.tests.length) {
          stepLogLine(job, "the tests are red on main, but its output named no failing test", true);
          return { ok: false, error: { key: "landing.testsRedOnMainUnnamed", values: { branch, button } }, detail };
        }
        const onMain = new Set(main.failures.tests);
        const mergeOnly = lastTests.map((test, index) => ({ test, file: lastResult.files[index] ?? "", error: lastResult.errors[index] ?? "" })).filter(({ test }) => !onMain.has(test));
        if (!mergeOnly.length) {
          stepLogLine(job, "the same tests are red on main as well", true);
          return { ok: false, error: { key: "landing.testsRedOnMainToo", values: { branch, button } }, detail };
        }
        return {
          ok: false,
          error: (() => { const tests = namedTests({ tests: mergeOnly.map(({ test }) => test), errors: mergeOnly.map(({ error }) => error) }); return { key: "landing.testsRedOnMergeToo", values: { count: mergeOnly.length, branch, button }, lists: { tests } }; })(),
          detail,
          failedTests: asFailedTests(mergeOnly),
        };
      }
      stepLogLine(job, "the tests are green on main alone — the failure is this merge's", true);
      if (!firstTests.length) return { ok: false, error: { key: "landing.testsRedOnMergeUnnamed", values: { branch, button } }, detail };
      const firstSet = new Set(firstTests);
      const repeated = lastTests.map((test, index) => ({ test, file: lastResult.files[index] ?? "", error: lastResult.errors[index] ?? "" })).filter(({ test }) => firstSet.has(test));
      if (repeated.length) {
        return {
          ok: false,
          error: (() => { const tests = namedTests({ tests: repeated.map(({ test }) => test), errors: repeated.map(({ error }) => error) }); return { key: "landing.testsRedOnMerge", values: { count: repeated.length, branch, button }, lists: { tests } }; })(),
          detail,
          failedTests: asFailedTests(repeated),
        };
      }
      if (lastTests.length && variedBetween(firstTests, lastTests)) {
        const combined = new Map<string, string>();
        firstTests.forEach((test, index) => combined.set(test, firstResult.errors[index] ?? ""));
        lastTests.forEach((test, index) => combined.set(test, lastResult.errors[index] ?? ""));
        return {
          ok: false,
          error: {
            key: "landing.testsRedOnMergeVaried",
            values: { count: combined.size, branch, button },
            lists: { tests: namedTests({ tests: [...combined.keys()], errors: [...combined.values()] }) },
          },
          detail,
        };
      }
      return { ok: false, error: { key: "landing.testsRedOnMergeUnnamed", values: { branch, button } }, detail };
    }
    stepLogLine(job, "the landing's tests are green");
    return { ok: true };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
