import { appendFileSync, existsSync } from "node:fs";
import type { Job, QueueDefaults } from "../../../queue/queue.ts";
import { repairModel, repairSessionFailed } from "./model.ts";
import { resolveWorktreeLinks } from "../../../project/discover";
import { runScript, scriptFor } from "../run-script.ts";
import { stepLogLine } from "../test-gate.ts";
import type { RepairRequest } from "./index.ts";

/** Run the repair on the exact tested merge, and preserve it on the
 * source branch before asking the merge machinery to rebuild and test. */
export function testRepairSession(defaults: QueueDefaults, job: Job, scriptDir?: string, cancelled: () => boolean = () => false) {
  return async (request: RepairRequest): Promise<boolean> => {
    const { root, branch, verdict } = request;
    const run = (argv: string[], timeout: number, env: Record<string, string> = {}) => {
      if (cancelled()) throw new Error("test repair cancelled");
      return runScript(argv, root, timeout, job.id, env);
    };
    const git = (args: string[]) => run(["git", "-c", "core.hooksPath=/dev/null", ...args], 60_000);
    const before = await git(["rev-parse", "HEAD"]);
    const source = await git(["rev-parse", `refs/remotes/origin/${branch}`]);
    if (before.code || source.code) return false;
    const sha = before.stdout.trim();
    if ((await git(["merge-base", "--is-ancestor", source.stdout.trim(), sha])).code) return false;
    const resolver = scriptFor("aide-resolve-test-cmd", { beside: scriptDir });
    const resolved = await run([resolver, "--project-dir", root], 60_000);
    let filesCommand: string;
    try { filesCommand = JSON.parse(resolved.stdout.trim().split("\n").at(-1) ?? "{}").filesCommand; } catch { return false; }
    if (!filesCommand) return false;
    const log = job.streamFile ? `${job.streamFile.replace(/\.stream\.jsonl$/, "")}.tests.log` : undefined;
    const prompt = [
      `Fix only regressions introduced by branch ${branch} in the tested merge ${sha}. Main alone passed.`,
      `Working directory: ${root}. Failing tests: ${JSON.stringify(verdict.failedTests)}.`,
      log && existsSync(log) ? `Read the complete test output at ${log}.` : `Test output: ${verdict.detail ?? ""}`,
      "Read the branch diff against origin's default branch to understand the change. Follow this project's instructions.",
      "Fix the source of the failure. Correct a test when the branch intentionally changed what it assumes, such as where a setting is read. Keep the same requirement covered and explain why the test needed updating.",
      "Do not weaken or delete a test to hide a defect. Keep edits scoped to the failure. Leave commits, pushes and branch selection to Merge.",
      "Run only the failed test files. The landing runs the project's configured tests after rebuilding.",
      "If the failure cannot be safely attributed to this change, leave the tree unchanged and explain why.",
    ].join("\n");
    const model = repairModel(defaults, job, prompt);
    if (!model) return false;
    stepLogLine(job, `repairing the landing's failing tests on ${model.name} (${model.key}), tested commit ${sha}`);
    const result = await run(model.argv, (defaults.timeoutSec.implement ?? defaults.timeoutSec.default ?? 1200) * 1000, model.env);
    if (job.streamFile) {
      const transcript = `${job.streamFile}.repair.jsonl`;
      appendFileSync(transcript, result.stdout);
      stepLogLine(job, `test repair transcript: ${transcript}`);
    }
    stepLogLine(job, `test repair session ended (exit ${result.code})${result.stderr ? `: ${result.stderr.slice(-400)}` : ""}`, result.code !== 0);
    if (result.code || result.timedOut || repairSessionFailed(result.stdout)) return false;
    if ((await git(["rev-parse", "HEAD"])).stdout.trim() !== sha) return false;
    const changed = await git(["diff", "--name-only", "HEAD"]);
    const untracked = await git(["ls-files", "--others", "--exclude-standard"]);
    const links = resolveWorktreeLinks(root).links.split(/[\s,]+/).filter(Boolean);
    const files = [...new Set(`${changed.stdout}\n${untracked.stdout}`.split("\n").filter((p) => p && p !== ".aide/project.yaml" && !links.some((link) => p === link || p.startsWith(`${link}/`))))];
    if (changed.code || untracked.code || !files.length) return false;
    if ((await git(["diff", "--name-only", "--diff-filter=D", "HEAD"])).stdout.trim()) return false;
    // Independently check the named files; the model's report is not proof.
    const testFiles = [...new Set(verdict.failedTests!.map((test) => test.file))];
    const isolated = await run(["/bin/bash", "-c", `${filesCommand} "$@"`, "_", ...testFiles], 30 * 60_000);
    if (log) appendFileSync(log, `\n--- repaired test files ---\n${isolated.stdout}${isolated.stderr}`);
    if (isolated.code || isolated.timedOut) return false;
    if ((await git(["add", "--", ...files])).code) return false;
    if ((await git(["commit", "-qm", "Fix regressions found by the landing tests"])).code) return false;
    // No force: a concurrent source-branch update must refuse this push.
    const recovery = `refs/aide/landing-repairs/${job.id}`;
    if ((await git(["update-ref", recovery, "HEAD"])).code) return false;
    const pushed = await git(["push", "origin", `HEAD:refs/heads/${branch}`]);
    if (pushed.code) stepLogLine(job, `could not save the test repair on ${branch}: ${pushed.stderr.slice(-400)}`, true);
    if (pushed.code === 0) await git(["update-ref", "-d", recovery]);
    return pushed.code === 0;
  };
}
