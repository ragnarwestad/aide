import { dirname } from "node:path";
import { rmSync } from "node:fs";
import { REQUEST_LOCK_WAIT_MS, withCheckoutLock } from "../../../git/checkout-lock";
import { runScript, scriptFor } from "../../land-branch/run-script";
import type { RoutesContext } from "../";

export interface DirectCreateInput {
  project: string;
  title: string;
  description: string;
  dependsOn: string[];
  acceptanceRequired: boolean;
  criteriaChecks?: string;
  chooseApproach: boolean;
}

export type DirectCreateResult = { ok: true; specFolder: string; specDir?: string } | { ok: false; error: string };

const firstLine = (text?: string): string => text?.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "git gave no reason";

export async function createSpecDirectly(ctx: RoutesContext, input: DirectCreateInput): Promise<DirectCreateResult> {
  if (ctx.opts.directCreateSpec) return ctx.opts.directCreateSpec(input);
  const checkout = await ctx.ensureCheckout(input.project, { fresh: true });
  if (!checkout) return { ok: false, error: "the project's specs checkout is not available" };
  const root = checkout.specsRepo;
  return ctx.mergeLock.run(root, async () => {
    const held = await withCheckoutLock(root, async (): Promise<DirectCreateResult> => {
      const before = await ctx.gitRun(root, ["rev-parse", "HEAD"]);
      if (before.code !== 0) return { ok: false, error: `the specs checkout could not be read: ${firstLine(before.stderr)}` };
      const base = await ctx.branchStatus.defaultBranch(root);
      if (!base) return { ok: false, error: "the specs repository's default branch could not be found" };
      const pull = await ctx.gitRun(root, ["pull", "--ff-only", "origin", base], 30_000);
      if (pull.code !== 0) return { ok: false, error: `the specs checkout could not be updated: ${firstLine(pull.stderr)}` };

      const script = scriptFor("aide-create-spec", {
        beside: ctx.opts.queueRunnerBin ? dirname(ctx.opts.queueRunnerBin) : undefined,
        override: process.env.AIDE_CREATE_SPEC_BIN,
      });
      const argv = [script, "--specs-root", checkout.specs, "--title", input.title, "--description", input.description];
      if (input.dependsOn.length) argv.push("--depends-on", input.dependsOn.join(","));
      if (!input.acceptanceRequired) argv.push("--acceptance-not-required");
      if (input.criteriaChecks) argv.push("--criteria-checks", input.criteriaChecks);
      argv.push("--choose-approach", input.chooseApproach ? "yes" : "no");
      const made = await runScript(argv, root, 30_000);
      let answer: { ok?: boolean; specFolder?: string; error?: string } = {};
      try { answer = JSON.parse(made.stdout.trim().split("\n").pop() || "{}"); } catch { /* reported below */ }
      if (made.code !== 0 || !answer.ok || !answer.specFolder || answer.specFolder.startsWith("new-")) {
        return { ok: false, error: answer.error ?? "aide-create-spec produced no final spec folder" };
      }
      const rollback = async () => {
        await ctx.gitRun(root, ["reset", "--hard", before.stdout.trim()]);
        rmSync(`${checkout.specs}/${answer.specFolder}`, { recursive: true, force: true });
      };
      const added = await ctx.gitRun(root, ["add", "--", `${checkout.specs}/${answer.specFolder}`]);
      if (added.code !== 0) { await rollback(); return { ok: false, error: "the new spec could not be staged" }; }
      const committed = await ctx.gitRun(root, ["commit", "-m", `Create ${answer.specFolder}`]);
      if (committed.code !== 0) { await rollback(); return { ok: false, error: "the new spec could not be committed" }; }
      const pushed = await ctx.gitRun(root, ["push", "origin", "HEAD"]);
      if (pushed.code !== 0) { await rollback(); return { ok: false, error: `the new spec could not be pushed: ${firstLine(pushed.stderr)}` }; }
      return { ok: true, specFolder: answer.specFolder, specDir: `${checkout.specs}/${answer.specFolder}` };
    }, { waitMs: REQUEST_LOCK_WAIT_MS });
    return held.locked ? held.value : { ok: false, error: "another process is using the specs checkout; try again" };
  });
}
