import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { inFlight, type Job } from "../../queue/queue.ts";
import type { StepOutcome } from "../../queue/runner";
import { sharedFiles } from "../../queue/runner/types.ts";
import type { RoutesContext } from "../routes";
import { saveSpecFiles } from "../../git/specs-pull.ts";
import { lastCommitOf } from "../../git/description-freshness.ts";
import { readStatusFromBranch, resolveOpenBranchTarget } from "../../git/branch-file.ts";
import { dependsOnIn, withDependsOnLine } from "../../project/discover/depends-on.ts";
import { specReference } from "../../project/spec-folder.ts";
import { afterTick } from "../routes/spec-edit/checks.ts";
import { followOnJob } from "../routes/spec-edit/shared.ts";
import { landingErrorOfStep } from "../land-branch/stopped-reason.ts";
import { planDependencies } from "./plan.ts";
import { aiWorkRetryDecision, aiWorkRetryRecord } from "../../queue/runner/retry.ts";
import { DESCRIPTION_FILE } from "../../project/spec-names.ts";

async function descriptionsIn(ctx: RoutesContext, root: string): Promise<Map<string, string>> {
  const descriptions = new Map<string, string>();
  let fresh = true;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "archive" || entry.name.startsWith(".")) continue;
    const dir = join(root, entry.name), file = join(dir, DESCRIPTION_FILE);
    if (!existsSync(file)) continue;
    const target = await resolveOpenBranchTarget(ctx, dir, entry.name, DESCRIPTION_FILE, fresh);
    fresh = false;
    const branch = target ? await readStatusFromBranch(ctx.gitRun, target.root, target.branch, target.relPath) : null;
    if (target && !branch) {
      // An archive moves the folder under archive/ on its own branch before it lands: that spec is
      // as good as archived, and an archived spec waits on nothing.
      const archived = join(dirname(dirname(target.relPath)), "archive", entry.name, DESCRIPTION_FILE);
      if (await readStatusFromBranch(ctx.gitRun, target.root, target.branch, archived)) {
        descriptions.set(entry.name, "");
        continue;
      }
      throw new Error(`Could not read the current dependencies of ${entry.name}`);
    }
    const text = readFileSync(file, "utf8");
    if (!branch || branch.text === text) descriptions.set(entry.name, text);
    else {
      // Neither a pending edit nor an older branch can hide a live dependency.
      const dependencies = [...new Set([...dependsOnIn(text), ...dependsOnIn(branch.text)])];
      descriptions.set(entry.name, `- **Depends on:** ${dependencies.map((id) => `\`${id}\``).join(", ")}\n${text}`);
    }
  }
  const archive = join(root, "archive");
  if (existsSync(archive)) for (const entry of readdirSync(archive, { withFileTypes: true })) {
    if (entry.isDirectory() && !descriptions.has(entry.name)) descriptions.set(entry.name, "");
  }
  return descriptions;
}

export async function applyOverlapDependencies(ctx: RoutesContext, job: Job, outcome: Partial<StepOutcome>): Promise<void> {
  const required = sharedFiles(outcome.sharedFiles);
  if (!required?.length) return;
  const source = ctx.queue.get(job.id);
  if (!source || source.state !== "stopped" || source.stopReason !== "shared-files" || source.dependencyNotice || source.landing || landingErrorOfStep(source, "analyze")) return;
  const missing = required.filter((entry) => !entry.reason);
  if (missing.length) {
    const attempts = source.retry?.action === "analyze" ? source.retry.attempts : 1;
    const retry = aiWorkRetryDecision({ terminalReason: "overlap-decision-missing" }, attempts);
    const record = retry ? aiWorkRetryRecord(source, "analyze", {
      terminalReason: "overlap-decision-missing",
      detail: missing.map((entry) => `${entry.spec}: ${entry.files.join(", ")}`).join("\n"),
      repos: source.results.at(-1)?.repos,
    }) : undefined;
    if (record) {
      ctx.queue.transition(job.id, "retry-late", {
        retry: record,
        finishedAt: undefined,
        stopReason: undefined,
        error: undefined,
        errorDetail: undefined,
      });
      await ctx.tickRunner();
      return;
    }
    const message = { key: "runner.overlapDecisionMissing" as const, values: {
      specs: missing.map((entry) => specReference(job.project, entry.spec)),
    } };
    ctx.queue.update(job.id, { error: attempts >= 2
      ? { key: "runner.afterTwoAttempts", inner: message }
      : message });
    return;
  }
  const active = () => ctx.queue.list().some((other) => other.id !== job.id && other.project === job.project &&
    other.specFolder === job.specFolder && inFlight(other));
  if (active()) return;
  const found = ctx.specDir(job.project, job.specFolder);
  if (!found) return;
  const dir = await ctx.machinerySpecDir(job.project, found);
  const root = await ctx.specsRoot(dir);
  try {
    await ctx.mergeLock.run(root, async () => {
      const current = ctx.queue.get(job.id);
      if (active() || !current || current.state !== "stopped" || current.stopReason !== "shared-files" || current.dependencyNotice) return;
      ctx.queue.update(job.id, { landing: true });
      try {
        if (outcome.pushError) throw new Error(outcome.pushError);
        const specs = dirname(dir), file = join(dir, DESCRIPTION_FILE);
        const text = readFileSync(file, "utf8");
        const base = await lastCommitOf(ctx.gitRun, dir, DESCRIPTION_FILE);
        const edit = { file: DESCRIPTION_FILE, text, baseSha: base?.sha ?? null };
        let cycle: string[] | undefined;
        let added: string[] = [];
        // saveSpecFiles validates after its pull and before any file is written.
        const saved = await saveSpecFiles(ctx.gitRun, dir, (repo) => ctx.branchStatus.defaultBranch(repo),
          [edit], {
            specLabel: job.specFolder, message: `Add dependencies for ${job.specFolder}`,
            validate: async () => {
              const graph = await descriptionsIn(ctx, specs);
              if (graph.get(job.specFolder) !== text) return "The description has changed on its open branch; nothing was saved";
              const change = planDependencies(job.specFolder, required.map((entry) => entry.spec), graph);
              if ("cycle" in change) { cycle = change.cycle; return "Dependency cycle; nothing was saved"; }
              if ("error" in change) return change.error;
              added = change.added;
              const updated = withDependsOnLine(text, change.dependencies);
              if (updated === null) return "Tracking info has no Created line; nothing was saved";
              // The edit is filled only after the freshly pulled graph passed validation.
              edit.text = updated;
              return undefined;
            },
          });
        if (!saved.ok) {
          ctx.queue.update(job.id, { error: cycle
            ? { key: "runner.dependencyCycle", values: { chain: cycle.map((folder) => specReference(job.project, folder)).join(" → ") } }
            : { key: "runner.autoDependenciesFailed", values: { reason: saved.note } } });
          return;
        }
        const notice = { key: "runner.dependenciesAdded" as const, values: {
          dependencies: required.filter((entry) => added.includes(entry.spec))
            .map((entry) => `${specReference(job.project, entry.spec)} — ${entry.reason}`),
        } };
        if (added.length) ctx.queue.update(job.id, { dependencyNotice: notice });
        ctx.queue.update(job.id, { landing: undefined });
        const queued = ctx.queue.enqueue(followOnJob(job.project, job.specFolder, job.steps.slice(job.stepIndex), job));
        if (!queued.ok) throw new Error(`Dependencies were saved, but Analyze could not be queued: ${queued.error}`);
        if (added.length) {
          ctx.queue.update(queued.job.id, { dependencyNotice: notice });
        }
      } finally {
        ctx.queue.update(job.id, { landing: undefined });
      }
    });
  } catch (error) {
    ctx.queue.update(job.id, { error: { key: "runner.autoDependenciesFailed", values: { reason: String(error) } } });
  }
  await afterTick(ctx, dir, job.specFolder);
  await ctx.rereadProject(job.project);
  await ctx.tickRunner();
}
