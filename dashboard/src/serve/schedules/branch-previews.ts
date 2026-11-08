// The background question to GitHub: has the host built this spec's
// branch, and on what address? Asked for the live specs of a project whose
// manifest says `deployment.previewFrom: cloudflare-pages`, and kept for
// the specs list to read. Nothing here runs while a page is drawn.

import { specBranch, type BranchStatusChecker } from "../../git/branch-status.ts";
import { askBranchPreview } from "../../integrations/branch-previews.ts";
import type { GhRunner } from "../../integrations/pull-requests.ts";
import type { PreviewFrom } from "../../project/discover";
import { codeBranchOnOrigin } from "../test-servers/branch-on-origin.ts";

/** How often the question is asked, in milliseconds. */
export const BRANCH_PREVIEW_POLL_MS = 60_000;

/** What one tick reads, bundled the way `ScheduleContext` is. `running` is
 *  the tick's own single-flight flag, held on the context so that two
 *  servers in one process never share it. */
export interface BranchPreviewContext {
  targets: () => { project: string; specFolder: string }[];
  machineryProjectDir: (project: string) => string;
  branchStatus: Pick<BranchStatusChecker, "peekOpenSpecBranches">;
  previewFrom: (project: string) => PreviewFrom | undefined;
  /** Whether a step of the spec is queued or running, and so about to
   *  push or merge its branch. */
  stepRunning: (project: string, specFolder: string) => boolean;
  ghRun: GhRunner;
  /** The kept addresses, keyed `project/folder`. */
  branchPreviews: Map<string, string>;
  notifyQueueChanged: () => void;
  running?: boolean;
}

/** One tick. Whom it asks: a live spec of a `cloudflare-pages` project,
 *  with its branch on the code checkout's origin and no step running — a
 *  running step can push or merge the branch at any moment, so an address
 *  kept from before it would be an old build once it ends.
 *
 *  A question `gh` did not answer leaves the kept address where it was;
 *  an answer with no address removes it, which is how a build begun by a
 *  later push hides the link. An address kept for a spec no longer asked
 *  about is dropped. The open pages are told once, and only when an
 *  address appeared, changed or went. */
export async function refreshBranchPreviews(ctx: BranchPreviewContext): Promise<void> {
  if (ctx.running) return;
  ctx.running = true;
  try {
    const projectAsks = new Map<string, boolean>();
    const asks: { key: string; root: string; branch: string }[] = [];
    for (const t of ctx.targets()) {
      if (!projectAsks.has(t.project)) projectAsks.set(t.project, ctx.previewFrom(t.project) === "cloudflare-pages");
      if (!projectAsks.get(t.project)) continue;
      const root = ctx.machineryProjectDir(t.project);
      if (!codeBranchOnOrigin(ctx.branchStatus, root, t.specFolder)) continue;
      if (ctx.stepRunning(t.project, t.specFolder)) continue;
      asks.push({ key: `${t.project}/${t.specFolder}`, root, branch: specBranch(t.specFolder) });
    }
    let moved = false;
    for (const key of [...ctx.branchPreviews.keys()]) {
      if (asks.some((a) => a.key === key)) continue;
      ctx.branchPreviews.delete(key);
      moved = true;
    }
    const answers = await Promise.all(asks.map((a) => askBranchPreview(ctx.ghRun, a.root, a.branch).catch(() => null)));
    asks.forEach((a, i) => {
      const answer = answers[i];
      if (!answer) return;
      const kept = ctx.branchPreviews.get(a.key);
      if (kept === answer.address) return;
      if (answer.address) ctx.branchPreviews.set(a.key, answer.address);
      else ctx.branchPreviews.delete(a.key);
      moved = true;
    });
    if (moved) ctx.notifyQueueChanged();
  } finally {
    ctx.running = false;
  }
}

/** Forgets the address of every spec a step is running for. Called on the
 *  runner's own, much shorter tick, so a step that ends between two
 *  sweeps still leaves nothing behind: the address kept from before it
 *  would otherwise show again the moment it ends, while the build of what
 *  it pushed may still be running. */
export function dropPreviewsOfRunningSteps(ctx: BranchPreviewContext): void {
  let dropped = false;
  for (const key of [...ctx.branchPreviews.keys()]) {
    const cut = key.indexOf("/");
    if (!ctx.stepRunning(key.slice(0, cut), key.slice(cut + 1))) continue;
    ctx.branchPreviews.delete(key);
    dropped = true;
  }
  if (dropped) ctx.notifyQueueChanged();
}
