import { resolve } from "node:path";
import type { GitRunner } from "../../git/process/index.ts";

export async function servedOlder(
  ctx: { readServing: () => { sha: string | null; repoRoot: string | null }; gitRun: GitRunner },
  root: string,
): Promise<{ served: string; head: string } | "equal" | "unknown"> {
  const { sha, repoRoot } = ctx.readServing();
  if (!sha || !repoRoot || resolve(root) !== resolve(repoRoot)) return "unknown";
  const head = await ctx.gitRun(root, ["rev-parse", "HEAD"]).catch(() => null);
  if (!head || head.code !== 0) return "unknown";
  const checkout = head.stdout.trim();
  return checkout === sha ? "equal" : { served: sha.slice(0, 7), head: checkout.slice(0, 7) };
}
