// What GitHub says about the Cloudflare Pages build of a branch's newest
// commit, asked through `gh`. The host publishes each branch's own address
// in its check run's summary, and the run's `status` and `conclusion` say
// whether the build is done — so the address is read, never built from the
// branch's name.
//
// This holds the question, the reading of the answer and nothing that runs
// a process; the caller hands in the runner, as `pull-requests.ts` does.

import type { GhRunner } from "./pull-requests.ts";

/** The fields of one check run this reads. */
export interface CheckRun {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  app?: { slug?: string };
  output?: { summary?: string | null };
}

/** `address` is the branch's own address; `{}` is "no address to show". */
export interface BranchPreviewAnswer {
  address?: string;
}

/** Every check run on the newest commit of `branch`. `gh` fills in the
 *  owner and repo from the remote of the directory it runs in. */
export function branchPreviewArgs(branch: string): string[] {
  return ["api", `repos/{owner}/{repo}/commits/${branch}/check-runs`];
}

const isCloudflarePages = (r: CheckRun): boolean =>
  r?.name === "Cloudflare Pages" && typeof r.app?.slug === "string" && r.app.slug.startsWith("cloudflare");

/** The `https://` address on the summary's "Branch Preview URL" row —
 *  never the "Preview URL" row above it, which is fixed to one commit. */
function branchAddress(summary: string): string | undefined {
  const row = /Branch Preview URL[\s\S]*?(?=<\/tr>|$)/.exec(summary)?.[0];
  return row ? /https:\/\/[^\s'"<>]+/.exec(row)?.[0] : undefined;
}

/** `null` for output that is not an object with a `check_runs` array: no
 *  answer, never "no address". Only the newest Cloudflare Pages run counts,
 *  and only once it has completed with success. */
export function readBranchPreview(stdout: string): BranchPreviewAnswer | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const runs = (parsed as { check_runs?: unknown } | null)?.check_runs;
  if (!Array.isArray(runs)) return null;
  const newest = (runs as CheckRun[]).filter(isCloudflarePages).sort((a, b) => b.id - a.id)[0];
  if (!newest || newest.status !== "completed" || newest.conclusion !== "success") return {};
  const address = branchAddress(newest.output?.summary ?? "");
  return address ? { address } : {};
}

/** `null` when `gh` could not answer. */
export async function askBranchPreview(run: GhRunner, codeRoot: string, branch: string): Promise<BranchPreviewAnswer | null> {
  const result = await run(codeRoot, branchPreviewArgs(branch));
  return result.code === 0 ? readBranchPreview(result.stdout) : null;
}
